import { EventEmitter } from 'events';
import { AssemblyAI, type TurnEvent } from 'assemblyai';
import { upsample } from '../audio/codec';
import config from '../config';

const client = new AssemblyAI({
  apiKey: config.assemblyai.apiKey,
});

/**
 * Streaming speech-to-text using AssemblyAI.
 * Handles upsampling from 8kHz RTP PCM to 16kHz for AssemblyAI streaming.
 */
export class StreamingTranscriber extends EventEmitter {
  private transcriber: ReturnType<typeof client.streaming.transcriber> | null = null;
  private isConnected = false;
  private isClosing = false;

  async connect(): Promise<void> {
    if (this.isConnected) return;
    if (!config.assemblyai.apiKey) {
      throw new Error('Missing environment variable: ASSEMBLYAI_API_KEY');
    }

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

  sendAudio(pcm8k: Buffer): void {
    if (!this.isConnected || this.isClosing || !this.transcriber) return;

    try {
      const pcm16k = upsample(pcm8k, 8000, 16000);
      const audio = pcm16k.buffer.slice(
        pcm16k.byteOffset,
        pcm16k.byteOffset + pcm16k.byteLength,
      );
      this.transcriber.sendAudio(audio);
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
}
