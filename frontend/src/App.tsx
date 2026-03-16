import React, { useState, useCallback } from 'react';
import CallForm from './components/CallForm';
import LiveMonitor, { type CallStatus, type TranscriptEntry } from './components/LiveMonitor';
import { useCallStream, type WsEvent } from './hooks/useCallStream';

interface ActiveCall {
  id: string;
  status: CallStatus;
  transcript: TranscriptEntry[];
  result?: { success: boolean; summary: string };
  error?: string;
}

export default function App() {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [playAudio, setPlayAudio] = useState(true);

  const handleEvent = useCallback((event: WsEvent) => {
    setActiveCall((prev) => {
      if (!prev) return prev;
      if (event.callId !== prev.id) return prev;

      if (event.type === 'call.status') {
        return { ...prev, status: event.payload.status as CallStatus, error: event.payload.error };
      }
      if (event.type === 'transcript') {
        return { ...prev, transcript: [...prev.transcript, event.payload as TranscriptEntry] };
      }
      if (event.type === 'call.result') {
        return { ...prev, result: event.payload as ActiveCall['result'] };
      }
      return prev;
    });
  }, []);

  useCallStream(handleEvent, playAudio);

  function handleCallStarted(id: string) {
    setActiveCall({ id, status: 'pending', transcript: [] });
  }

  async function handleHangUp() {
    if (!activeCall) return;
    await fetch(`/api/calls/${activeCall.id}`, { method: 'DELETE' });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            📞 ChamaRestaurantes
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Agente de IA que telefona e reserva por si
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          {/* Form — show always unless call is active */}
          {(!activeCall || activeCall.status === 'ended' || activeCall.status === 'failed') && (
            <CallForm
              onCallStarted={handleCallStarted}
              disabled={false}
            />
          )}

          {/* Live monitor */}
          {activeCall && (
            <LiveMonitor
              callId={activeCall.id}
              status={activeCall.status}
              transcript={activeCall.transcript}
              result={activeCall.result}
              error={activeCall.error}
              playAudio={playAudio}
              onToggleAudio={() => setPlayAudio((p) => !p)}
              onHangUp={handleHangUp}
            />
          )}

          {/* New call button after call ends */}
          {activeCall && (activeCall.status === 'ended' || activeCall.status === 'failed') && (
            <button
              onClick={() => setActiveCall(null)}
              className="w-full rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 text-sm transition"
            >
              Nova chamada
            </button>
          )}
        </div>

        <p className="text-center text-xs text-gray-400">
          Powered by Groq · SIP/RTP UDP
        </p>
      </div>
    </div>
  );
}
