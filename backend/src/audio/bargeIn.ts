export interface BargeInDetectorOptions {
  rmsThreshold: number;
  minConsecutiveSpeechFrames: number;
  maxBufferedFrames: number;
}

export interface BargeInObservation {
  shouldInterrupt: boolean;
  bufferedAudio?: Buffer;
}

export class BargeInDetector {
  private readonly rmsThreshold: number;
  private readonly minConsecutiveSpeechFrames: number;
  private readonly maxBufferedFrames: number;

  private consecutiveSpeechFrames = 0;
  private bufferedFrames: Buffer[] = [];

  constructor(options: BargeInDetectorOptions) {
    this.rmsThreshold = options.rmsThreshold;
    this.minConsecutiveSpeechFrames = options.minConsecutiveSpeechFrames;
    this.maxBufferedFrames = options.maxBufferedFrames;
  }

  observe(pcm: Buffer): BargeInObservation {
    this.bufferFrame(pcm);

    if (calculateRms(pcm) >= this.rmsThreshold) {
      this.consecutiveSpeechFrames += 1;
    } else {
      this.consecutiveSpeechFrames = 0;
    }

    if (this.consecutiveSpeechFrames < this.minConsecutiveSpeechFrames) {
      return { shouldInterrupt: false };
    }

    const bufferedAudio = this.drainBufferedAudio() ?? Buffer.alloc(0);
    this.consecutiveSpeechFrames = 0;
    return { shouldInterrupt: true, bufferedAudio };
  }

  drainBufferedAudio(): Buffer | null {
    if (this.bufferedFrames.length === 0) return null;
    const audio = Buffer.concat(this.bufferedFrames);
    this.bufferedFrames = [];
    return audio;
  }

  reset(): void {
    this.consecutiveSpeechFrames = 0;
    this.bufferedFrames = [];
  }

  private bufferFrame(pcm: Buffer): void {
    this.bufferedFrames.push(Buffer.from(pcm));
    while (this.bufferedFrames.length > this.maxBufferedFrames) {
      this.bufferedFrames.shift();
    }
  }
}

function calculateRms(pcm: Buffer): number {
  if (pcm.length < 2) return 0;

  let sumSquares = 0;
  let samples = 0;

  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    sumSquares += sample * sample;
    samples += 1;
  }

  if (samples === 0) return 0;
  return Math.sqrt(sumSquares / samples);
}
