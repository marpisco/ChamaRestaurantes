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
    call.hangup?.(); // triggers BYE + cleanup via the runCall finally block
    res.json({ ok: true });
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

  // SIP port 0 → OS assigns a free ephemeral port (avoids EADDRINUSE)
  const sip = new SipClient(0);
  const rtpPort = await RtpHandler.allocatePort();
  const rtp = new RtpHandler(rtpPort);
  let pipeline: AudioPipeline | null = null;

  // Promise that resolves when the call should end (any reason)
  let resolveCall!: () => void;
  const callEnded = new Promise<void>((r) => { resolveCall = r; });

  const endCall = (result?: CallRecord['result']) => {
    if (record.status === 'ended') return;
    if (result) record.result = result;
    record.endedAt = new Date();
    setStatus('ended');
    if (result) emit({ type: 'call.result', callId: id, payload: result });
    pipeline?.stop();
    resolveCall();
  };

  // Expose hangup so DELETE /api/calls/:id can trigger it
  record.hangup = () => endCall();

  try {
    // 1. Bind SIP + RTP sockets
    console.log(`[call ${id}] a ligar sockets (RTP :${rtpPort})`);
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
    setStatus('connected');

    // 4. Remote hang-up
    sip.once('remote_bye', () => {
      console.log(`[call ${id}] restaurante desligou`);
      endCall({ success: false, summary: 'O restaurante desligou a chamada.' });
    });

    // 5. Audio pipeline
    pipeline = new AudioPipeline(rtp, record.people, record.preOrder);

    pipeline.on('transcript', (line) => {
      record.transcript.push(line);
      emit({ type: 'transcript', callId: id, payload: line });
    });

    pipeline.on('audio', (pcm: Buffer) => {
      emit({ type: 'audio.chunk', callId: id, payload: pcm });
    });

    pipeline.on('outcome', (outcome: 'confirmed' | 'rejected') => {
      endCall({
        success: outcome === 'confirmed',
        summary: outcome === 'confirmed'
          ? `Reserva confirmada para ${record.people} pessoas.`
          : 'Restaurante não pôde aceitar a reserva.',
      });
    });

    pipeline.on('error', (err: Error) => {
      console.error(`[call ${id}] pipeline error:`, err.message);
    });

    await pipeline.start();

    // Wait here until the call ends (hangup, remote BYE, or outcome)
    await callEnded;

  } finally {
    // Always clean up SIP + RTP sockets when the call ends for any reason
    record.hangup = undefined;
    await sip.bye().catch(() => {});
    sip.destroy();
    rtp.destroy();
    console.log(`[call ${id}] sockets fechados`);
  }
}
