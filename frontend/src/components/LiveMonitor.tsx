import React from 'react';

export type CallStatus =
  | 'pending' | 'registering' | 'calling' | 'ringing'
  | 'connected' | 'ended' | 'failed';

export interface TranscriptEntry {
  speaker: 'agent' | 'restaurant';
  text: string;
  timestamp: string;
}

interface Props {
  callId: string;
  status: CallStatus;
  transcript: TranscriptEntry[];
  result?: { success: boolean; summary: string };
  playAudio: boolean;
  onToggleAudio: () => void;
  onHangUp: () => void;
}

const STATUS_LABEL: Record<CallStatus, string> = {
  pending: 'A preparar…',
  registering: 'A registar extensão SIP…',
  calling: 'A marcar…',
  ringing: 'A tocar…',
  connected: 'Em chamada',
  ended: 'Chamada terminada',
  failed: 'Falha na chamada',
};

const STATUS_COLOR: Record<CallStatus, string> = {
  pending: 'bg-gray-400',
  registering: 'bg-yellow-400',
  calling: 'bg-blue-400',
  ringing: 'bg-blue-500 animate-pulse',
  connected: 'bg-green-500 animate-pulse',
  ended: 'bg-gray-500',
  failed: 'bg-red-500',
};

export default function LiveMonitor({
  callId, status, transcript, result, playAudio, onToggleAudio, onHangUp,
}: Props) {
  const isActive = status === 'calling' || status === 'ringing' || status === 'connected';

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`inline-block w-3 h-3 rounded-full ${STATUS_COLOR[status]}`} />
          <span className="text-sm font-medium text-gray-700">{STATUS_LABEL[status]}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleAudio}
            title={playAudio ? 'Silenciar monitorização' : 'Ouvir chamada'}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 transition"
          >
            {playAudio ? '🔊 A ouvir' : '🔇 Silenciado'}
          </button>
          {isActive && (
            <button
              onClick={onHangUp}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white transition"
            >
              Desligar
            </button>
          )}
        </div>
      </div>

      {/* Call ID */}
      <p className="text-xs text-gray-400 font-mono truncate">ID: {callId}</p>

      {/* Result banner */}
      {result && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {result.success ? '✅' : '❌'} {result.summary}
        </div>
      )}

      {/* Transcript */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Transcrição</span>
        </div>
        <div className="h-72 overflow-y-auto p-4 space-y-3 bg-white">
          {transcript.length === 0 ? (
            <p className="text-sm text-gray-400 text-center mt-8">
              {isActive ? 'À espera de áudio…' : 'Sem transcrição'}
            </p>
          ) : (
            transcript.map((line, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${line.speaker === 'agent' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-snug ${
                    line.speaker === 'agent'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}
                >
                  <p>{line.text}</p>
                  <p className={`text-[10px] mt-0.5 ${line.speaker === 'agent' ? 'text-indigo-200' : 'text-gray-400'}`}>
                    {line.speaker === 'agent' ? 'Agente' : 'Restaurante'}
                    {' · '}
                    {new Date(line.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
