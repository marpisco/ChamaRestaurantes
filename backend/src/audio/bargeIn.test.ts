import test from 'node:test';
import assert from 'node:assert/strict';
import { BargeInDetector } from './bargeIn';

function createFrame(sampleValue: number, samples = 160): Buffer {
  const frame = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    frame.writeInt16LE(sampleValue, i * 2);
  }
  return frame;
}

test('BargeInDetector ignores short noise bursts while the agent is speaking', () => {
  const detector = new BargeInDetector({
    rmsThreshold: 1200,
    minConsecutiveSpeechFrames: 3,
    maxBufferedFrames: 10,
  });

  assert.equal(detector.observe(createFrame(2000)).shouldInterrupt, false);
  assert.equal(detector.observe(createFrame(100)).shouldInterrupt, false);
  assert.equal(detector.observe(createFrame(2100)).shouldInterrupt, false);
});

test('BargeInDetector interrupts after sustained overlapping speech and returns buffered audio', () => {
  const detector = new BargeInDetector({
    rmsThreshold: 1200,
    minConsecutiveSpeechFrames: 3,
    maxBufferedFrames: 10,
  });

  detector.observe(createFrame(80));
  detector.observe(createFrame(1800));
  detector.observe(createFrame(2000));
  const result = detector.observe(createFrame(2200));

  assert.equal(result.shouldInterrupt, true);
  assert.ok(result.bufferedAudio);
  assert.equal(result.bufferedAudio?.length, 4 * 320);
});

test('BargeInDetector only keeps the most recent rolling audio window', () => {
  const detector = new BargeInDetector({
    rmsThreshold: 1200,
    minConsecutiveSpeechFrames: 3,
    maxBufferedFrames: 2,
  });

  detector.observe(createFrame(90));
  detector.observe(createFrame(100));
  const result = detector.observe(createFrame(2000));

  assert.equal(result.shouldInterrupt, false);
  assert.equal(detector.drainBufferedAudio()?.length, 2 * 320);
});
