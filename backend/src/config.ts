import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function requiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const config = {
  sip: {
    host: requiredEnv('SIP_HOST'),
    port: parseInt(optional('SIP_PORT', '5060')),
    username: requiredEnv('SIP_USERNAME'),
    password: requiredEnv('SIP_PASSWORD'),
    localIp: requiredEnv('SIP_LOCAL_IP'),
    localPort: parseInt(optional('SIP_LOCAL_PORT', '5080')),
  },
  groq: {
    apiKey: requiredEnv('GROQ_API_KEY'),
    ttsModel: optional('GROQ_TTS_MODEL', 'canopylabs/orpheus-v1-english'),
    ttsVoice: optional('GROQ_TTS_VOICE', 'diana'),
  },
  port: parseInt(optional('PORT', '3000')),
};

export default config;
