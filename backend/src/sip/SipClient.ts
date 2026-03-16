import dgram from 'dgram';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import config from '../config';
import type { SdpInfo } from '../types';

interface PendingRequest {
  resolve: (msg: ParsedResponse) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface ParsedResponse {
  statusCode: number;
  reason: string;
  headers: Map<string, string>;
  body: string;
}

interface AuthChallenge {
  realm: string;
  nonce: string;
  headerName: string;
}

/**
 * Minimal SIP User Agent for outbound calls over UDP.
 *
 * Supports: REGISTER (with Digest auth), INVITE (with optional auth),
 * ACK, BYE. One call at a time.
 *
 * Events:
 *   'ringing'    – 180/183 received
 *   'remote_bye' – remote party hung up
 */
export class SipClient extends EventEmitter {
  private socket: dgram.Socket;
  private cseq = 1;
  private callId: string;
  private fromTag: string;
  private toTag = '';
  private pending = new Map<string, PendingRequest>();

  constructor() {
    super();
    this.socket = dgram.createSocket('udp4');
    this.callId = this.newCallId();
    this.fromTag = this.randomHex(6);
    this.socket.on('message', (buf) => this.onMessage(buf.toString()));
    this.socket.on('error', (err) => this.emit('error', err));
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      // Bind to all interfaces so we receive responses regardless of routing
      this.socket.bind(config.sip.localPort, () => {
        this.socket.off('error', reject);
        resolve();
      });
    });
  }

  destroy(): void {
    try { this.socket.close(); } catch { /* ignore */ }
  }

  // ─── Public SIP operations ────────────────────────────────────────────────

  /**
   * Attempt SIP REGISTER. If the PBX doesn't respond (timeout) or returns
   * 403/404, skip silently — many PBX have pre-configured extensions that
   * don't require registration before accepting outbound INVITEs.
   */
  async register(): Promise<void> {
    const uri = `sip:${config.sip.host}`;
    const branch = this.newBranch();
    this.send(this.buildMessage('REGISTER', uri, branch, { 'Expires': '3600' }));

    let res: ParsedResponse;
    try {
      res = await this.waitFor(branch, 5_000); // short timeout for REGISTER
    } catch {
      console.warn('[SipClient] REGISTER sem resposta — a continuar sem registo (extensão pré-configurada?)');
      return;
    }

    if (res.statusCode === 401 || res.statusCode === 407) {
      try {
        await this.sendWithAuth('REGISTER', uri, res, '');
      } catch (err) {
        console.warn('[SipClient] REGISTER auth falhou, a tentar sem registo:', (err as Error).message);
      }
    } else if (res.statusCode === 200) {
      // registered OK
    } else {
      console.warn(`[SipClient] REGISTER ${res.statusCode} ${res.reason} — a continuar sem registo`);
    }
  }

  /**
   * Send INVITE and return the remote RTP endpoint from the SDP answer.
   * @param destination  E.164 or extension number
   * @param localRtpPort Local UDP port already open for RTP
   */
  async invite(destination: string, localRtpPort: number): Promise<SdpInfo> {
    const uri = `sip:${destination}@${config.sip.host}`;
    const sdp = this.buildSdp(localRtpPort);
    const branch = this.newBranch();

    this.send(this.buildMessage('INVITE', uri, branch, {
      'Content-Type': 'application/sdp',
    }, sdp));

    const res = await this.waitFor(branch, 90_000);

    if (res.statusCode === 401 || res.statusCode === 407) {
      return this.inviteWithAuth(uri, localRtpPort, res);
    }

    if (res.statusCode !== 200) {
      throw new Error(`INVITE ${res.statusCode} ${res.reason}`);
    }

    this.captureToTag(res);
    this.sendAck(uri);
    return this.parseSdp(res.body);
  }

  async bye(): Promise<void> {
    const uri = `sip:${config.sip.host}`;
    const branch = this.newBranch();
    this.send(this.buildMessage('BYE', uri, branch));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async inviteWithAuth(uri: string, localRtpPort: number, challengeRes: ParsedResponse): Promise<SdpInfo> {
    const sdp = this.buildSdp(localRtpPort);
    const res = await this.sendWithAuth('INVITE', uri, challengeRes, sdp, {
      'Content-Type': 'application/sdp',
    });

    if (res.statusCode !== 200) throw new Error(`INVITE (auth) ${res.statusCode} ${res.reason}`);
    this.captureToTag(res);
    this.sendAck(uri);
    return this.parseSdp(res.body);
  }

  private async sendWithAuth(
    method: string,
    uri: string,
    challengeRes: ParsedResponse,
    body: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<ParsedResponse> {
    const { realm, nonce, headerName } = this.parseChallenge(challengeRes);
    const digest = this.computeDigest(realm, nonce, method, uri);
    const authValue =
      `Digest username="${config.sip.username}", realm="${realm}", ` +
      `nonce="${nonce}", uri="${uri}", response="${digest}", algorithm=MD5`;

    const branch = this.newBranch();
    this.send(this.buildMessage(method, uri, branch, {
      ...extraHeaders,
      [headerName]: authValue,
      ...(method === 'REGISTER' ? { 'Expires': '3600' } : {}),
    }, body));

    const res = await this.waitFor(branch, 30_000);
    if (res.statusCode !== 200) throw new Error(`${method} (auth) ${res.statusCode} ${res.reason}`);
    return res;
  }

  private sendAck(uri: string): void {
    const branch = this.newBranch();
    this.send(this.buildMessage('ACK', uri, branch));
  }

  // ─── Message building ─────────────────────────────────────────────────────

  private buildMessage(
    method: string,
    uri: string,
    branch: string,
    headers: Record<string, string> = {},
    body = '',
  ): string {
    const { username, host, localIp, localPort } = config.sip;
    const toUri = method === 'REGISTER' ? `sip:${username}@${host}` : uri;
    const toTag = this.toTag ? `;tag=${this.toTag}` : '';

    const lines = [
      `${method} ${uri} SIP/2.0`,
      `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch};rport`,
      `From: <sip:${username}@${host}>;tag=${this.fromTag}`,
      `To: <${toUri}>${toTag}`,
      `Call-ID: ${this.callId}`,
      `CSeq: ${this.cseq++} ${method}`,
      `Contact: <sip:${username}@${localIp}:${localPort}>`,
      `Max-Forwards: 70`,
      `User-Agent: ChamaRestaurantes/1.0`,
    ];

    for (const [k, v] of Object.entries(headers)) {
      lines.push(`${k}: ${v}`);
    }

    lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
    lines.push('', body);
    return lines.join('\r\n');
  }

  private buildSdp(rtpPort: number): string {
    const { localIp } = config.sip;
    const ts = Date.now();
    return [
      'v=0',
      `o=- ${ts} ${ts} IN IP4 ${localIp}`,
      's=ChamaRestaurantes',
      `c=IN IP4 ${localIp}`,
      't=0 0',
      `m=audio ${rtpPort} RTP/AVP 0`,
      'a=rtpmap:0 PCMU/8000',
      'a=sendrecv',
      '',
    ].join('\r\n');
  }

  // ─── Message receiving ────────────────────────────────────────────────────

  private onMessage(text: string): void {
    if (text.startsWith('SIP/2.0')) {
      this.handleResponse(text);
    } else {
      this.handleRequest(text);
    }
  }

  private handleResponse(text: string): void {
    let res: ParsedResponse;
    try { res = this.parseResponse(text); } catch { return; }

    if (res.statusCode === 180 || res.statusCode === 183) {
      this.emit('ringing');
    }

    if (res.statusCode >= 200) {
      const branch = this.extractBranch(res.headers.get('via') ?? '');
      const pending = this.pending.get(branch);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(branch);
        pending.resolve(res);
      }
    }
  }

  private handleRequest(text: string): void {
    const firstLine = text.split('\r\n')[0];
    if (firstLine.startsWith('BYE ')) {
      // Reply 200 OK then emit event
      const headers = this.parseHeaders(text);
      const via = headers.get('via') ?? '';
      const callId = headers.get('call-id') ?? '';
      const cseq = headers.get('cseq') ?? '';

      const response = [
        'SIP/2.0 200 OK',
        `Via: ${via}`,
        `From: ${headers.get('from') ?? ''}`,
        `To: ${headers.get('to') ?? ''}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq}`,
        'Content-Length: 0',
        '',
        '',
      ].join('\r\n');

      this.send(response);
      this.emit('remote_bye');
    }
  }

  // ─── Parsing ──────────────────────────────────────────────────────────────

  private parseResponse(text: string): ParsedResponse {
    const lines = text.split('\r\n');
    const m = lines[0].match(/^SIP\/2\.0 (\d+) (.+)$/);
    if (!m) throw new Error('Not a SIP response');
    const headers = this.parseHeaders(text);
    const blankIdx = lines.findIndex((l) => l === '');
    const body = blankIdx >= 0 ? lines.slice(blankIdx + 1).join('\r\n') : '';
    return { statusCode: parseInt(m[1]), reason: m[2], headers, body };
  }

  private parseHeaders(text: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = text.split('\r\n');
    let inBody = false;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '') { inBody = true; break; }
      if (inBody) break;
      const colon = lines[i].indexOf(':');
      if (colon > 0) {
        map.set(lines[i].substring(0, colon).trim().toLowerCase(), lines[i].substring(colon + 1).trim());
      }
    }
    return map;
  }

  private parseSdp(sdp: string): SdpInfo {
    let ip = '';
    let port = 0;
    let codec = 0;
    for (const line of sdp.split('\r\n')) {
      if (line.startsWith('c=IN IP4 ')) ip = line.slice(9).trim();
      if (line.startsWith('m=audio ')) {
        const parts = line.split(' ');
        port = parseInt(parts[1]);
        codec = parseInt(parts[3] ?? '0');
      }
    }
    if (!ip || !port) throw new Error('SDP missing connection/media info');
    return { ip, port, codec };
  }

  private parseChallenge(res: ParsedResponse): AuthChallenge {
    const headerName = res.statusCode === 407 ? 'proxy-authorization' : 'authorization';
    const challengeHeader = res.statusCode === 407
      ? (res.headers.get('proxy-authenticate') ?? '')
      : (res.headers.get('www-authenticate') ?? '');

    const realm = challengeHeader.match(/realm="([^"]+)"/)?.[1] ?? '';
    const nonce = challengeHeader.match(/nonce="([^"]+)"/)?.[1] ?? '';
    const replyHeader = res.statusCode === 407 ? 'Proxy-Authorization' : 'Authorization';
    return { realm, nonce, headerName: replyHeader };
  }

  private captureToTag(res: ParsedResponse): void {
    const to = res.headers.get('to') ?? '';
    this.toTag = to.match(/tag=([^;,\s]+)/)?.[1] ?? '';
  }

  private extractBranch(via: string): string {
    return via.match(/branch=([^;,\s]+)/)?.[1] ?? '';
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  private computeDigest(realm: string, nonce: string, method: string, uri: string): string {
    const { username, password } = config.sip;
    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
    return crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
  }

  // ─── Transport ────────────────────────────────────────────────────────────

  private send(msg: string): void {
    const buf = Buffer.from(msg);
    this.socket.send(buf, config.sip.port, config.sip.host);
  }

  private waitFor(branch: string, timeoutMs = 10_000): Promise<ParsedResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(branch);
        reject(new Error(`SIP timeout waiting for branch ${branch}`));
      }, timeoutMs);
      this.pending.set(branch, { resolve, reject, timer });
    });
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private newBranch(): string {
    return `z9hG4bK${this.randomHex(8)}`;
  }

  private newCallId(): string {
    return `${this.randomHex(8)}@${config.sip.localIp}`;
  }

  private randomHex(bytes: number): string {
    return crypto.randomBytes(bytes).toString('hex');
  }
}
