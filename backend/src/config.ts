import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function require(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const config = {
  sip: {
    host: require('SIP_HOST'),
    port: parseInt(optional('SIP_PORT', '5060')),
    username: require('SIP_USERNAME'),
    password: require('SIP_PASSWORD'),
    localIp: require('SIP_LOCAL_IP'),
    localPort: parseInt(optional('SIP_LOCAL_PORT', '5080')),
  },
  groq: {
    apiKey: require('GROQ_API_KEY'),
  },
  openai: {
    apiKey: require('OPENAI_API_KEY'),
    ttsModel: optional('OPENAI_TTS_MODEL', 'tts-1'),
    ttsVoice: optional('OPENAI_TTS_VOICE', 'nova'),
  },
  port: parseInt(optional('PORT', '3000')),
};

export default config;
