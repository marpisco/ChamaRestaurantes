import Groq from 'groq-sdk';
import config from '../config';
import { buildAgentMessages, SYSTEM_PROMPT, type AgentMessage } from './prompt';

const groq = new Groq({ apiKey: config.groq.apiKey });

export type AgentOutcome = 'confirmed' | 'rejected' | 'ongoing';

export interface AgentReply {
  text: string;
  outcome: AgentOutcome;
}

/**
 * Generate the next agent utterance given the conversation history.
 */
export async function getNextReply(
  history: AgentMessage[],
  prompt: string,
): Promise<AgentReply> {
  const messages = buildAgentMessages(prompt, history);

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.4,
    max_tokens: 200,
  });

  const raw = completion.choices[0]?.message?.content ?? '';

  let outcome: AgentOutcome = 'ongoing';
  let text = raw;

  if (raw.includes('[RESERVA_CONFIRMADA]')) {
    outcome = 'confirmed';
    text = raw.replace('[RESERVA_CONFIRMADA]', '').trim();
  } else if (raw.includes('[RESERVA_REJEITADA]')) {
    outcome = 'rejected';
    text = raw.replace('[RESERVA_REJEITADA]', '').trim();
  }

  return { text: text || raw, outcome };
}

/**
 * Generate the opening line the agent will say when the call is answered.
 */
export async function getOpeningLine(prompt: string): Promise<string> {
  const reply = await getNextReply([], prompt);
  return reply.text;
}

export { SYSTEM_PROMPT };
export type { AgentMessage } from './prompt';
