const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const PLANNER_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
]

const ANALYST_MODELS = [
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
]

const WRITER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-26b-a4b-it:free',
]

const SUPERVISOR_MODELS = [
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
]

const CLAUDE_FALLBACK = 'claude-haiku-4-5-20251001'

export type AgentRole = 'planner' | 'analyst' | 'writer' | 'supervisor'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface RouterResult {
  text: string
  model_used: string
}

async function callOpenRouter(
  model: string,
  system: string,
  messages: Message[],
  maxTokens: number
): Promise<string | null> {
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY!}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kaffi-network.vercel.app',
        'X-Title': 'Kaffi Network',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })

    if (res.status === 429 || res.status >= 500) return null

    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    return typeof text === 'string' && text.trim() ? text.trim() : null
  } catch {
    return null
  }
}

async function callClaude(
  system: string,
  messages: Message[],
  maxTokens: number
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const msg = await client.messages.create({
    model: CLAUDE_FALLBACK,
    max_tokens: maxTokens,
    system,
    messages: messages as Array<{ role: 'user' | 'assistant'; content: string }>,
  })

  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
}

export async function routeCompletion(
  role: AgentRole,
  system: string,
  userMessage: string,
  maxTokens = 1024
): Promise<RouterResult> {
  const models =
    role === 'planner' ? PLANNER_MODELS :
    role === 'writer' ? WRITER_MODELS :
    role === 'supervisor' ? SUPERVISOR_MODELS :
    ANALYST_MODELS
  const messages: Message[] = [{ role: 'user', content: userMessage }]

  for (const model of models) {
    const text = await callOpenRouter(model, system, messages, maxTokens)
    if (text) return { text, model_used: model }
  }

  // Fallback Claude
  const text = await callClaude(system, messages, maxTokens)
  return { text, model_used: CLAUDE_FALLBACK }
}
