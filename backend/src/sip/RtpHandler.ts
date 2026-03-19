import dgram from 'dgram';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { ulawToPcm, pcmToUlaw } from '../audio/codec';

const RTP_HEADER_SIZE = 12;
const SAMPLE_RATE = 8000;
const PACKET_DURATION_MS = 20;
const SAMPLES_PER_PACKET = (SAMPLE_RATE * PACKET_DURATION_MS) / 1000; // 160
const ULAW_BYTES_PER_PACKET = SAMPLES_PER_PACKET; // 1 byte/sample for G.711
const PCM_BYTES_PER_PACKET = SAMPLES_PER_PACKET * 2; // 2 bytes/sample for 16-bit

/**
 * Handles RTP audio over UDP.
 *
 * Events:
 *   'pcm'  (pcm: Buffer)  – 16-bit LE PCM chunk received from remote party
 */
export class RtpHandler extends EventEmitter {
  private socket: dgram.Socket;
  private localPort: number;

  private remoteIp = '';
  private remotePort = 0;

  private seq = Math.floor(Math.random() * 0xffff);
  private timestamp = Math.floor(Math.random() * 0xffffffff);
  private ssrc = crypto.randomBytes(4).readUInt32BE(0);

  private sendTimer: NodeJS.Timeout | null = null;
  private sendQueue: Buffer[] = [];

  constructor(localPort: number) {
    super();
    this.localPort = localPort;
    this.socket = dgram.createSocket('udp4');
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.localPort, () => {
        this.socket.off('error', reject);
        this.socket.on('message', (buf) => this.onPacket(buf));
        resolve();
      });
    });
  }

  setRemote(ip: string, port: number): void {
    this.remoteIp = ip;
    this.remotePort = port;
  }

  destroy(): void {
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null; }
    try { this.socket.close(); } catch { /* ignore */ }
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  /**
   * Queue raw 16-bit LE PCM (8kHz) to be sent as RTP.
   * The audio will be chunked and sent at the correct 20ms pace.
   */
  sendPcm(pcm: Buffer): void {
    // Break into 20ms frames and push to queue
    for (let offset = 0; offset + PCM_BYTES_PER_PACKET <= pcm.length; offset += PCM_BYTES_PER_PACKET) {
      this.sendQueue.push(pcm.subarray(offset, offset + PCM_BYTES_PER_PACKET));
    }

    if (!this.sendTimer) {
      this.sendTimer = setInterval(() => this.drainQueue(), PACKET_DURATION_MS);
    }
  }

  /**
   * Stop any queued outgoing audio immediately.
   * Already-sent RTP packets cannot be recalled, but pending frames are dropped.
   */
  stopOutgoing(): void {
    this.sendQueue = [];
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  private drainQueue(): void {
    if (this.sendQueue.length === 0) {
      clearInterval(this.sendTimer!);
      this.sendTimer = null;
      return;
    }

    const frame = this.sendQueue.shift()!;
    const payload = pcmToUlaw(frame);
    const packet = this.buildRtpPacket(payload);
    this.socket.send(packet, this.remotePort, this.remoteIp);
    this.seq = (this.seq + 1) & 0xffff;
    this.timestamp = (this.timestamp + SAMPLES_PER_PACKET) >>> 0;
  }

  private buildRtpPacket(payload: Buffer): Buffer {
    const header = Buffer.alloc(RTP_HEADER_SIZE);
    header[0] = 0x80;          // V=2, P=0, X=0, CC=0
    header[1] = 0x00;          // M=0, PT=0 (PCMU)
    header.writeUInt16BE(this.seq, 2);
    header.writeUInt32BE(this.timestamp, 4);
    header.writeUInt32BE(this.ssrc, 8);
    return Buffer.concat([header, payload]);
  }

  // ─── Receiving ────────────────────────────────────────────────────────────

  private onPacket(buf: Buffer): void {
    if (buf.length < RTP_HEADER_SIZE) return;

    // Check RTP version == 2
    if ((buf[0] >> 6) !== 2) return;

    // Account for CSRC list and extension
    const cc = buf[0] & 0x0f;
    const hasExt = (buf[0] >> 4) & 0x01;
    let offset = RTP_HEADER_SIZE + cc * 4;
    if (hasExt && buf.length > offset + 4) {
      const extLen = buf.readUInt16BE(offset + 2);
      offset += 4 + extLen * 4;
    }

    const payloadType = buf[1] & 0x7f;
    if (payloadType !== 0) return; // Only PCMU (0) supported

    const payload = buf.subarray(offset);
    if (payload.length === 0) return;

    const pcm = ulawToPcm(payload);
    this.emit('pcm', pcm);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /** Allocate a free UDP port for RTP (even number for convention). */
  static async allocatePort(start = 16000): Promise<number> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      const candidate = start % 2 === 0 ? start : start + 1;
      sock.once('error', () => {
        sock.close();
        RtpHandler.allocatePort(start + 2).then(resolve).catch(reject);
      });
      sock.bind(candidate, () => {
        const { port } = sock.address() as { port: number };
        sock.close(() => resolve(port));
      });
    });
  }
}
