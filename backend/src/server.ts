import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import config from './config';
import { buildCallsRouter } from './routes/calls';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  ws.on('close', () => console.log('[ws] client disconnected'));
  ws.on('error', (err) => console.error('[ws] error:', err.message));
});

app.use('/api/calls', buildCallsRouter(wss));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

server.listen(config.port, () => {
  console.log(`ChamaRestaurantes backend listening on http://localhost:${config.port}`);
  console.log(`WebSocket endpoint: ws://localhost:${config.port}/ws`);
});
