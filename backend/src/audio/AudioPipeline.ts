import { EventEmitter } from 'events';
import { RtpHandler } from '../sip/RtpHandler';
import { transcribe } from '../ai/stt';
import { synthesise } from '../ai/tts';
import { getNextReply, getOpeningLine, AgentMessage } from '../ai/agent';
import type { TranscriptLine } from '../types';

const SAMPLE_RATE = 8000;
const SILENCE_THRESHOLD_RMS = 400;   // Below this = silence
const SPEECH_CHUNK_DURATION_MS = 1500; // Accumulate 1.5s before transcribing
const PCM_BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;  // 16 bytes/ms

export type PipelineEvent =
  | { type: 'transcript'; line: TranscriptLine }
  | { type: 'outcome'; outcome: 'confirmed' | 'rejected' }
  | { type: 'error'; error: Error };

/**
 * Orchestrates the audio loop for a single call:
 *   receive PCM → VAD → STT → LLM → TTS → send PCM
 *
 * Events:
 *   'transcript'  (line: TranscriptLine)
 *   'outcome'     (outcome: 'confirmed' | 'rejected')
 *   'audio'       (pcm: Buffer) – raw PCM for live monitoring
 *   'error'       (err: Error)
 */
export class AudioPipeline extends EventEmitter {
  private rtp: RtpHandler;
  private people: number;
  private preOrder?: string;

  private history: AgentMessage[] = [];
  private incomingBuffer: Buffer[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  private speaking = false;  // True while agent TTS is being sent
  private done = false;

  constructor(rtp: RtpHandler, people: number, preOrder?: string) {
    super();
    this.rtp = rtp;
    this.people = people;
    this.preOrder = preOrder;

    this.rtp.on('pcm', (pcm: Buffer) => this.onIncomingPcm(pcm));
  }

  /** Start the pipeline: generate and send the opening line. */
  async start(): Promise<void> {
    const opening = await getOpeningLine(this.people, this.preOrder);
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
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
  }

  // ─── Incoming audio ───────────────────────────────────────────────────────

  private onIncomingPcm(pcm: Buffer): void {
    if (this.done || this.speaking) return;

    // Broadcast to live monitors
    this.emit('audio', pcm);

    this.incomingBuffer.push(pcm);

    // Schedule flush after SPEECH_CHUNK_DURATION_MS of continuous reception
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushBuffer(), SPEECH_CHUNK_DURATION_MS);
    }
  }

  private async flushBuffer(): Promise<void> {
    this.flushTimer = null;
    if (this.done || this.incomingBuffer.length === 0) return;

    const combined = Buffer.concat(this.incomingBuffer);
    this.incomingBuffer = [];

    // Skip silent chunks
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

    // Generate LLM reply
    let reply: Awaited<ReturnType<typeof getNextReply>>;
    try {
      reply = await getNextReply(this.history, this.people, this.preOrder);
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

  // ─── Outgoing audio ───────────────────────────────────────────────────────

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

    // Wait for the audio to finish playing before listening again
    const durationMs = (pcm.length / 2 / SAMPLE_RATE) * 1000;
    await sleep(durationMs + 500); // +500ms buffer
    this.speaking = false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
