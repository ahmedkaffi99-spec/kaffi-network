'use client'

import { useState } from 'react'

interface Props {
  sessionId: string
}

type ChatAgent = 'analyst' | 'writer'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const AGENTS: { value: ChatAgent; label: string; icon: string }[] = [
  { value: 'analyst', label: "l'Analyste", icon: '🔎' },
  { value: 'writer', label: 'le Rédacteur', icon: '✍️' },
]

// Discussion ad-hoc ancrée dans les données réelles de CETTE session (voir
// app/api/sessions/[id]/chat/route.ts) — pour comprendre un choix, pas pour
// le modifier : aucune action ici ne change le combiné ou le post existant.
export function SessionChat({ sessionId }: Props) {
  const [agent, setAgent] = useState<ChatAgent>('analyst')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, message: text, history: messages }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur de discussion')
      setMessages([...nextMessages, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de discussion')
    } finally {
      setLoading(false)
    }
  }

  function switchAgent(next: ChatAgent) {
    if (next === agent) return
    setAgent(next)
    setMessages([])
    setError(null)
  }

  return (
    <div className="bg-navy-800/60 border border-navy-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-navy-700/50 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-white text-sm">Discuter de ce combiné</h2>
        <div className="flex items-center gap-1 p-1 bg-navy-900/60 border border-navy-700/50 rounded-lg">
          {AGENTS.map(a => (
            <button
              key={a.value}
              onClick={() => switchAgent(a.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                agent === a.value ? 'bg-gold-500/15 text-gold-400 border border-gold-500/30' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-gray-600 text-sm">
            Pose une question à {AGENTS.find(a => a.value === agent)?.label} sur ce combiné — pourquoi tel pick, pourquoi tel autre a été écarté, etc.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user' ? 'bg-gold-500/15 text-gold-100 border border-gold-500/20' : 'bg-navy-900/60 text-gray-300 border border-navy-700/40'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-navy-900/60 border border-navy-700/40 rounded-xl px-3.5 py-2.5 text-sm text-gray-500">
              {AGENTS.find(a => a.value === agent)?.label} réfléchit…
            </div>
          </div>
        )}
      </div>

      {error && <div className="px-4 pb-2 text-xs text-red-400">{error}</div>}

      <div className="p-3 border-t border-navy-700/50 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ta question..."
          disabled={loading}
          className="flex-1 px-3.5 py-2.5 bg-navy-900 border border-navy-700 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500/50 transition disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-navy-950 font-semibold rounded-xl text-sm transition"
        >
          Envoyer
        </button>
      </div>
    </div>
  )
}
