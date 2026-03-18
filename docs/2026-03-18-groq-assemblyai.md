# Implementação: Substituir Groq STT por AssemblyAI Streaming

**Data:** 2026-03-18
**Objetivo:** Melhorar qualidade de transcrição (STT) substituindo Groq Whisper batch por AssemblyAI Streaming com detecção de fim de turno inteligente.

---

## 1. Dependências

### 1.1 Adicionar `assemblyai` ao `backend/package.json`

```json
{
  "dependencies": {
    "assemblyai": "^4.2.0",
    ...
  }
}
```

Depois:
```bash
npm install --prefix backend
```

---

## 2. Configuração

### 2.1 `backend/.env.example`

Adicionar linha:
```
ASSEMBLYAI_API_KEY=
```

### 2.2 `backend/src/config.ts`

Adicionar ao objecto config exportado (ao lado de `groq`):
```ts
assemblyai: {
  apiKey: process.env.ASSEMBLYAI_API_KEY ?? '',
},
```

---

## 3. Codec: Upsample 8kHz → 16kHz

### 3.1 `backend/src/audio/codec.ts`

Adicionar no final do ficheiro:

```ts
/**
 * Upsample 16-bit LE PCM from srcRate to dstRate using linear interpolation.
 * Specific: 8kHz → 16kHz (dobra sample rate).
 */
export function upsample(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
  if (srcRate === dstRate) return pcm;

  const ratio = dstRate / srcRate; // e.g., 16000 / 8000 = 2
  const srcSamples = pcm.length >> 1; // PCM é 16-bit, 2 bytes por sample
  const dstSamples = Math.floor(srcSamples * ratio);
  const out = Buffer.allocUnsafe(dstSamples * 2);

  for (let i = 0; i < dstSamples; i++) {
    const srcIdx = i / ratio;
    const srcIdxFloor = Math.floor(srcIdx);
    const srcIdxCeil = Math.min(srcIdxFloor + 1, srcSamples - 1);
    const frac = srcIdx - srcIdxFloor;

    const s1 = pcm.readInt16LE(srcIdxFloor * 2);
    const s2 = pcm.readInt16LE(srcIdxCeil * 2);
    const interpolated = Math.round(s1 * (1 - frac) + s2 * frac);

    out.writeInt16LE(interpolated, i * 2);
  }

  return out;
}
```

---

## 4. STT: Substituir com AssemblyAI Streaming

### 4.1 `backend/src/ai/stt.ts` — ficheiro completo

Apagar conteúdo actual e substituir por:

```ts
import { EventEmitter } from 'events';
import { AssemblyAI } from 'assemblyai';
import { upsample } from '../audio/codec';
import config from '../config';

const client = new AssemblyAI({
  apiKey: config.assemblyai.apiKey,
});

/**
 * Streaming speech-to-text using AssemblyAI.
 * Handles upsampling from 8kHz (RTP) to 16kHz (AssemblyAI).
 * Emits 'transcript' event with the final transcribed text when turn ends.
 */
export class StreamingTranscriber extends EventEmitter {
  private transcriber: any; // AssemblyAI transcriber instance
  private isConnected = false;

  /**
   * Connect to AssemblyAI WebSocket and set up event handlers.
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      this.transcriber = client.streaming.transcriber({
        speechModel: 'universal-streaming-multilingual',
        sampleRate: 16000,
        endOfTurnConfidenceThreshold: 0.4, // Balanced mode
      });

      this.transcriber.on('error', (error: Error) => {
        console.error('[AssemblyAI STT] Error:', error.message);
        this.emit('error', error);
      });

      this.transcriber.on('turn', (turn: any) => {
        if (turn.transcript && turn.end_of_turn) {
          console.debug(`[AssemblyAI STT] Turn end: "${turn.transcript}"`);
          this.emit('transcript', turn.transcript);
        }
      });

      this.transcriber.on('close', (code: number, reason: string) => {
        console.debug(`[AssemblyAI STT] Session closed: ${code} ${reason}`);
        this.isConnected = false;
      });

      await this.transcriber.connect();
      this.isConnected = true;
      console.log('[AssemblyAI STT] Connected');
    } catch (err) {
      console.error('[AssemblyAI STT] Failed to connect:', err);
      throw err;
    }
  }

  /**
   * Send 8kHz PCM audio to AssemblyAI.
   * Upsamples to 16kHz before sending.
   */
  sendAudio(pcm8k: Buffer): void {
    if (!this.isConnected || !this.transcriber) return;

    try {
      const pcm16k = upsample(pcm8k, 8000, 16000);
      this.transcriber.stream(pcm16k);
    } catch (err) {
      console.error('[AssemblyAI STT] Failed to send audio:', err);
      this.emit('error', err as Error);
    }
  }

  /**
   * Close the WebSocket session cleanly.
   */
  async close(): Promise<void> {
    if (!this.isConnected || !this.transcriber) return;

    try {
      await this.transcriber.close();
      this.isConnected = false;
      console.log('[AssemblyAI STT] Closed');
    } catch (err) {
      console.error('[AssemblyAI STT] Failed to close:', err);
    }
  }
}
```

---

## 5. AudioPipeline: Adaptar ao Streaming STT

### 5.1 `backend/src/audio/AudioPipeline.ts`

**Remover:**
- import de `transcribe` (linha 3)
- `SILENCE_THRESHOLD_RMS = 400` (linha 9)
- `SPEECH_END_SILENCE_MS = 350` (linha 10)
- `incomingBuffer: Buffer[]` (linha 26)
- `flushTimer: NodeJS.Timeout | null` (linha 27)
- método `flushBuffer()` (linhas 70-118)
- função `rms()` (linhas 139-146)

**Adicionar:**
- import de `StreamingTranscriber` (após import de RtpHandler):
  ```ts
  import { StreamingTranscriber } from '../ai/stt';
  ```
- variável de instância:
  ```ts
  private transcriber: StreamingTranscriber | null = null;
  ```

**Modificar método `start()`:**
```ts
async start(): Promise<void> {
  // Create and connect the streaming transcriber
  this.transcriber = new StreamingTranscriber();

  // Subscribe to transcript events (when AssemblyAI detects end of turn)
  this.transcriber.on('transcript', async (text: string) => {
    if (!text) return;

    this.emit('transcript', {
      speaker: 'restaurant',
      text,
      timestamp: new Date(),
    } satisfies TranscriptLine);

    this.history.push({ role: 'user', text });

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

  try {
    await this.transcriber.connect();
  } catch (err) {
    this.emit('error', err as Error);
    return;
  }

  // Generate and send opening line (same as before)
  const opening = await getOpeningLine(this.prompt);
  this.history.push({ role: 'assistant', text: opening });
  this.emit('transcript', {
    speaker: 'agent',
    text: opening,
    timestamp: new Date(),
  } satisfies TranscriptLine);
  await this.speak(opening);
}
```

**Modificar método `stop()`:**
```ts
async stop(): Promise<void> {
  this.done = true;
  if (this.transcriber) {
    await this.transcriber.close();
    this.transcriber = null;
  }
}
```

**Modificar método `onIncomingPcm()`:**
```ts
private onIncomingPcm(pcm: Buffer): void {
  if (this.done || this.speaking) return;

  this.emit('audio', pcm);

  // Send audio to AssemblyAI streaming transcriber
  if (this.transcriber) {
    this.transcriber.sendAudio(pcm);
  }
}
```

**Remover método `flushBuffer()` completo (linhas 70-118).**

**Remover função `rms()` no fim do ficheiro (linhas 139-146).**

**Guardar função `sleep()` (é necessária para `speak()`).**

---

## 6. Testes e Verificação

### 6.1 Compilação
```bash
npm run build --prefix backend
```
Deve compilar sem erros. Se houver erros de tipo, verificar que `StreamingTranscriber` é correctamente importado e exportado.

### 6.2 Variáveis de ambiente
Garantir que `backend/.env` tem:
```
ASSEMBLYAI_API_KEY=<chave-valida-aqui>
GROQ_API_KEY=<chave-valida-aqui>
... outras vars (SIP_HOST, SIP_USERNAME, etc.)
```

### 6.3 Startup
```bash
npm run dev
```
Observar logs do terminal. Esperar por:
- `[AssemblyAI STT] Connected` quando a primeira chamada inicia
- `[AssemblyAI STT] Turn end: "..."` quando o utilizador termina um turno

### 6.4 Teste funcional
1. Abrir browser em `http://localhost:3001` (frontend Vite)
2. Preencher número e prompt
3. Fazer click em "Chamar"
4. Falar quando o agente pedir
5. Ver transcrição aparecer no `LiveMonitor` após fim de turno
6. Verificar que o agente responde correctamente
7. Confirmar que a chamada termina com `[RESERVA_CONFIRMADA]` ou `[RESERVA_REJEITADA]`

### 6.5 Debugging
Se houver problemas:
- Verificar logs: `[AssemblyAI STT]` prefix
- Confirmar que `ASSEMBLYAI_API_KEY` está correcta (sem espaços, válida)
- Verificar que `upsample()` está presente em `codec.ts`
- Testar manualmente a conexão WebSocket AssemblyAI com um pequeno script à parte

---

## 7. Rollback (se necessário)

Se algo falhar:
1. `git revert` aos commits anteriores (ou restorecenar a partir do git)
2. Groq STT original é simples e não deixa dependências presas

---

## Resumo das Mudanças

| Ficheiro | Tipo | Detalhes |
|----------|------|----------|
| `backend/package.json` | Add | `assemblyai: ^4.2.0` |
| `backend/.env.example` | Add | `ASSEMBLYAI_API_KEY` |
| `backend/src/config.ts` | Modify | Add `assemblyai.apiKey` config |
| `backend/src/audio/codec.ts` | Add | Função `upsample()` |
| `backend/src/ai/stt.ts` | Replace | Class `StreamingTranscriber` |
| `backend/src/audio/AudioPipeline.ts` | Modify | Remove batch logic, adapt para streaming |

**Ficheiros intactos:** agent.ts, tts.ts, SipClient.ts, RtpHandler.ts, calls.ts, server.ts, frontend.

---

## Notas Arquitecturais

1. **Sem batch:** Não há mais acumulação de PCM, timer de silêncio ou RMS check manual. AssemblyAI detecta fim de turno semanticamente.

2. **Gate `speaking`:** Enquanto o agente fala (`speaking=true`), não se envia áudio ao AssemblyAI. Isto evita que o agente se transcreva a si mesmo.

3. **Múltiplas chamadas:** Cada `CallRecord` cria a sua própria instância de `StreamingTranscriber`, sem partilha de estado.

4. **Português:** Modelo `universal-streaming-multilingual` suporta PT por padrão; sem configs adicionais necessárias.

5. **Tokens Groq:** STT já não usa Groq Whisper. LLM e TTS continuam com Groq (que devem ter mais tokens livres, já que STT era o mais voraz).
