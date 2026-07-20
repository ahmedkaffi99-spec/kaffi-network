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

// Liste volontairement resserrée à 5 modèles confirmés (retiré : Hermes 3,
// Qwen3 235B, Qwen3 Next 80B, Gemma 4, Llama 3.3/3.2 — sur demande, pour ne
// garder que les modèles explicitement choisis).
// Analyst   : Nemotron 3 Ultra 550B (rigueur max)
// Planner   : Nemotron 3 Super 120B (léger, rapide)
// Writer    : Tencent Hy3 (262K ctx)
// (Le rôle Superviseur n'appelle plus de modèle — remplacé par la
// validation manuelle de l'utilisateur, voir lib/agents/supervisor.ts.)
// poolside/laguna-xs-2.1:free et cohere/north-mini-code:free — modèles
// "coding agent" (33B-A3B / 30B MoE), gros contexte (256K/262K), en secours
// sur les rôles restants. Slugs vérifiés directement sur la page modèle OpenRouter.
const ANALYST_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
]

const PLANNER_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
]

const WRITER_MODELS = [
  'tencent/hy3:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
]

export type AgentRole = 'planner' | 'analyst' | 'writer'

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
