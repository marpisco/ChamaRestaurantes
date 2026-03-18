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
 * Parse WAV file, return sample rate and raw 16-bit LE PCM (mono).
 * Handles stereo by mixing L+R to mono.
 */
export function parseWav(buf: Buffer): { sampleRate: number; pcm: Buffer } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid WAV file');
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let pcmRaw: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      pcmRaw = buf.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size;
    if (pcmRaw && sampleRate) break;
  }

  if (!sampleRate || !pcmRaw) throw new Error('Malformed WAV file');
  console.debug(`[WAV] ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit, ${pcmRaw.length} bytes`);

  // Ensure 16-bit (convert 32-bit float if needed — some TTS outputs f32)
  let pcm16 = pcmRaw;
  if (bitsPerSample === 32) {
    const samples = pcmRaw.length >> 2;
    pcm16 = Buffer.allocUnsafe(samples * 2);
    for (let i = 0; i < samples; i++) {
      pcm16.writeInt16LE(Math.round(pcmRaw.readFloatLE(i * 4) * 32767), i * 2);
    }
  }

  // Mix stereo → mono
  if (channels === 2) {
    const monoSamples = pcm16.length >> 2;
    const mono = Buffer.allocUnsafe(monoSamples * 2);
    for (let i = 0; i < monoSamples; i++) {
      const l = pcm16.readInt16LE(i * 4);
      const r = pcm16.readInt16LE(i * 4 + 2);
      mono.writeInt16LE(Math.round((l + r) / 2), i * 2);
    }
    return { sampleRate, pcm: mono };
  }

  return { sampleRate, pcm: pcm16 };
}

/**
 * Downsample 16-bit LE PCM from srcRate to dstRate using box averaging.
 * Works with any ratio (integer or not).
 */
export function downsample(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
  if (srcRate === dstRate) return pcm;
  const ratio = srcRate / dstRate;
  const srcSamples = pcm.length >> 1;
  const dstSamples = Math.floor(srcSamples / ratio);
  const out = Buffer.allocUnsafe(dstSamples * 2);
  for (let i = 0; i < dstSamples; i++) {
    const start = i * ratio;
    const end = start + ratio;
    let sum = 0;
    let count = 0;
    for (let j = Math.floor(start); j < Math.ceil(end) && j < srcSamples; j++) {
      sum += pcm.readInt16LE(j * 2);
      count++;
    }
    out.writeInt16LE(Math.round(sum / count), i * 2);
  }
  return out;
}

/**
 * Upsample 16-bit LE PCM from srcRate to dstRate using linear interpolation.
 */
export function upsample(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
  if (srcRate === dstRate) return pcm;

  const ratio = dstRate / srcRate;
  const srcSamples = pcm.length >> 1;
  const dstSamples = Math.floor(srcSamples * ratio);
  const out = Buffer.allocUnsafe(dstSamples * 2);

  for (let i = 0; i < dstSamples; i++) {
    const srcIdx = i / ratio;
    const srcIdxFloor = Math.floor(srcIdx);
    const srcIdxCeil = Math.min(srcIdxFloor + 1, srcSamples - 1);
    const frac = srcIdx - srcIdxFloor;

    const s1 = pcm.readInt16LE(srcIdxFloor * 2);
    const s2 = pcm.readInt16LE(srcIdxCeil * 2);
    const interpolated = Math.round(s1 * (1 - frac) + s2 * frac);

    out.writeInt16LE(interpolated, i * 2);
  }

  return out;
}
