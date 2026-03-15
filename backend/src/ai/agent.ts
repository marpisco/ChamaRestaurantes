import Groq from 'groq-sdk';
import config from '../config';

const groq = new Groq({ apiKey: config.groq.apiKey });

export type AgentOutcome = 'confirmed' | 'rejected' | 'ongoing';

export interface AgentMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentReply {
  text: string;
  outcome: AgentOutcome;
}

function buildSystemPrompt(people: number, preOrder?: string): string {
  const preOrderLine = preOrder
    ? `\nO cliente quer fazer a seguinte encomenda prévia: "${preOrder}".`
    : '';

  return `És um assistente que telefona a restaurantes em nome de um cliente português para fazer uma reserva.

Detalhes da reserva:
- Número de pessoas: ${people}${preOrderLine}

Instruções:
- Fala sempre em português europeu (PT-PT), de forma educada, natural e concisa.
- Apresenta-te como assistente do cliente e pede uma reserva para hoje à noite, ou pergunta quando têm disponibilidade.
- Se o restaurante fizer perguntas (nome, hora, etc.), responde de forma razoável (usa "Cliente" como nome, escolhe uma hora razoável).
- Se tiveres encomenda prévia, menciona-a quando a reserva estiver encaminhada.
- Quando a reserva estiver confirmada, termina a conversa com exatamente: [RESERVA_CONFIRMADA]
- Se o restaurante não puder aceitar (lotado, encerrado, etc.), agradece e termina com: [RESERVA_REJEITADA]
- Não uses calões, gírias ou expressões brasileiras.`;
}

/**
 * Generate the next agent utterance given the conversation history.
 */
export async function getNextReply(
  history: AgentMessage[],
  people: number,
  preOrder?: string,
): Promise<AgentReply> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(people, preOrder) },
    ...history.map((m) => ({ role: m.role, content: m.text })),
  ];

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
export async function getOpeningLine(people: number, preOrder?: string): Promise<string> {
  const reply = await getNextReply([], people, preOrder);
  return reply.text;
}
