import { EventEmitter } from 'events';
import { RtpHandler } from '../sip/RtpHandler';
import { StreamingTranscriber } from '../ai/stt';
import { synthesise } from '../ai/tts';
import { getNextReply, getOpeningLine, type AgentMessage } from '../ai/agent';
import type { TranscriptLine } from '../types';
import { BargeInDetector } from './bargeIn';

const SAMPLE_RATE = 8000;
const POST_TTS_GUARD_MS = 120;
const BARGE_IN_RMS_THRESHOLD = 1400;
const BARGE_IN_MIN_CONSECUTIVE_FRAMES = 3;
const BARGE_IN_MAX_BUFFERED_FRAMES = 10;
const INTERRUPTED_TRANSCRIPT_PREFIX =
  'Contexto: o restaurante falou por cima do agente e interrompeu a fala anterior. Transcricao do que disse: ';

interface PlaybackState {
  interrupted: boolean;
  finish: () => void;
}

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
  private pendingInterruptedTranscript = false;
  private playbackState: PlaybackState | null = null;
  private readonly bargeInDetector = new BargeInDetector({
    rmsThreshold: BARGE_IN_RMS_THRESHOLD,
    minConsecutiveSpeechFrames: BARGE_IN_MIN_CONSECUTIVE_FRAMES,
    maxBufferedFrames: BARGE_IN_MAX_BUFFERED_FRAMES,
  });

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

      const contextualizedText = this.pendingInterruptedTranscript
        ? `${INTERRUPTED_TRANSCRIPT_PREFIX}${text}`
        : text;
      this.pendingInterruptedTranscript = false;

      this.history.push({ role: 'user', text: contextualizedText });

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
    if (this.done) return;

    this.emit('audio', pcm);

    if (this.speaking) {
      const observation = this.bargeInDetector.observe(pcm);
      if (!observation.shouldInterrupt) return;

      const interrupted = this.interruptPlayback();
      if (!interrupted) return;

      this.pendingInterruptedTranscript = true;
      if (observation.bufferedAudio && observation.bufferedAudio.length > 0) {
        this.transcriber?.sendAudio(observation.bufferedAudio);
      }
      return;
    }

    this.bargeInDetector.reset();
    if (this.transcriber) {
      this.transcriber.sendAudio(pcm);
    }
  }

  private async speak(text: string): Promise<void> {
    this.speaking = true;
    const playbackState: PlaybackState = {
      interrupted: false,
      finish: () => undefined,
    };
    this.playbackState = playbackState;

    let pcm: Buffer;
    try {
      pcm = await synthesise(text);
    } catch (err) {
      if (this.playbackState === playbackState) {
        this.playbackState = null;
      }
      this.speaking = false;
      this.emit('error', err as Error);
      return;
    }

    if (playbackState.interrupted || this.done) {
      if (this.playbackState === playbackState) {
        this.playbackState = null;
      }
      this.speaking = false;
      return;
    }

    this.rtp.sendPcm(pcm);

    const durationMs = (pcm.length / 2 / SAMPLE_RATE) * 1000;
    await waitForPlayback(durationMs + POST_TTS_GUARD_MS, playbackState);

    if (this.playbackState === playbackState) {
      this.playbackState = null;
    }
    this.speaking = false;
  }

  private interruptPlayback(): boolean {
    if (!this.speaking) return false;

    this.rtp.stopOutgoing();
    const playbackState = this.playbackState;
    if (playbackState) {
      playbackState.interrupted = true;
      playbackState.finish();
    }
    this.playbackState = null;
    this.speaking = false;
    return true;
  }
}

function waitForPlayback(ms: number, playbackState: PlaybackState): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(finish, ms);
    playbackState.finish = finish;
  });
}
