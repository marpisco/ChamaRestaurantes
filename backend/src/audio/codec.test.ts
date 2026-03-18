import test from 'node:test';
import assert from 'node:assert/strict';
import { upsample } from './codec';

test('upsample doubles 8kHz PCM sample count when converting to 16kHz', () => {
  const pcm8k = Buffer.allocUnsafe(8);
  pcm8k.writeInt16LE(0, 0);
  pcm8k.writeInt16LE(1000, 2);
  pcm8k.writeInt16LE(-1000, 4);
  pcm8k.writeInt16LE(500, 6);

  const pcm16k = upsample(pcm8k, 8000, 16000);

  assert.equal(pcm16k.length, pcm8k.length * 2);
  assert.equal(pcm16k.readInt16LE(0), 0);
  assert.equal(pcm16k.readInt16LE(2), 500);
  assert.equal(pcm16k.readInt16LE(4), 1000);
});
