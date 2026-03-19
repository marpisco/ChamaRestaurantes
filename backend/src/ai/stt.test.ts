import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioChunkBuffer } from './stt';

test('AudioChunkBuffer emits a 100ms chunk after five 20ms RTP frames', () => {
  const buffer = new AudioChunkBuffer(1600, 800);
  const frame = Buffer.alloc(320);

  for (let i = 0; i < 4; i++) {
    buffer.push(frame);
  }

  assert.equal(buffer.drainReadyChunks().length, 0);

  buffer.push(frame);
  const chunks = buffer.drainReadyChunks();

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 1600);
  assert.equal(buffer.pendingBytes(), 0);
});

test('AudioChunkBuffer flushes trailing audio once it reaches the minimum 50ms size', () => {
  const buffer = new AudioChunkBuffer(1600, 800);
  const frame = Buffer.alloc(320);

  buffer.push(frame);
  buffer.push(frame);
  buffer.push(frame);

  const chunk = buffer.flushPendingChunk();

  assert.notEqual(chunk, null);
  assert.equal(chunk?.length, 960);
  assert.equal(buffer.pendingBytes(), 0);
});

test('AudioChunkBuffer flushes a buffered 50ms+ partial chunk when streaming becomes ready', () => {
  const buffer = new AudioChunkBuffer(1600, 800);
  const frame = Buffer.alloc(320);

  buffer.push(frame);
  buffer.push(frame);
  buffer.push(frame);
  buffer.push(frame);

  const chunks = buffer.drainChunksWhenStreamBecomesReady();

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 1280);
  assert.equal(buffer.pendingBytes(), 0);
});
