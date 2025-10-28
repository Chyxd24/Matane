const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');
const fetch = require('node-fetch');
const Redis = require('ioredis');
require('dotenv').config();

const {
  callAzureOpenAIChat,
  moderateText
} = require('./azureClient');

const { speechToText } = require('./stt');
const { textToSpeech, buildSsml } = require('./tts');

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3001;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || '';
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';
const REDIS_URL = process.env.REDIS_URL || '';

if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_TOKEN missing in .env');
  process.exit(1);
}

// Redis init (optional)
let redis = null;
if (REDIS_URL) {
  redis = new Redis(REDIS_URL);
  redis.on('error', (e) => console.warn('Redis error', e));
  console.log('Using Redis at', REDIS_URL);
}

// Global rate limiter (basic)
const globalLimiter = rateLimit({
  windowMs: 15 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Initialize Telegraf
const bot = new Telegraf(TELEGRAM_TOKEN);

// Simple in-memory cooldown fallback (if Redis not available)
const userCooldowns = new Map();
function checkCooldown(userId) {
  const now = Date.now();
  const cd = userCooldowns.get(userId);
  if (cd && cd > now) {
    return Math.ceil((cd - now) / 1000);
  }
  userCooldowns.set(userId, now + 2000); // 2s cooldown
  return 0;
}

// middleware for per-user checks
bot.use(async (ctx, next) => {
  try {
    const uid = ctx.from?.id;
    if (!uid) return;
    // blocked check
    if (redis) {
      const blocked = await redis.get(`blocked:${uid}`);
      if (blocked) return ctx.reply('Akses kamu diblokir sementara.');
    }
    const wait = checkCooldown(uid);
    if (wait > 0) return ctx.reply(`Tolong tunggu ${wait}s sebelum mengirim lagi.`);
    return next();
  } catch (e) {
    console.error('middleware err', e);
    return next();
  }
});

// /start
bot.start((ctx) => {
  ctx.reply('Halo! Kirim teks atau voice message. Bot ini menggunakan Azure OpenAI + Azure Speech.');
});

// text messages
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const uid = ctx.from.id;

  if (!text || text.length > 8000) return ctx.reply('Pesan kosong atau terlalu panjang.');

  // moderation
  const mod = await moderateText(text);
  if (mod.blocked) {
    if (redis) {
      const strikes = await redis.incr(`strikes:${uid}`);
      await redis.expire(`strikes:${uid}`, 24 * 3600);
      if (strikes >= 3) {
        await redis.set(`blocked:${uid}`, '1', 'EX', 60 * 60);
        return ctx.reply('Kamu diblokir sementara karena pelanggaran berulang.');
      }
    }
    return ctx.reply('Pesan tidak diperbolehkan.');
  }

  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

    const messages = [
      { role: 'system', content: 'Kamu adalah asisten yang sopan, jawab singkat dan jelas.' },
      { role: 'user', content: text }
    ];
    const aiResp = await callAzureOpenAIChat(messages, { max_tokens: 500, temperature: 0.25 });

    // parse response (Azure OpenAI chat completions shape)
    const reply = aiResp.choices?.[0]?.message?.content || aiResp.choices?.[0]?.text || JSON.stringify(aiResp);
    const final = reply.length > 4000 ? reply.slice(0, 4000) + '\n\n[truncated]' : reply;
    await ctx.reply(final);
  } catch (err) {
    console.error('chat err', err?.response?.data || err.message || err);
    await ctx.reply('Maaf, ada masalah memproses permintaan kamu.');
  }
});

// voice messages (Telegram voice -> download -> STT -> chat -> reply or TTS)
bot.on('voice', async (ctx) => {
  const voice = ctx.message.voice;
  const fileId = voice.file_id;
  const uid = ctx.from.id;

  await ctx.telegram.sendChatAction(ctx.chat.id, 'record_audio');

  try {
    // get file path
    const file = await ctx.telegram.getFile(fileId);
    const filePath = file.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

    // download file to temp
    const tmpDir = os.tmpdir();
    const localPath = path.join(tmpDir, `tg_voice_${Date.now()}.oga`);
    const res = await fetch(fileUrl);
    const dest = fs.createWriteStream(localPath);
    await new Promise((resolve, reject) => {
      res.body.pipe(dest);
      res.body.on('error', reject);
      dest.on('finish', resolve);
    });

    // Convert/ensure format if needed (not included). You may use ffmpeg to convert to WAV if STT requires.
    // For starter, attempt to send file as-is to Azure STT.
    const transcript = await speechToText(localPath, 'en-US').catch(e => {
      console.error('stt error', e?.response?.data || e.message || e);
      return null;
    });

    fs.unlinkSync(localPath); // cleanup

    if (!transcript) return ctx.reply('Gagal mengenali suara. Coba ulangi sebagai teks.');

    // moderation
    const mod = await require('./azureClient').moderateText(transcript);
    if (mod.blocked) return ctx.reply('Isi voice tidak diperbolehkan.');

    // call chat
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    const messages = [
      { role: 'system', content: 'You are a helpful assistant. Keep answers concise.' },
      { role: 'user', content: transcript }
    ];
    const aiResp = await callAzureOpenAIChat(messages, { max_tokens: 500, temperature: 0.3 });
    const replyText = aiResp.choices?.[0]?.message?.content || aiResp.choices?.[0]?.text || JSON.stringify(aiResp);

    // optionally synthesize reply to audio
    try {
      const ssml = buildSsml(replyText, 'en-US-AriaNeural');
      const audioBuffer = await textToSpeech(ssml);
      // send as voice message (ogg) or audio (mp3) depending on format - here we send as audio/mp3
      await ctx.replyWithAudio({ source: audioBuffer }, { caption: replyText.slice(0, 4000) });
    } catch (ttsErr) {
      console.warn('tts failed, sending text only', ttsErr?.message || ttsErr);
      await ctx.reply(replyText);
    }

  } catch (err) {
    console.error('voice handler err', err?.response?.data || err.message || err);
    await ctx.reply('Terjadi kesalahan saat memproses voice message.');
  }
});

// webhook mount
app.use(bot.webhookCallback(WEBHOOK_PATH));

// convenience endpoint to set webhook
app.post('/set-webhook', async (req, res) => {
  try {
    if (!WEBHOOK_DOMAIN) return res.status(400).json({ error: 'WEBHOOK_DOMAIN not configured' });
    const url = `${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;
    const ok = await bot.telegram.setWebhook(url);
    return res.json({ ok });
  } catch (err) {
    console.error('set-webhook', err);
    return res.status(500).json({ error: err.message || err });
  }
});

// fallback for local dev: you can call bot.launch() and use polling.
// But in webhook mode, we don't call bot.launch().

app.listen(PORT, async () => {
  console.log(`Server listening on ${PORT}, webhook path ${WEBHOOK_PATH}`);
  if (WEBHOOK_DOMAIN) {
    try {
      const url = `${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;
      await bot.telegram.setWebhook(url);
      console.log('Telegram webhook set to', url);
    } catch (err) {
      console.warn('Failed to set webhook on startup:', err?.message);
    }
  } else {
    console.log('WEBHOOK_DOMAIN not set — using polling/dev or set webhook manually.');
  }
});
