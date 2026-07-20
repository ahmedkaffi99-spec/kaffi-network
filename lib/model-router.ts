import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY!,
  headers: {
    'HTTP-Referer': 'https://kaffi-network.vercel.app',
    'X-Title': 'IA de Pronostics & Coupons',
  },
})

// Fournisseur de secours séparé (clé API distincte, pas via OpenRouter) —
// GROQ_API_KEY absente de l'environnement = ce niveau est simplement ignoré,
// aucun crash. À configurer sur Vercel (Production + Preview) pour l'activer.
const groq = process.env.GROQ_API_KEY
  ? createOpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY })
  : null

// IDs Groq (pas de préfixe fournisseur, contrairement à OpenRouter) — noms
// stables au moment de l'écriture, à revérifier sur console.groq.com si
// l'un d'eux échoue systématiquement (le routeur passe alors juste au
// suivant, jamais bloquant).
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']

// Modèles exacts demandés + fallbacks vérifiés via OpenRouter API
// Analyst + Supervisor : Nemotron 3 Ultra 550B (rigueur max)
// Planner             : Nemotron 3 Super 120B (léger, rapide)
// Writer              : Tencent Hy3 (262K ctx)
// poolside/laguna-xs-2.1:free et cohere/north-mini-code:free — modèles
// "coding agent" (33B-A3B / 30B MoE), gros contexte (256K/262K), ajoutés en
// fin de chaîne sur les 4 rôles : bonne discipline JSON, utile en secours
// si les modèles principaux sont indisponibles. Slugs vérifiés directement
// sur la page modèle OpenRouter (pas de vérification API possible depuis cet
// environnement — jamais deviner un slug).
const ANALYST_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'qwen/qwen3-235b-a22b-instruct:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
]

const SUPERVISOR_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'qwen/qwen3-235b-a22b-instruct:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-26b-a4b-it:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
]

const PLANNER_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-26b-a4b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
]

const WRITER_MODELS = [
  'tencent/hy3:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
]

export type AgentRole = 'planner' | 'analyst' | 'writer' | 'supervisor'

interface RouterResult {
  text: string
  model_used: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function tryModel(
  client: typeof openrouter,
  model: string,
  system: string,
  userMessage: string,
  maxTokens: number,
  retries = 1
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { text } = await generateText({
        model: client(model),
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

  console.log(`[model-router] 🚀 role=${role} — essai de ${models.length} modèles OpenRouter`)

  for (const model of models) {
    const text = await tryModel(openrouter, model, system, userMessage, maxTokens)
    if (text) return { text, model_used: model }
  }

  // Dernier niveau — fournisseur séparé, uniquement si GROQ_API_KEY est
  // configurée. Jamais essayé avant d'avoir épuisé tout OpenRouter.
  if (groq) {
    console.log(`[model-router] 🚀 role=${role} — essai de ${GROQ_MODELS.length} modèles Groq`)
    for (const model of GROQ_MODELS) {
      const text = await tryModel(groq, model, system, userMessage, maxTokens)
      if (text) return { text, model_used: `groq:${model}` }
    }
  }

  console.log(`[model-router] ⚠️ tous les modèles ont échoué pour role=${role}`)
  return { text: '', model_used: 'unavailable' }
}
