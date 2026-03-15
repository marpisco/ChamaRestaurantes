/**
 * G.711 μ-law (PCMU) codec — payload type 0, 8kHz, 8-bit
 * RFC 3551
 */

const BIAS = 0x84;
const MAX_PCM = 32767;

/** Encode a 16-bit signed PCM sample to 8-bit μ-law. */
function encodeSample(pcm: number): number {
  let sign = 0;
  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }
  if (pcm > MAX_PCM) pcm = MAX_PCM;
  pcm += BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

/** Decode an 8-bit μ-law sample to a 16-bit signed PCM sample. */
function decodeSample(ulaw: number): number {
  ulaw = ~ulaw & 0xff;
  const sign = ulaw & 0x80;
  const exponent = (ulaw >> 4) & 0x07;
  const mantissa = ulaw & 0x0f;
  let sample = ((mantissa << 3) | 0x84) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

/** Encode a Buffer of interleaved 16-bit LE PCM to G.711 μ-law bytes. */
export function pcmToUlaw(pcm: Buffer): Buffer {
  const out = Buffer.allocUnsafe(pcm.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = encodeSample(pcm.readInt16LE(i * 2));
  }
  return out;
}

/** Decode G.711 μ-law bytes to a Buffer of 16-bit LE PCM. */
export function ulawToPcm(ulaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(ulaw.length * 2);
  for (let i = 0; i < ulaw.length; i++) {
    out.writeInt16LE(decodeSample(ulaw[i]), i * 2);
  }
  return out;
}

/** Build a WAV header + PCM data buffer (for Groq Whisper upload). */
export function buildWav(pcm: Buffer, sampleRate = 8000, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample >> 3), 28);
  header.writeUInt16LE(channels * (bitsPerSample >> 3), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Parse WAV file, return sample rate and raw 16-bit LE PCM.
 * Supports PCM (format 1) only.
 */
export function parseWav(buf: Buffer): { sampleRate: number; pcm: Buffer } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid WAV file');
  }

  let offset = 12;
  let sampleRate = 0;
  let pcm: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      sampleRate = buf.readUInt32LE(offset + 12);
    } else if (id === 'data') {
      pcm = buf.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size;
    if (pcm && sampleRate) break;
  }

  if (!sampleRate || !pcm) throw new Error('Malformed WAV file');
  return { sampleRate, pcm };
}

/**
 * Downsample 16-bit LE PCM from srcRate to dstRate using linear decimation.
 * Only supports integer ratios (srcRate must be divisible by dstRate).
 */
export function downsample(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
  if (srcRate === dstRate) return pcm;
  if (srcRate % dstRate !== 0) throw new Error(`Cannot downsample ${srcRate}→${dstRate}: non-integer ratio`);
  const ratio = srcRate / dstRate;
  const srcSamples = pcm.length >> 1;
  const dstSamples = Math.floor(srcSamples / ratio);
  const out = Buffer.allocUnsafe(dstSamples * 2);
  for (let i = 0; i < dstSamples; i++) {
    out.writeInt16LE(pcm.readInt16LE(i * ratio * 2), i * 2);
  }
  return out;
}
