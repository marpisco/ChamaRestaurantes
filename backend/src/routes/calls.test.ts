import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCallRequest } from './callRequest';

test('parseCallRequest requires phone and prompt', () => {
  assert.throws(() => parseCallRequest({ phone: '', prompt: '' }), /phone and prompt are required/i);
});
