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

// Rôles → modèles primaires souhaités + fallbacks gratuits vérifiés
// Analyst + Supervisor : NVIDIA Nemotron Ultra (grand contexte, rigueur)
// Planner             : NVIDIA Nemotron Super (léger)
// Writer              : Tencent Hunyuan (262K ctx)
const ANALYST_MODELS = [
  'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',   // Nemotron Ultra 1M (primaire)
  'nvidia/llama-3.3-nemotron-super-49b-v1:free',    // Nemotron Super (fallback)
  'qwen/qwen-2.5-72b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
]

const SUPERVISOR_MODELS = [
  'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',   // Nemotron Ultra 1M (primaire)
  'nvidia/llama-3.3-nemotron-super-49b-v1:free',    // Nemotron Super (fallback)
  'qwen/qwen-2.5-72b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
]

const PLANNER_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1:free',    // Nemotron Super ~540ms (primaire)
  'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',   // Nemotron Ultra (fallback)
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
]

const WRITER_MODELS = [
  'tencent/hunyuan-a13b-instruct:free',             // Tencent Hy3 262K (primaire)
  'qwen/qwen-2.5-72b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/llama-3.3-nemotron-super-49b-v1:free',
  'mistralai/mistral-7b-instruct:free',
]

export type AgentRole = 'planner' | 'analyst' | 'writer' | 'supervisor'

interface RouterResult {
  text: string
  model_used: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function tryModel(
  model: string,
  system: string,
  userMessage: string,
  maxTokens: number,
  retries = 1
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { text } = await generateText({
        model: openrouter(model),
        system,
        prompt: userMessage,
        maxOutputTokens: maxTokens,
        abortSignal: AbortSignal.timeout(45000),
      })
      if (text?.trim()) {
        console.log(`[model-router] ✅ ${model} — ${text.trim().length} chars`)
        return text.trim()
      }
    } catch (err: unknown) {
      const msg = String(err)
      if (msg.includes('429') && attempt < retries) {
        console.log(`[model-router] ⏳ 429 sur ${model}, retry dans 20s...`)
        await sleep(20000)
        continue
      }
      console.log(`[model-router] ❌ ${model} — ${msg.slice(0, 150)}`)
      break
    }
  }
  return null
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

  console.log(`[model-router] 🚀 role=${role} — essai de ${models.length} modèles`)

  for (const model of models) {
    const text = await tryModel(model, system, userMessage, maxTokens)
    if (text) return { text, model_used: model }
  }

  console.log(`[model-router] ⚠️ tous les modèles ont échoué pour role=${role}`)
  return { text: '', model_used: 'unavailable' }
}
