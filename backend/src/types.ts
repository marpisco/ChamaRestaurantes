export type CallStatus =
  | 'pending'
  | 'registering'
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'failed';

export interface CallRequest {
  phone: string;
  prompt: string;
}

export interface CallRecord {
  id: string;
  phone: string;
  prompt: string;
  status: CallStatus;
  startedAt: Date;
  endedAt?: Date;
  transcript: TranscriptLine[];
  result?: CallResult;
  error?: string;
  /** Call this to hang up the active call (triggers SIP BYE). */
  hangup?: () => void;
}

export interface TranscriptLine {
  speaker: 'agent' | 'restaurant';
  text: string;
  timestamp: Date;
}

export interface CallResult {
  success: boolean;
  summary: string;
}

export interface SdpInfo {
  ip: string;
  port: number;
  codec: number;
}

export interface WsMessage {
  type: 'call.status' | 'audio.chunk' | 'transcript' | 'call.result';
  callId: string;
  payload: unknown;
}
