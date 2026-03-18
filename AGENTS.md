# AGENTS.md - ChamaRestaurantes

Estas instrucoes aplicam-se ao trabalho dentro deste projecto e complementam as instrucoes globais do ambiente.

## Objectivo do projecto

ChamaRestaurantes automatiza reservas telefonicas para restaurantes:

- o utilizador introduz o numero a chamar e um prompt;
- o backend faz a chamada por SIP;
- o audio e processado em RTP;
- a fala e transcrita, respondida por IA e sintetizada de volta para audio;
- o frontend mostra o estado e a transcricao em tempo real.

## Stack

- Backend: Node.js + TypeScript + Express + WebSocket + SIP/RTP sobre UDP.
- Frontend: React + TypeScript + Vite + Tailwind CSS.
- IA: AssemblyAI para STT streaming e Groq para chat e TTS.

## Mapa de ficheiros

- `backend/src/server.ts`: servidor HTTP/WS.
- `backend/src/routes/calls.ts`: API de chamadas e orquestracao.
- `backend/src/sip/SipClient.ts`: cliente SIP.
- `backend/src/sip/RtpHandler.ts`: transporte RTP.
- `backend/src/audio/AudioPipeline.ts`: pipeline de voz.
- `backend/src/audio/codec.ts`: codec G.711 e WAV.
- `backend/src/ai/agent.ts`: prompt e classificacao de resultado.
- `backend/src/ai/stt.ts`: transcricao.
- `backend/src/ai/tts.ts`: sintese.
- `frontend/src/App.tsx`: composicao principal.
- `frontend/src/components/CallForm.tsx`: submissao de chamada.
- `frontend/src/components/LiveMonitor.tsx`: monitor de estado.
- `frontend/src/hooks/useCallStream.ts`: WS + playback.

## Fluxo de execucao

1. `POST /api/calls` cria um `CallRecord` em memoria a partir de `phone` e `prompt`.
2. `runCall(...)` tenta `REGISTER`.
3. `runCall(...)` faz `INVITE`.
4. A chamada usa RTP para audio bidireccional.
5. `AudioPipeline` gera transcricoes e respostas.
6. O backend envia eventos por WebSocket.
7. `DELETE /api/calls/:id` dispara `hangup`.

## Estado e eventos

Tipos relevantes em `backend/src/types.ts`:

- `CallStatus`
- `CallRequest`
- `CallRecord`
- `TranscriptLine`
- `CallResult`
- `SdpInfo`
- `WsMessage`

Eventos WS suportados:

- `call.status`
- `transcript`
- `call.result`
- `audio.chunk`

## Regras de implementacao

- Nao introduzir persistencia ou infra extra sem pedido explicito.
- Nao substituir o fluxo existente por padroes novos sem necessidade.
- Reutilizar as estruturas actuais antes de criar novas abstracoes.
- Manter compatibilidade entre:
  - eventos backend e UI;
  - sample rate 8 kHz;
  - PCM 16-bit LE;
  - RTP PCMU payload type 0.

## Configuracao

O backend le variaveis de `backend/.env`.

Obrigatorias:

- `SIP_HOST`
- `SIP_USERNAME`
- `SIP_PASSWORD`
- `SIP_LOCAL_IP`
- `GROQ_API_KEY`
- `ASSEMBLYAI_API_KEY`

Opcionais:

- `SIP_PORT`
- `SIP_LOCAL_PORT`
- `GROQ_TTS_MODEL`
- `GROQ_TTS_VOICE`
- `PORT`

No frontend:

- `VITE_WS_URL` so e necessario quando o WS nao deve usar URL relativa.

## Comandos

Na raiz:

- `npm run install:all`
- `npm run dev`
- `npm run build`

No backend:

- `npm run dev --prefix backend`
- `npm run build --prefix backend`

No frontend:

- `npm run dev --prefix frontend`
- `npm run build --prefix frontend`

## Cuidados tecnicos

- O estado das chamadas esta em memoria, numa `Map`.
- O audio binario via WebSocket vai em frame binario, nao em JSON.
- O `AudioPipeline` depende de silencio, duracao de chunk e sincronizacao do TTS.
- O agente de IA termina a chamada so quando o texto conter:
  - `[RESERVA_CONFIRMADA]`
  - `[RESERVA_REJEITADA]`
- O modelo de chat em `backend/src/ai/agent.ts` esta hardcoded.
- O modelo de STT em `backend/src/ai/stt.ts` esta hardcoded.
- Em SIP, o `ACK` para um `200 OK` ao `INVITE` tem de reutilizar o `CSeq` do `INVITE`.
- Se o log mostrar `BYE` recebido do PBX, a chamada foi terminada pelo lado remoto e nao pelo utilizador.
- O `BYE` enviado no `finally` do backend e limpeza local; nao e a causa da terminação remota.
- Quando diagnosticar Yeastar P550 ou Asterisk, distinguir sempre:
  - `200 OK` do `INVITE`
  - `ACK` enviado pelo nosso agente
  - `BYE` recebido do PBX
  - `BYE` enviado pelo cleanup local

## Quando mexer em UI

- Confirmar que o `CallForm` continua a postar para `/api/calls`.
- Confirmar que o `useCallStream` continua a consumir `/ws`.
- Confirmar que o `LiveMonitor` continua compativel com os estados de chamada.

## Quando mexer em backend

- Validar login SIP e parsing de SDP.
- Validar RTP encode/decode.
- Validar arranque do `AudioPipeline`.
- Validar que o WebSocket continua a emitir os eventos esperados.

## Critério minimo de qualidade

Antes de considerar uma alteracao como concluida:

1. O projecto continua a compilar.
2. O fluxo de chamada continua coerente.
3. Os eventos WS continuam compativeis.
4. A documentacao reflecte a mudanca relevante.
