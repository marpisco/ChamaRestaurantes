import React, { useState } from 'react';

const DEFAULT_PROMPT = 'Liga ao restaurante x, para reservar uma mesa com x pessoas, e deixa a reserva em nome de x.';

interface Props {
  onCallStarted: (callId: string) => void;
  disabled: boolean;
}

export default function CallForm({ onCallStarted, disabled }: Props) {
  const [phone, setPhone] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, prompt }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Erro desconhecido');
      }
      const { id } = await res.json();
      onCallStarted(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Numero a chamar
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="00351912345678"
          required
          disabled={disabled || loading}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition disabled:bg-gray-100"
        />
        <p className="text-xs text-gray-500 mt-1 text-muted">
          Cuidado! Não utilizar +, utilizar sempre 00. Não é obrigatório código de país/região para Portugal.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Prompt da chamada
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          required
          disabled={disabled || loading}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition disabled:bg-gray-100 resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={disabled || loading || !phone || !prompt.trim()}
        className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-2.5 text-sm transition"
      >
        {loading ? 'A iniciar chamada...' : 'Telefonar'}
      </button>
    </form>
  );
}
