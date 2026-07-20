'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  sessionId: string
  // Appliquer un changement n'a de sens que tant que rien n'est encore
  // approuvé/publié — une capture 1xBet réelle a pu être envoyée entre-temps.
  editable: boolean
}

type ChatAgent = 'analyst' | 'writer'

type ProposedChange =
  | { type: 'rewrite_post'; new_text: string }
  | { type: 'remove_pick'; home_team: string; away_team: string; bet_type: string }

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  proposedChange?: ProposedChange | null
  applyState?: 'idle' | 'applying' | 'applied' | 'error'
  applyError?: string
}

const AGENTS: { value: ChatAgent; label: string; icon: string }[] = [
  { value: 'analyst', label: "l'Analyste", icon: '🔎' },
  { value: 'writer', label: 'le Rédacteur', icon: '✍️' },
]

function describeChange(change: ProposedChange): string {
  if (change.type === 'rewrite_post') return 'Réécrire le post Telegram'
  return `Retirer ${change.home_team} vs ${change.away_team} (${change.bet_type}) du combiné`
}

// Discussion ancrée dans les données réelles de CETTE session (voir
// app/api/sessions/[id]/chat/route.ts). Le modèle peut PROPOSER un
// changement, mais seul le clic sur "Appliquer ce changement" l'exécute
// réellement (app/api/sessions/[id]/apply-change) — jamais automatique.
export function SessionChat({ sessionId, editable }: Props) {
  const [agent, setAgent] = useState<ChatAgent>('analyst')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

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
      setMessages([
        ...nextMessages,
        { role: 'assistant', content: data.reply, proposedChange: data.proposed_change ?? null, applyState: 'idle' },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de discussion')
    } finally {
      setLoading(false)
    }
  }

  async function handleApply(index: number, change: ProposedChange) {
    setMessages(prev => prev.map((m, i) => (i === index ? { ...m, applyState: 'applying', applyError: undefined } : m)))

    try {
      const res = await fetch(`/api/sessions/${sessionId}/apply-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Échec de l\'application')

      setMessages(prev => prev.map((m, i) => (i === index ? { ...m, applyState: 'applied' } : m)))
      router.refresh()
    } catch (err) {
      setMessages(prev =>
        prev.map((m, i) =>
          i === index ? { ...m, applyState: 'error', applyError: err instanceof Error ? err.message : 'Échec de l\'application' } : m
        )
      )
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

      <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-gray-600 text-sm">
            Pose une question à {AGENTS.find(a => a.value === agent)?.label} sur ce combiné, ou demande-lui directement un changement
            {editable ? ' (ex: "retire le pick PSG-Barça", "réécris le post en plus court")' : ''}.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-gold-500/15 text-gold-100 border border-gold-500/20' : 'bg-navy-900/60 text-gray-300 border border-navy-700/40'
                }`}
              >
                {m.content}
              </div>
              {m.proposedChange && (
                <div className="mt-1.5 max-w-[85%]">
                  {!editable ? (
                    <p className="text-xs text-gray-600 italic">
                      Session non modifiable ({describeChange(m.proposedChange).toLowerCase()} proposé, mais déjà approuvée/publiée/rejetée).
                    </p>
                  ) : m.applyState === 'applied' ? (
                    <p className="text-xs text-emerald-400">✓ Appliqué — {describeChange(m.proposedChange).toLowerCase()}</p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleApply(i, m.proposedChange!)}
                        disabled={m.applyState === 'applying'}
                        className="px-3 py-1.5 bg-gold-500/15 hover:bg-gold-500/25 border border-gold-500/30 text-gold-400 text-xs font-medium rounded-lg transition disabled:opacity-50"
                      >
                        {m.applyState === 'applying' ? '...' : `✓ Appliquer : ${describeChange(m.proposedChange)}`}
                      </button>
                      {m.applyState === 'error' && <span className="text-xs text-red-400">{m.applyError}</span>}
                    </div>
                  )}
                </div>
              )}
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
          placeholder="Ta question ou ta demande..."
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
