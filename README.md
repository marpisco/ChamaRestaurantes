# ChamaRestaurantes

Aplicacao web para automatizar reservas telefonicas em restaurantes.

O utilizador preenche um formulario no frontend, o backend faz a chamada por SIP e o sistema trata a conversa em tempo real com RTP, transcricao e TTS.

## Stack

- Backend: Node.js, TypeScript, Express, WebSocket, SIP e RTP/UDP
- Frontend: React, TypeScript, Vite e Tailwind CSS
- IA: Groq para transcricao, chat e sintese de voz

## Estrutura

- `backend/`: API, WebSocket, SIP, RTP e pipeline de audio
- `frontend/`: interface React para iniciar e acompanhar chamadas
- `CLAUDE.md`: contexto tecnico para agentes
- `AGENTS.md`: regras de trabalho no projecto

## Fluxo

1. O frontend envia `POST /api/calls`.
2. O backend cria um `CallRecord` em memoria.
3. O `SipClient` faz `REGISTER` e `INVITE`.
4. O `RtpHandler` recebe audio e converte para PCM.
5. O `AudioPipeline` transcreve, pede resposta ao LLM e sintetiza audio.
6. O backend envia eventos por WebSocket.
7. O frontend mostra estado, transcricao e resultado.

## Requisitos

- Node.js 18+ recomendado
- npm
- Acesso a um servidor SIP/PBX
- Credenciais Groq

## Configuracao

Cria `backend/.env` com base em `backend/.env.example`.

### Variaveis obrigatorias

- `SIP_HOST`
- `SIP_USERNAME`
- `SIP_PASSWORD`
- `SIP_LOCAL_IP`
- `GROQ_API_KEY`

### Variaveis opcionais

- `SIP_PORT` - default `5060`
- `SIP_LOCAL_PORT` - default `5080`
- `GROQ_TTS_MODEL` - default `canopylabs/orpheus-v1-english`
- `GROQ_TTS_VOICE` - default `diana`
- `PORT` - default `3000`

### Frontend

Em desenvolvimento, o Vite faz proxy de `/api` e `/ws` para o backend.

Se necessario, define `frontend/.env.development` com:

- `VITE_WS_URL=ws://localhost:3000/ws`

## Instalação

```bash
npm run install:all
```

## Execucao

```bash
npm run dev
```

Isto arranca o backend em `http://localhost:3000` e o frontend via Vite.

## Build

```bash
npm run build
```

## Scripts

### Raiz

- `npm run dev`
- `npm run install:all`
- `npm run build`

### Backend

- `npm run dev --prefix backend`
- `npm run build --prefix backend`
- `npm run start --prefix backend`

### Frontend

- `npm run dev --prefix frontend`
- `npm run build --prefix frontend`
- `npm run preview --prefix frontend`

## API

### `POST /api/calls`

Cria uma chamada.

Body exemplo:

```json
{
  "phone": "+351912345678",
  "people": 2,
  "preOrder": "2 bacalhaus a bras"
}
```

### `GET /api/calls`

Lista chamadas em memoria.

### `GET /api/calls/:id`

Devolve uma chamada especifica.

### `DELETE /api/calls/:id`

Encerra a chamada activa.

### `GET /health`

Health check do servidor.

## WebSocket

Endpoint:

- `ws://localhost:3000/ws`

Eventos JSON:

- `call.status`
- `transcript`
- `call.result`

Audio em tempo real:

- frames binarios com PCM bruto em 16-bit LE, 8 kHz

## Limites actuais

- O estado das chamadas e guardado em memoria
- O sistema foi desenhado para um fluxo simples de uma chamada activa na interface
- O modelo de chat e o modelo de STT estao fixos no codigo
- O fim da chamada depende dos marcadores:
  - `[RESERVA_CONFIRMADA]`
  - `[RESERVA_REJEITADA]`

## Pontos principais do codigo

- `backend/src/server.ts`
- `backend/src/routes/calls.ts`
- `backend/src/sip/SipClient.ts`
- `backend/src/sip/RtpHandler.ts`
- `backend/src/audio/AudioPipeline.ts`
- `backend/src/ai/agent.ts`
- `backend/src/ai/stt.ts`
- `backend/src/ai/tts.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/CallForm.tsx`
- `frontend/src/components/LiveMonitor.tsx`
- `frontend/src/hooks/useCallStream.ts`

## Documentacao interna

- [CLAUDE.md](CLAUDE.md)
- [AGENTS.md](AGENTS.md)

