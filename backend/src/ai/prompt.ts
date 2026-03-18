export interface AgentMessage {
  role: 'user' | 'assistant';
  text: string;
}

export const SYSTEM_PROMPT = [
  'Es um agente telefonico a falar ao telefone com um restaurante.',
  'Estas numa chamada de voz e deves agir como um assistente humano que faz reservas.',
  'Segue estritamente o prompt do utilizador e nao desvias o tema da conversa.',
  'Fala sempre em portugues europeu, com linguagem natural, clara e concisa.',
  'Nao uses markdown, emojis, listas, cabecalhos, baloes decorativos ou caracteres especiais fora da escrita normal.',
  'Responde apenas com texto simples.',
  'Se precisares de clarificar algo, faz no maximo uma pergunta curta e relevante.',
  'Se a reserva ficar confirmada termina exatamente com: [RESERVA_CONFIRMADA]',
  'Se o restaurante nao puder aceitar termina exatamente com: [RESERVA_REJEITADA]',
].join(' ');

export function buildAgentMessages(
  userPrompt: string,
  history: AgentMessage[] = [],
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt.trim() },
    ...history.map((message) => ({ role: message.role, content: message.text })),
  ];
}
