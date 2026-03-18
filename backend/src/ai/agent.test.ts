import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentMessages, SYSTEM_PROMPT } from './prompt';

test('buildAgentMessages injects the fixed system prompt and user prompt first', () => {
  const messages = buildAgentMessages('Liga para o restaurante X', [
    { role: 'assistant', text: 'Boa tarde' },
  ]);

  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[0]?.content, SYSTEM_PROMPT);
  assert.equal(messages[1]?.role, 'user');
  assert.equal(messages[1]?.content, 'Liga para o restaurante X');
  assert.equal(messages[2]?.role, 'assistant');
  assert.equal(messages[2]?.content, 'Boa tarde');
});
