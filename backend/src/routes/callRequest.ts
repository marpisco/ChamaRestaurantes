import type { CallRequest } from '../types';

export function parseCallRequest(body: unknown): CallRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('phone and prompt are required');
  }

  const payload = body as Record<string, unknown>;
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';

  if (!phone || !prompt) {
    throw new Error('phone and prompt are required');
  }

  return { phone, prompt };
}
