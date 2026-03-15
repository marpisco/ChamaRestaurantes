import React, { useState } from 'react';

interface Props {
  onCallStarted: (callId: string) => void;
  disabled: boolean;
}

export default function CallForm({ onCallStarted, disabled }: Props) {
  const [phone, setPhone] = useState('');
  const [people, setPeople] = useState(2);
  const [preOrder, setPreOrder] = useState('');
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
        body: JSON.stringify({ phone, people, preOrder: preOrder || undefined }),
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
          Número de telefone
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+351 912 345 678"
          required
          disabled={disabled || loading}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition disabled:bg-gray-100"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Número de pessoas
        </label>
        <select
          value={people}
          onChange={(e) => setPeople(Number(e.target.value))}
          disabled={disabled || loading}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition disabled:bg-gray-100"
        >
          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n} {n === 1 ? 'pessoa' : 'pessoas'}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Encomenda prévia <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <textarea
          value={preOrder}
          onChange={(e) => setPreOrder(e.target.value)}
          placeholder="Ex: 2 bacalhaus à brás, 1 sopa de cebola…"
          rows={3}
          disabled={disabled || loading}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition disabled:bg-gray-100 resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={disabled || loading || !phone}
        className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-2.5 text-sm transition"
      >
        {loading ? 'A iniciar chamada…' : 'Telefonar'}
      </button>
    </form>
  );
}
