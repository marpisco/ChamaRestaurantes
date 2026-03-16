import Groq from 'groq-sdk';
import config from '../config';
import { parseWav, downsample } from '../audio/codec';

const groq = new Groq({ apiKey: config.groq.apiKey });

/**
 * Convert text to 16-bit LE PCM at 8kHz using Groq TTS.
 * Returns a Buffer ready to pass to RtpHandler.sendPcm().
 */
export async function synthesise(text: string): Promise<Buffer> {
  const response = await (groq.audio.speech as unknown as {
    create(params: Record<string, unknown>): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  }).create({
    model: config.groq.ttsModel,
    input: text,
    voice: config.groq.ttsVoice,
    response_format: 'wav',
  });

  const arrayBuf = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  const { sampleRate, pcm } = parseWav(buf);
  return downsample(pcm, sampleRate, 8000);
}
