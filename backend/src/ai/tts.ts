import OpenAI from 'openai';
import config from '../config';
import { parseWav, downsample } from '../audio/codec';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Convert text to 16-bit LE PCM at 8kHz using OpenAI TTS.
 * Returns a Buffer ready to pass to RtpHandler.sendPcm().
 */
export async function synthesise(text: string): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: config.openai.ttsModel as 'tts-1' | 'tts-1-hd',
    input: text,
    voice: config.openai.ttsVoice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
    response_format: 'wav',
  });

  const arrayBuf = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  const { sampleRate, pcm } = parseWav(buf);
  return downsample(pcm, sampleRate, 8000);
}
