const axios = require('axios');

/*
  Simple Text-to-Speech helper using Azure TTS REST:
  POST {AZURE_TTS_ENDPOINT}/cognitiveservices/v1
  Headers:
    'Ocp-Apim-Subscription-Key'
    'Content-Type': 'application/ssml+xml'
    'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3' (or other)
  Body: SSML
  Returns: ArrayBuffer / Buffer of audio data
*/
const { AZURE_TTS_ENDPOINT, AZURE_SPEECH_KEY } = process.env;

async function textToSpeech(ssml, outputFormat = 'audio-16khz-32kbitrate-mono-mp3') {
  if (!AZURE_TTS_ENDPOINT || !AZURE_SPEECH_KEY) {
    throw new Error('Azure TTS config missing');
  }
  const url = `${AZURE_TTS_ENDPOINT}/cognitiveservices/v1`;
  const headers = {
    'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
    'Content-Type': 'application/ssml+xml',
    'X-Microsoft-OutputFormat': outputFormat,
    'User-Agent': 'telegram-aifoundry-bot'
  };
  const resp = await axios.post(url, ssml, { headers, responseType: 'arraybuffer', timeout: 120000 });
  return Buffer.from(resp.data);
}

function buildSsml(text, voice = 'en-US-AriaNeural') {
  return `
  <speak version="1.0" xml:lang="en-US">
    <voice name="${voice}">
      ${escapeXml(text)}
    </voice>
  </speak>`;
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

module.exports = {
  textToSpeech,
  buildSsml
};
