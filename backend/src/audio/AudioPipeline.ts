import { EventEmitter } from 'events';
import { RtpHandler } from '../sip/RtpHandler';
import { transcribe } from '../ai/stt';
import { synthesise } from '../ai/tts';
import { getNextReply, getOpeningLine, type AgentMessage } from '../ai/agent';
import type { TranscriptLine } from '../types';

const SAMPLE_RATE = 8000;
const SILENCE_THRESHOLD_RMS = 400;
const SPEECH_END_SILENCE_MS = 350;
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
  private incomingBuffer: Buffer[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  private speaking = false;
  private done = false;

  constructor(rtp: RtpHandler, prompt: string) {
    super();
    this.rtp = rtp;
    this.prompt = prompt;

    this.rtp.on('pcm', (pcm: Buffer) => this.onIncomingPcm(pcm));
  }

  /** Start the pipeline: generate and send the opening line. */
  async start(): Promise<void> {
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
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private onIncomingPcm(pcm: Buffer): void {
    if (this.done || this.speaking) return;

    this.emit('audio', pcm);
    this.incomingBuffer.push(pcm);

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushBuffer(), SPEECH_END_SILENCE_MS);
  }

  private async flushBuffer(): Promise<void> {
    this.flushTimer = null;
    if (this.done || this.incomingBuffer.length === 0) return;

    const combined = Buffer.concat(this.incomingBuffer);
    this.incomingBuffer = [];

    if (rms(combined) < SILENCE_THRESHOLD_RMS) return;

    let transcript: string;
    try {
      transcript = await transcribe(combined);
    } catch (err) {
      this.emit('error', err as Error);
      return;
    }

    if (!transcript) return;

    this.emit('transcript', {
      speaker: 'restaurant',
      text: transcript,
      timestamp: new Date(),
    } satisfies TranscriptLine);

    this.history.push({ role: 'user', text: transcript });

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

function rms(pcm: Buffer): number {
  let sum = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const s = pcm.readInt16LE(i);
    sum += s * s;
  }
  return Math.sqrt(sum / (pcm.length >> 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
