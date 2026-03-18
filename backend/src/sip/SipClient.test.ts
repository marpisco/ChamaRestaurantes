import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SIP_HOST = '192.0.2.10';
process.env.SIP_USERNAME = '1006';
process.env.SIP_PASSWORD = 'secret';
process.env.SIP_LOCAL_IP = '192.0.2.20';
process.env.GROQ_API_KEY = 'test-key';

test('sendAck reuses the INVITE CSeq number', () => {
  return import('./SipClient').then(({ SipClient }) => {
  const client = new SipClient(0);
  const messages: string[] = [];

  (client as any).send = (msg: string) => {
    messages.push(msg);
  };
  (client as any).cseq = 2;
  (client as any).toTag = 'abc123';
  (client as any).sessionUri = 'sip:1006@192.0.2.10';

  (client as any).sendAck('sip:1006@192.0.2.10');

  assert.equal(messages.length, 1);
  assert.match(messages[0], /CSeq: 1 ACK/);
  client.destroy();
  });
});
