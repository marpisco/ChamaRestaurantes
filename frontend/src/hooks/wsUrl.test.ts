import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWebSocketUrl } from './wsUrl';

test('resolveWebSocketUrl uses explicit VITE_WS_URL when provided', () => {
  const url = resolveWebSocketUrl(
    { VITE_WS_URL: 'ws://10.0.0.5:3000/ws', VITE_WS_PORT: '' },
    new URL('http://192.168.1.10:5173/app'),
  );

  assert.equal(url, 'ws://10.0.0.5:3000/ws');
});

test('resolveWebSocketUrl uses current hostname with backend port for remote dev access', () => {
  const url = resolveWebSocketUrl(
    { VITE_WS_URL: '', VITE_WS_PORT: '3000' },
    new URL('http://192.168.1.10:5173/'),
  );

  assert.equal(url, 'ws://192.168.1.10:3000/ws');
});

test('resolveWebSocketUrl falls back to same-origin when no backend port override exists', () => {
  const url = resolveWebSocketUrl(
    { VITE_WS_URL: '', VITE_WS_PORT: '' },
    new URL('https://app.example.com/dashboard'),
  );

  assert.equal(url, 'wss://app.example.com/ws');
});
