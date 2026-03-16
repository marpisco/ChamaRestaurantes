import { Router, Request, Response } from 'express';
import config from '../config';
import { v4 as uuidv4 } from 'uuid';
import WebSocket, { WebSocketServer } from 'ws';
import { SipClient } from '../sip/SipClient';
import { RtpHandler } from '../sip/RtpHandler';
import { AudioPipeline } from '../audio/AudioPipeline';
import type { CallRecord, CallRequest, WsMessage } from '../types';

export const calls = new Map<string, CallRecord>();

/** Broadcast a WsMessage to all connected clients. Audio chunks are sent as binary frames. */
export function broadcast(wss: WebSocketServer, msg: WsMessage): void {
  if (msg.type === 'audio.chunk' && Buffer.isBuffer(msg.payload)) {
    // Send raw PCM as binary WebSocket frame for efficiency
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

  // POST /api/calls — start a call
  router.post('/', async (req: Request, res: Response) => {
    const { phone, people, preOrder } = req.body as CallRequest;

    if (!phone || !people) {
      return res.status(400).json({ error: 'phone and people are required' });
    }

    const id = uuidv4();
    const record: CallRecord = {
      id,
      phone,
      people,
      preOrder,
      status: 'pending',
      startedAt: new Date(),
      transcript: [],
    };
    calls.set(id, record);

    res.status(202).json({ id });

    // Run the call asynchronously
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

  // GET /api/calls — list all
  router.get('/', (_req, res) => {
    res.json([...calls.values()]);
  });

  // GET /api/calls/:id
  router.get('/:id', (req, res) => {
    const call = calls.get(req.params.id);
    if (!call) return res.status(404).json({ error: 'Not found' });
    res.json(call);
  });

  // DELETE /api/calls/:id — hang up
  router.delete('/:id', (req, res) => {
    const call = calls.get(req.params.id);
    if (!call) return res.status(404).json({ error: 'Not found' });
    call.status = 'ended';
    call.endedAt = new Date();
    res.json({ ok: true });
    broadcast(wss, { type: 'call.status', callId: req.params.id, payload: { status: 'ended' } });
  });

  return router;
}

// ─── Call orchestration ──────────────────────────────────────────────────────

async function runCall(id: string, record: CallRecord, wss: WebSocketServer): Promise<void> {
  const emit = (msg: WsMessage) => broadcast(wss, msg);
  const setStatus = (status: CallRecord['status']) => {
    record.status = status;
    emit({ type: 'call.status', callId: id, payload: { status } });
  };

  const sip = new SipClient();
  const rtpPort = await RtpHandler.allocatePort();
  const rtp = new RtpHandler(rtpPort);

  try {
    // 1. Bind SIP + RTP sockets
    console.log(`[call ${id}] a ligar sockets (SIP local :${config.sip.localPort}, RTP :${rtpPort})`);
    setStatus('registering');
    await sip.start();
    await rtp.start();

    // 2. Register SIP extension
    console.log(`[call ${id}] a registar extensão ${config.sip.username}@${config.sip.host}`);
    await sip.register();
    console.log(`[call ${id}] REGISTER OK`);

    // 3. Initiate call
    console.log(`[call ${id}] INVITE → ${record.phone}`);
    setStatus('calling');
    sip.on('ringing', () => { console.log(`[call ${id}] a tocar`); setStatus('ringing'); });

    const sdp = await sip.invite(record.phone, rtpPort);
    console.log(`[call ${id}] chamada atendida, RTP remoto: ${sdp.ip}:${sdp.port}`);
    rtp.setRemote(sdp.ip, sdp.port);

    // 4. Handle remote hang-up
    sip.once('remote_bye', () => {
      pipeline.stop();
      record.endedAt = new Date();
      setStatus('ended');
      emit({
        type: 'call.result',
        callId: id,
        payload: { success: false, summary: 'O restaurante desligou a chamada.' },
      });
    });

    setStatus('connected');

    // 5. Start audio pipeline
    const pipeline = new AudioPipeline(rtp, record.people, record.preOrder);

    pipeline.on('transcript', (line) => {
      record.transcript.push(line);
      emit({ type: 'transcript', callId: id, payload: line });
    });

    pipeline.on('audio', (pcm: Buffer) => {
      emit({ type: 'audio.chunk', callId: id, payload: pcm });
    });

    pipeline.on('outcome', async (outcome: 'confirmed' | 'rejected') => {
      const success = outcome === 'confirmed';
      const summary = success
        ? `Reserva confirmada para ${record.people} pessoas.`
        : 'Restaurante não pôde aceitar a reserva.';

      record.result = { success, summary };
      record.endedAt = new Date();

      await sip.bye();
      setStatus('ended');
      emit({ type: 'call.result', callId: id, payload: record.result });
    });

    pipeline.on('error', (err: Error) => {
      console.error(`[call ${id}] pipeline error:`, err.message);
    });

    await pipeline.start();

  } catch (err) {
    sip.destroy();
    rtp.destroy();
    throw err;
  }
}
