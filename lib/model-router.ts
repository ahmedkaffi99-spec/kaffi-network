import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY!,
  headers: {
    'HTTP-Referer': 'https://kaffi-network.vercel.app',
    'X-Title': 'Kaffi Network',
  },
})

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

export type AgentRole = 'planner' | 'analyst' | 'writer' | 'supervisor'

interface RouterResult {
  text: string
  model_used: string
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

  for (const model of models) {
    try {
      const { text } = await generateText({
        model: openrouter(model),
        system,
        prompt: userMessage,
        maxOutputTokens: maxTokens,
        abortSignal: AbortSignal.timeout(25000),
      })
      if (text?.trim()) return { text: text.trim(), model_used: model }
    } catch {
      // modèle indisponible, on essaie le suivant
    }
  }

  return { text: '', model_used: 'unavailable' }
}
