import { EventEmitter } from 'events';
import { AssemblyAI, type TurnEvent } from 'assemblyai';
import { upsample } from '../audio/codec';
import config from '../config';

const client = new AssemblyAI({
  apiKey: config.assemblyai.apiKey,
});

const TARGET_CHUNK_BYTES_8K = 1600; // 100 ms at 8kHz, 16-bit mono
const MIN_CHUNK_BYTES_8K = 800; // 50 ms at 8kHz, 16-bit mono
const FLUSH_DELAY_MS = 60;

export class AudioChunkBuffer {
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;

  constructor(
    private readonly targetBytes: number,
    private readonly minimumFlushBytes: number,
  ) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.length;
  }

  drainReadyChunks(): Buffer[] {
    const ready: Buffer[] = [];

    while (this.bufferedBytes >= this.targetBytes) {
      ready.push(this.takeBytes(this.targetBytes));
    }

    return ready;
  }

  drainChunksWhenStreamBecomesReady(): Buffer[] {
    const chunks = this.drainReadyChunks();
    const trailingChunk = this.flushPendingChunk();
    if (trailingChunk) {
      chunks.push(trailingChunk);
    }
    return chunks;
  }

  flushPendingChunk(): Buffer | null {
    if (this.bufferedBytes < this.minimumFlushBytes) return null;
    return this.takeBytes(this.bufferedBytes);
  }

  pendingBytes(): number {
    return this.bufferedBytes;
  }

  reset(): void {
    this.chunks = [];
    this.bufferedBytes = 0;
  }

  private takeBytes(size: number): Buffer {
    const out = Buffer.allocUnsafe(size);
    let written = 0;

    while (written < size && this.chunks.length > 0) {
      const current = this.chunks[0];
      const remaining = size - written;

      if (current.length <= remaining) {
        current.copy(out, written);
        written += current.length;
        this.chunks.shift();
      } else {
        current.copy(out, written, 0, remaining);
        this.chunks[0] = current.subarray(remaining);
        written += remaining;
      }
    }

    this.bufferedBytes -= size;
    return out;
  }
}

/**
 * Streaming speech-to-text using AssemblyAI.
 * Handles upsampling from 8kHz RTP PCM to 16kHz for AssemblyAI streaming.
 */
export class StreamingTranscriber extends EventEmitter {
  private transcriber: ReturnType<typeof client.streaming.transcriber> | null = null;
  private isConnected = false;
  private isClosing = false;
  private connectPromise: Promise<void> | null = null;
  private chunkBuffer = new AudioChunkBuffer(TARGET_CHUNK_BYTES_8K, MIN_CHUNK_BYTES_8K);
  private flushTimer: NodeJS.Timeout | null = null;

  async connect(): Promise<void> {
    if (this.isConnected) return;
    if (this.connectPromise) return this.connectPromise;
    if (!config.assemblyai.apiKey) {
      throw new Error('Missing environment variable: ASSEMBLYAI_API_KEY');
    }

    this.connectPromise = this.connectInternal();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  sendAudio(pcm8k: Buffer): void {
    if (this.isClosing) return;

    try {
      this.chunkBuffer.push(pcm8k);
      this.resetFlushTimer();

      if (!this.isConnected) {
        void this.connect().then(() => this.drainBufferedAudioAfterConnect()).catch((err) => {
          this.emit('error', err as Error);
        });
        return;
      }

      this.drainBufferedAudio();
    } catch (err) {
      const error = err as Error;
      if (error.message.includes('Socket is not open for communication')) {
        this.isConnected = false;
        console.warn('[AssemblyAI STT] Audio dropped because the streaming socket is closed');
        return;
      }

      console.error('[AssemblyAI STT] Failed to send audio:', err);
      this.emit('error', error);
    }
  }

  async close(): Promise<void> {
    if (!this.transcriber) return;
    this.isClosing = true;
    this.isConnected = false;
    this.connectPromise = null;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.chunkBuffer.reset();

    try {
      await this.transcriber.close(false);
      console.log('[AssemblyAI STT] Closed');
    } catch (err) {
      console.error('[AssemblyAI STT] Failed to close:', err);
    } finally {
      this.isConnected = false;
      this.transcriber = null;
    }
  }

  private async connectInternal(): Promise<void> {
    this.transcriber = client.streaming.transcriber({
      apiKey: config.assemblyai.apiKey,
      sampleRate: 16000,
      encoding: 'pcm_s16le',
      speechModel: 'universal-streaming-multilingual',
      languageDetection: true,
      endOfTurnConfidenceThreshold: 0.4,
      inactivityTimeout: 120,
    });

    this.transcriber.on('error', (error: Error) => {
      console.error('[AssemblyAI STT] Error:', error.message);
      this.emit('error', error);
    });

    this.transcriber.on('turn', (turn: TurnEvent) => {
      if (turn.transcript && turn.end_of_turn) {
        console.debug(`[AssemblyAI STT] Turn end: "${turn.transcript}"`);
        this.emit('transcript', turn.transcript);
      }
    });

    this.transcriber.on('close', (code: number, reason: string) => {
      console.debug(`[AssemblyAI STT] Session closed: ${code} ${reason}`);
      this.isConnected = false;
      this.isClosing = false;
    });

    await this.transcriber.connect();
    this.isConnected = true;
    this.isClosing = false;
    console.log('[AssemblyAI STT] Connected');
  }

  private drainBufferedAudio(): void {
    if (!this.isConnected) return;

    const readyChunks = this.chunkBuffer.drainReadyChunks();
    for (const chunk of readyChunks) {
      this.sendChunk(chunk);
    }
  }

  private drainBufferedAudioAfterConnect(): void {
    if (!this.isConnected) return;

    const chunks = this.chunkBuffer.drainChunksWhenStreamBecomesReady();
    for (const chunk of chunks) {
      this.sendChunk(chunk);
    }
  }

  private flushPendingAudio(): void {
    if (!this.isConnected || this.isClosing) return;
    const chunk = this.chunkBuffer.flushPendingChunk();
    if (!chunk) return;
    this.sendChunk(chunk);
  }

  private resetFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingAudio();
    }, FLUSH_DELAY_MS);
  }

  private sendChunk(pcm8k: Buffer): void {
    if (!this.transcriber) return;

    const pcm16k = upsample(pcm8k, 8000, 16000);
    const audio = pcm16k.buffer.slice(
      pcm16k.byteOffset,
      pcm16k.byteOffset + pcm16k.byteLength,
    );
    this.transcriber.sendAudio(audio);
  }
}
