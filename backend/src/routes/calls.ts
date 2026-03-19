import { Router, Request, Response } from 'express';
import config from '../config';
import { v4 as uuidv4 } from 'uuid';
import WebSocket, { WebSocketServer } from 'ws';
import { SipClient } from '../sip/SipClient';
import { RtpHandler } from '../sip/RtpHandler';
import { AudioPipeline } from '../audio/AudioPipeline';
import type { CallRecord, CallRequest, WsMessage } from '../types';
import { parseCallRequest } from './callRequest';
import { createSingleHangup } from './hangup';

export const calls = new Map<string, CallRecord>();

/** Broadcast a WsMessage to all connected clients. Audio chunks are sent as binary frames. */
export function broadcast(wss: WebSocketServer, msg: WsMessage): void {
  if (msg.type === 'audio.chunk' && Buffer.isBuffer(msg.payload)) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg.payload as Buffer);
    });
    return;
  }
  const json = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(json);
  });
}

export function buildCallsRouter(wss: WebSocketServer): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    let callRequest: CallRequest;
    try {
      callRequest = parseCallRequest(req.body);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    const id = uuidv4();
    const record: CallRecord = {
      id,
      phone: callRequest.phone,
      prompt: callRequest.prompt,
      status: 'pending',
      startedAt: new Date(),
      transcript: [],
    };
    calls.set(id, record);

    res.status(202).json({ id });

    runCall(id, record, wss).catch((err) => {
      const message = (err as Error).message ?? String(err);
      console.error(`[call ${id}] FALHA:`, message);
      const call = calls.get(id)!;
      call.status = 'failed';
      call.error = message;
      call.endedAt = new Date();
      broadcast(wss, { type: 'call.status', callId: id, payload: { status: 'failed', error: message } });
    });
  });

  router.get('/', (_req, res) => {
    res.json([...calls.values()]);
  });

  router.get('/:id', (req, res) => {
    const call = calls.get(req.params.id);
    if (!call) return res.status(404).json({ error: 'Not found' });
    res.json(call);
  });

  router.delete('/:id', (req, res) => {
    const call = calls.get(req.params.id);
    if (!call) return res.status(404).json({ error: 'Not found' });
    call.hangup?.();
    res.json({ ok: true });
  });

  return router;
}

async function runCall(id: string, record: CallRecord, wss: WebSocketServer): Promise<void> {
  const emit = (msg: WsMessage) => broadcast(wss, msg);
  const setStatus = (status: CallRecord['status']) => {
    record.status = status;
    emit({ type: 'call.status', callId: id, payload: { status } });
  };

  const sip = new SipClient(0);
  const rtpPort = await RtpHandler.allocatePort();
  const rtp = new RtpHandler(rtpPort);
  let pipeline: AudioPipeline | null = null;
  let dialogEstablished = false;
  let remoteHangup = false;
  let ending = false;
  const requestLocalHangup = createSingleHangup(async () => {
    await sip.bye().catch(() => {});
  });

  let resolveCall!: () => void;
  const callEnded = new Promise<void>((r) => { resolveCall = r; });

  const endCall = async (
    result?: CallRecord['result'],
    options: { sendHangup?: boolean } = {},
  ): Promise<void> => {
    if (ending || record.status === 'ended') return;
    ending = true;

    if (options.sendHangup !== false && dialogEstablished && !remoteHangup) {
      await requestLocalHangup();
    }

    if (result) record.result = result;
    record.endedAt = new Date();
    setStatus('ended');
    if (result) emit({ type: 'call.result', callId: id, payload: result });
    pipeline?.stop();
    resolveCall();
  };

  record.hangup = () => {
    void endCall(undefined, { sendHangup: true });
  };

  try {
    console.log(`[call ${id}] a ligar sockets (RTP :${rtpPort})`);
    setStatus('registering');
    await sip.start();
    await rtp.start();

    console.log(`[call ${id}] a registar extensao ${config.sip.username}@${config.sip.host}`);
    await sip.register();
    console.log(`[call ${id}] REGISTER OK`);

    console.log(`[call ${id}] INVITE -> ${record.phone}`);
    setStatus('calling');
    sip.on('ringing', () => { console.log(`[call ${id}] a tocar`); setStatus('ringing'); });

    const sdp = await sip.invite(record.phone, rtpPort);
    console.log(`[call ${id}] chamada atendida, RTP remoto: ${sdp.ip}:${sdp.port}`);
    rtp.setRemote(sdp.ip, sdp.port);
    dialogEstablished = true;
    setStatus('connected');

    sip.once('remote_bye', () => {
      console.log(`[call ${id}] restaurante desligou`);
      remoteHangup = true;
      void endCall(
        { success: false, summary: 'O restaurante desligou a chamada.' },
        { sendHangup: false },
      );
    });

    pipeline = new AudioPipeline(rtp, record.prompt);

    pipeline.on('transcript', (line) => {
      record.transcript.push(line);
      emit({ type: 'transcript', callId: id, payload: line });
    });

    pipeline.on('audio', (pcm: Buffer) => {
      emit({ type: 'audio.chunk', callId: id, payload: pcm });
    });

    pipeline.on('outcome', (outcome: 'confirmed' | 'rejected') => {
      void endCall({
        success: outcome === 'confirmed',
        summary: outcome === 'confirmed'
          ? 'Reserva confirmada.'
          : 'O restaurante nao conseguiu aceitar a reserva.',
      }, { sendHangup: true });
    });

    pipeline.on('error', (err: Error) => {
      console.error(`[call ${id}] pipeline error:`, err.message);
    });

    await pipeline.start();
    await callEnded;
  } finally {
    record.hangup = undefined;
    if (dialogEstablished && !remoteHangup && record.status !== 'ended') {
      await requestLocalHangup();
    }
    sip.destroy();
    rtp.destroy();
    console.log(`[call ${id}] sockets fechados`);
  }
}
