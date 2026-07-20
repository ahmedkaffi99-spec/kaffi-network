'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AgentMessageRow } from '@/lib/types'
import { MESSAGE_TYPE_STYLES } from '@/lib/utils'

interface Props {
  runId: string
  // true tant que le run tourne encore côté serveur — arrête le polling une
  // fois false, mais garde les messages déjà reçus affichés.
  active: boolean
  onClose?: () => void
}

const POLL_MS = 1500

// Alimenté par lib/agent-kernel/memory.ts:persistLiveMessage, câblé dans
// lib/orchestrator.ts — chaque agent poste sur le blackboard, et ce poll
// affiche les lignes au fur et à mesure qu'elles arrivent en base, pendant
// que le run tourne encore côté serveur (pas d'attente de la fin du run).
export function LiveAgentJournal({ runId, active, onClose }: Props) {
  const [messages, setMessages] = useState<AgentMessageRow[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const supabase = createClient()

    async function poll() {
      const { data } = await supabase
        .from('agent_messages')
        .select('*')
        .eq('run_id', runId)
        .order('created_at', { ascending: true })

      if (!cancelled && data) setMessages(data as AgentMessageRow[])
      if (!cancelled && active) timer = setTimeout(poll, POLL_MS)
    }

    poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [runId, active])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="bg-navy-800/60 border border-navy-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-navy-700/50 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          {active && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-500" />
            </span>
          )}
          <h2 className="font-semibold text-white text-sm">
            {active ? 'Les agents travaillent en direct…' : 'Journal du dernier run'}
          </h2>
        </div>
        {!active && onClose && (
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-sm transition" aria-label="Fermer">
            ✕
          </button>
        )}
      </div>
      <div ref={scrollRef} className="p-4 space-y-1.5 max-h-80 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-gray-600 text-sm">En attente du premier message…</p>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className="flex items-start gap-3 text-sm py-1">
              <span className="text-xs text-gray-600 mt-0.5 flex-shrink-0 font-mono">
                {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-xs text-gray-500 flex-shrink-0 w-24 truncate">
                {msg.from_role}{msg.to_role ? ` → ${msg.to_role}` : ''}
              </span>
              <span className={`text-xs uppercase tracking-wide flex-shrink-0 w-20 ${MESSAGE_TYPE_STYLES[msg.type] ?? 'text-gray-400'}`}>
                {msg.type}
              </span>
              <span className="text-gray-300 flex-1">{msg.content}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
