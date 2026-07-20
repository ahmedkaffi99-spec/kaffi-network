import type { AgentRole, BlackboardMessage, BlackboardMessageType } from './types'

/**
 * Mémoire court terme partagée d'un run : un tableau noir que chaque agent
 * lit et enrichit. C'est le canal de communication inter-agents — chaque
 * agent y publie ses observations/décisions au lieu de s'adresser directement
 * à un autre agent, ce qui rend l'échange traçable et rejouable (dashboard,
 * debug, mémoire court terme persistée en fin de run).
 */
export class Blackboard {
  readonly runId: string
  private state = new Map<string, unknown>()
  private messages: BlackboardMessage[] = []
  private modelCalls = 0
  private onMessage?: (msg: BlackboardMessage) => void

  // onMessage est optionnel — câblé par l'orchestrateur pour persister chaque
  // message en direct (vue "live" du dashboard), sans que ce module générique
  // ne connaisse Supabase. Le kernel reste utilisable sans ce callback.
  constructor(runId: string, onMessage?: (msg: BlackboardMessage) => void) {
    this.runId = runId
    this.onMessage = onMessage
  }

  write<T>(key: string, value: T): void {
    this.state.set(key, value)
  }

  read<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined
  }

  post(msg: { from: AgentRole; to?: AgentRole | 'all'; type: BlackboardMessageType; content: string }): void {
    const full = { ...msg, createdAt: new Date().toISOString() }
    this.messages.push(full)
    this.onMessage?.(full)
  }

  getMessages(filter?: { from?: AgentRole; type?: BlackboardMessageType }): BlackboardMessage[] {
    if (!filter) return [...this.messages]
    return this.messages.filter(
      m => (filter.from === undefined || m.from === filter.from) && (filter.type === undefined || m.type === filter.type)
    )
  }

  /** Rendu texte des derniers messages — utilisé comme mémoire court terme dans les prompts. */
  renderRecent(limit = 8): string {
    const recent = this.messages.slice(-limit)
    if (!recent.length) return 'Aucun échange pour le moment.'
    return recent.map(m => `[${m.from} → ${m.to ?? 'crew'}] (${m.type}) ${m.content}`).join('\n')
  }

  recordModelCall(): void {
    this.modelCalls++
  }

  get modelCallCount(): number {
    return this.modelCalls
  }

  transcript(): BlackboardMessage[] {
    return [...this.messages]
  }
}
