import { useEffect, useRef, useCallback } from 'react';

export type WsEvent =
  | { type: 'call.status'; callId: string; payload: { status: string; error?: string; } }
  | { type: 'transcript'; callId: string; payload: { speaker: 'agent' | 'restaurant'; text: string; timestamp: string } }
  | { type: 'call.result'; callId: string; payload: { success: boolean; summary: string } }
  | { type: 'audio.chunk'; callId: string; payload: ArrayBuffer };

type EventHandler = (event: WsEvent) => void;

/**
 * Connects to the backend WebSocket and calls onEvent for every message.
 * Also sets up an AudioContext to play incoming PCM chunks in real time.
 */
export function useCallStream(onEvent: EventHandler, playAudio: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  const playPcmChunk = useCallback((raw: ArrayBuffer) => {
    if (!playAudio) return;
    const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext({ sampleRate: 8000 }));

    // raw is 16-bit LE PCM at 8kHz
    const int16 = new Int16Array(raw);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 8000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
  }, [playAudio]);

  useEffect(() => {
    const url = `ws://${window.location.hostname}:${window.location.port}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (ev) => {
      // Binary frame = raw PCM audio chunk
      if (ev.data instanceof ArrayBuffer) {
        playPcmChunk(ev.data);
        return;
      }

      try {
        const msg = JSON.parse(ev.data as string) as WsEvent;
        onEvent(msg);
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = (e) => console.error('[ws]', e);

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [onEvent, playPcmChunk]);
}
