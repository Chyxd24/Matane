const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { AZURE_STT_ENDPOINT, AZURE_SPEECH_KEY } = process.env;

/*
  Simple Speech-to-Text helper (REST).
  This function expects a local audio file path and will send it to Azure STT endpoint:
  POST {AZURE_STT_ENDPOINT}/speech/recognition/conversation/cognitiveservices/v1?language=en-US
  Headers:
    'Ocp-Apim-Subscription-Key'
    'Content-Type': appropriate audio content-type (e.g., audio/ogg; codecs=opus or audio/wav)
  Note: Depending on Telegram audio format, you may need to convert audio to WAV (16kHz) first.
*/
async function speechToText(filePath, language = 'en-US') {
  if (!AZURE_STT_ENDPOINT || !AZURE_SPEECH_KEY) {
    throw new Error('Azure STT config missing');
  }
  const url = `${AZURE_STT_ENDPOINT}/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}`;
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  // Basic content-type guess; adjust as needed
  let contentType = 'audio/wav';
  if (ext === '.ogg' || ext === '.opus') contentType = 'audio/ogg; codecs=opus';
  if (ext === '.mp3') contentType = 'audio/mpeg';

  const data = fs.readFileSync(filePath);

  const resp = await axios.post(url, data, {
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      'Content-Type': contentType,
      'Accept': 'application/json'
    },
    timeout: 120000
  });

  // response may have {DisplayText: "..."} or other fields
  if (resp.data && (resp.data.DisplayText || resp.data.displayText || resp.data.text)) {
    return resp.data.DisplayText || resp.data.displayText || resp.data.text;
  }
  // else return raw text
  return JSON.stringify(resp.data);
}

module.exports = {
  speechToText
};
