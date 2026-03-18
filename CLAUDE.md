# CLAUDE.md - ChamaRestaurantes

Este ficheiro descreve como este projecto esta estruturado e como deve ser tratado por agentes Codex/Claude ao fazer alteracoes.

## Resumo do projecto

ChamaRestaurantes e uma aplicacao web que:

- recebe um numero a chamar e um prompt no frontend;
- cria uma chamada telefonica de saida via SIP;
- troca audio em tempo real por RTP/UDP;
- converte fala em texto com Groq Whisper;
- gera respostas com Groq Chat;
- sintetiza audio com Groq TTS;
- mostra estado, transcricao e resultado ao utilizador via WebSocket.

O sistema esta dividido em dois blocos:

- `backend/`: API HTTP, WebSocket, SIP, RTP e pipeline de IA/audio.
- `frontend/`: UI React/Vite que inicia chamadas e acompanha o progresso.

## Estrutura relevante

- `package.json`: scripts de raiz para correr backend + frontend em paralelo.
- `backend/src/server.ts`: ponto de entrada do servidor Express + WebSocket.
- `backend/src/routes/calls.ts`: rotas de chamadas e orquestracao principal.
- `backend/src/sip/SipClient.ts`: cliente SIP minimalista sobre UDP.
- `backend/src/sip/RtpHandler.ts`: recepcao/envio RTP e codec G.711 PCMU.
- `backend/src/audio/AudioPipeline.ts`: loop de voz, STT, LLM e TTS.
- `backend/src/ai/agent.ts`: prompt e decisao de confirmacao/rejeicao.
- `backend/src/ai/stt.ts`: transcricao com Groq Whisper.
- `backend/src/ai/tts.ts`: sintese de voz com Groq Speech.
- `backend/src/audio/codec.ts`: utilitarios de codec, WAV e downsampling.
- `frontend/src/App.tsx`: estado da app e composicao da interface.
- `frontend/src/components/CallForm.tsx`: formulario para iniciar chamada.
- `frontend/src/components/LiveMonitor.tsx`: monitor em tempo real.
- `frontend/src/hooks/useCallStream.ts`: ligacao ao WebSocket e playback PCM.

## Como isto funciona

1. O utilizador submete `phone` e `prompt`.
2. O frontend faz `POST /api/calls`.
3. O backend cria um `CallRecord` em memoria e arranca `runCall(...)`.
4. O `SipClient` faz `REGISTER` e depois `INVITE`.
5. O `RtpHandler` recebe audio da chamada e emite PCM.
6. O `AudioPipeline`:
   - acumula audio;
   - filtra silencio por RMS;
   - envia o chunk para STT;
   - envia o historico para o LLM;
   - sintetiza a resposta;
   - volta a enviar audio por RTP.
7. O backend emite eventos por WebSocket:
   - `call.status`
   - `transcript`
   - `call.result`
   - `audio.chunk` em frame binario para monitorizacao.
8. O frontend actualiza estado e reproduz audio em tempo real.

## Regras de arquitectura

- Nao adicionar frameworks novos sem necessidade real.
- Reaproveitar a estrutura existente antes de introduzir padroes novos.
- Manter a chamada e o estado em memoria simples; nao existe persistencia hoje.
- Ter cuidado com timing, codecs e sample rates:
  - RTP opera em 8 kHz;
  - audio TTS/STT tem de continuar compativel com essa cadeia;
  - frontend assume PCM 16-bit LE em 8 kHz.

## Configuracao

As variaveis relevantes vivem em `backend/.env` e ha um exemplo em `backend/.env.example`.

Obrigatorias:

- `SIP_HOST`
- `SIP_USERNAME`
- `SIP_PASSWORD`
- `SIP_LOCAL_IP`
- `GROQ_API_KEY`

Opcionais:

- `SIP_PORT` (default `5060`)
- `SIP_LOCAL_PORT` (default `5080`)
- `GROQ_TTS_MODEL` (default `canopylabs/orpheus-v1-english`)
- `GROQ_TTS_VOICE` (default `diana`)
- `PORT` (default `3000`)

No frontend:

- `frontend/.env.development` pode definir `VITE_WS_URL`.
- Em desenvolvimento, o Vite faz proxy de `/api` e `/ws` para `localhost:3000`.

## Scripts uteis

Na raiz:

- `npm run install:all`
- `npm run dev`
- `npm run build`

No backend:

- `npm run dev --prefix backend`
- `npm run build --prefix backend`
- `npm run start --prefix backend`

No frontend:

- `npm run dev --prefix frontend`
- `npm run build --prefix frontend`
- `npm run preview --prefix frontend`

## Constrangimentos importantes

- O estado das chamadas e guardado em memoria; restart limpa tudo.
- O backend faz broadcast de audio para todos os clientes WS conectados.
- O modelo do agente em `backend/src/ai/agent.ts` esta fixo no codigo.
- O modelo STT em `backend/src/ai/stt.ts` esta fixo no codigo.
- A logica de fim de chamada depende de marcadores textuais:
  - `[RESERVA_CONFIRMADA]`
  - `[RESERVA_REJEITADA]`
- O sistema admite uma chamada principal activa na UI, mas o backend nao foi desenhado para persistencia ou reconciliacao de chamadas antigas.

## Ao alterar codigo

- Actualizar a documentacao se mudar o fluxo, config, estados ou scripts.
- Manter nomes de eventos e payloads consistentes entre backend e frontend.
- Validar impacto em:
  - SIP auth e SDP;
  - RTP/codec;
  - websocket binary frames;
  - UI de monitorizacao;
  - prompts e decisao do agente.

## Verificacao minima

Quando alterar funcionalidade:

1. Compilar backend e frontend.
2. Testar arranque local.
3. Confirmar que a UI continua a ligar a `/api/calls` e `/ws`.
4. Confirmar que eventos WS continuam compativeis.
