import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleHangup } from './hangup';

test('createSingleHangup only sends BYE once even if requested multiple times', async () => {
  let sends = 0;
  const hangup = createSingleHangup(async () => {
    sends += 1;
  });

  await Promise.all([hangup(), hangup(), hangup()]);

  assert.equal(sends, 1);
});

test('createSingleHangup waits for the first BYE attempt to finish', async () => {
  const steps: string[] = [];
  let resolveSend!: () => void;

  const hangup = createSingleHangup(() => new Promise<void>((resolve) => {
    steps.push('send');
    resolveSend = () => {
      steps.push('resolved');
      resolve();
    };
  }));

  const first = hangup().then(() => steps.push('first-done'));
  const second = hangup().then(() => steps.push('second-done'));

  steps.push('pending');
  resolveSend();

  await Promise.all([first, second]);

  assert.deepEqual(steps, ['send', 'pending', 'resolved', 'first-done', 'second-done']);
});
