const axios = require('axios');

const {
  AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION,
  AZURE_COGNITIVE_ENDPOINT,
  AZURE_COGNITIVE_KEY
} = process.env;

// Call Azure OpenAI chat completions (via OpenAI-compatible Azure endpoint)
async function callAzureOpenAIChat(messages, options = {}) {
  if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_KEY || !AZURE_OPENAI_DEPLOYMENT) {
    throw new Error('Azure OpenAI config missing');
  }
  const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION || '2024-01-01'}`;
  const payload = {
    messages,
    max_tokens: options.max_tokens || 800,
    temperature: options.temperature ?? 0.2,
    top_p: options.top_p ?? 1.0,
    n: 1
  };
  const headers = {
    'Content-Type': 'application/json',
    'api-key': AZURE_OPENAI_KEY
  };
  const resp = await axios.post(url, payload, { headers, timeout: 60000 });
  return resp.data;
}

// Simple moderation using Azure Content Moderator (or Cognitive Services - placeholder).
// If you have a moderation endpoint or Azure content moderator, wire it here.
async function moderateText(text) {
  // If you have an actual moderation endpoint, call it here.
  // Placeholder simple keyword block:
  const blocked = ['spamlink.com', 'illegal'];
  const lower = (text || '').toLowerCase();
  for (const b of blocked) if (lower.includes(b)) return { blocked: true, reason: 'keyword' };
  return { blocked: false };
}

module.exports = {
  callAzureOpenAIChat,
  moderateText
};
