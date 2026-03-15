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
  people: number;
  preOrder?: string;
}

export interface CallRecord {
  id: string;
  phone: string;
  people: number;
  preOrder?: string;
  status: CallStatus;
  startedAt: Date;
  endedAt?: Date;
  transcript: TranscriptLine[];
  result?: CallResult;
  error?: string;
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
