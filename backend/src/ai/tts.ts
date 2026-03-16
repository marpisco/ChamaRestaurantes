import Groq from 'groq-sdk';
import config from '../config';
import { parseWav, downsample } from '../audio/codec';

const groq = new Groq({ apiKey: config.groq.apiKey });

/**
 * Convert text to 16-bit LE PCM at 8kHz using Groq PlayAI TTS.
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

  if (sampleRate === 8000) return pcm;

  if (sampleRate % 8000 === 0) {
    return downsample(pcm, sampleRate, 8000);
  }

  return resampleLinear(pcm, sampleRate, 8000);
}

function resampleLinear(src: Buffer, srcRate: number, dstRate: number): Buffer {
  const srcSamples = src.length >> 1;
  const dstSamples = Math.floor((srcSamples * dstRate) / srcRate);
  const out = Buffer.allocUnsafe(dstSamples * 2);
  for (let i = 0; i < dstSamples; i++) {
    const srcPos = (i * srcRate) / dstRate;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = idx < srcSamples ? src.readInt16LE(idx * 2) : 0;
    const b = idx + 1 < srcSamples ? src.readInt16LE((idx + 1) * 2) : a;
    out.writeInt16LE(Math.round(a + frac * (b - a)), i * 2);
  }
  return out;
}
