import { EventEmitter } from 'events';
import { RtpHandler } from '../sip/RtpHandler';
import { StreamingTranscriber } from '../ai/stt';
import { synthesise } from '../ai/tts';
import { getNextReply, getOpeningLine, type AgentMessage } from '../ai/agent';
import type { TranscriptLine } from '../types';

const SAMPLE_RATE = 8000;
const POST_TTS_GUARD_MS = 120;

export type PipelineEvent =
  | { type: 'transcript'; line: TranscriptLine }
  | { type: 'outcome'; outcome: 'confirmed' | 'rejected' }
  | { type: 'error'; error: Error };

/**
 * Orchestrates the audio loop for a single call.
 */
export class AudioPipeline extends EventEmitter {
  private rtp: RtpHandler;
  private prompt: string;

  private history: AgentMessage[] = [];
  private transcriber: StreamingTranscriber | null = null;

  private speaking = false;
  private done = false;

  constructor(rtp: RtpHandler, prompt: string) {
    super();
    this.rtp = rtp;
    this.prompt = prompt;

    this.rtp.on('pcm', (pcm: Buffer) => this.onIncomingPcm(pcm));
  }

  /** Start the pipeline: generate the opening line. STT connects on first inbound audio. */
  async start(): Promise<void> {
    this.transcriber = new StreamingTranscriber();

    this.transcriber.on('transcript', async (text: string) => {
      if (!text || this.done) return;

      this.emit('transcript', {
        speaker: 'restaurant',
        text,
        timestamp: new Date(),
      } satisfies TranscriptLine);

      this.history.push({ role: 'user', text });

      let reply: Awaited<ReturnType<typeof getNextReply>>;
      try {
        reply = await getNextReply(this.history, this.prompt);
      } catch (err) {
        this.emit('error', err as Error);
        return;
      }

      this.history.push({ role: 'assistant', text: reply.text });
      this.emit('transcript', {
        speaker: 'agent',
        text: reply.text,
        timestamp: new Date(),
      } satisfies TranscriptLine);

      if (reply.text) await this.speak(reply.text);

      if (reply.outcome !== 'ongoing') {
        this.done = true;
        this.emit('outcome', reply.outcome);
      }
    });

    this.transcriber.on('error', (err: Error) => {
      this.emit('error', err);
    });

    const opening = await getOpeningLine(this.prompt);
    this.history.push({ role: 'assistant', text: opening });
    this.emit('transcript', {
      speaker: 'agent',
      text: opening,
      timestamp: new Date(),
    } satisfies TranscriptLine);
    await this.speak(opening);
  }

  stop(): void {
    this.done = true;
    if (this.transcriber) {
      void this.transcriber.close();
      this.transcriber = null;
    }
  }

  private onIncomingPcm(pcm: Buffer): void {
    if (this.done || this.speaking) return;

    this.emit('audio', pcm);

    if (this.transcriber) {
      this.transcriber.sendAudio(pcm);
    }
  }

  private async speak(text: string): Promise<void> {
    this.speaking = true;
    let pcm: Buffer;
    try {
      pcm = await synthesise(text);
    } catch (err) {
      this.speaking = false;
      this.emit('error', err as Error);
      return;
    }

    this.rtp.sendPcm(pcm);

    const durationMs = (pcm.length / 2 / SAMPLE_RATE) * 1000;
    await sleep(durationMs + POST_TTS_GUARD_MS);
    this.speaking = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
