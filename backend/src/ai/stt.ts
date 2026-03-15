import Groq from 'groq-sdk';
import { toFile } from 'groq-sdk/uploads';
import config from '../config';
import { buildWav } from '../audio/codec';

const groq = new Groq({ apiKey: config.groq.apiKey });

/**
 * Transcribe 16-bit LE PCM audio (8kHz, mono) using Groq Whisper.
 * Returns the transcript text, or an empty string if nothing was recognised.
 */
export async function transcribe(pcm: Buffer): Promise<string> {
  if (pcm.length < 1600) return ''; // Ignore chunks shorter than 0.1s

  const wav = buildWav(pcm, 8000, 1, 16);
  const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' });

  const result = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    language: 'pt',
    response_format: 'text',
  });

  // groq-sdk returns a string when response_format is 'text'
  const text = typeof result === 'string' ? result : (result as { text: string }).text ?? '';
  return text.trim();
}
