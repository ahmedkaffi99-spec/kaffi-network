import { adminSupabase } from '@/lib/supabase/admin'

const DEFAULT_PROVIDER = 'api-football'
const DAILY_LIMIT = 100

function todayUTC(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Retourne le nombre de requêtes utilisées aujourd'hui pour un provider donné.
 */
export async function getQuotaUsed(provider = DEFAULT_PROVIDER): Promise<number> {
  const { data, error } = await adminSupabase
    .from('api_quota')
    .select('calls_used')
    .eq('date', todayUTC())
    .eq('provider', provider)
    .maybeSingle()

  if (error) throw new Error(`quota-tracker getQuotaUsed: ${error.message}`)
  return data?.calls_used ?? 0
}

/**
 * Incrémente atomiquement le quota du jour via une RPC Supabase.
 * Retourne le nouveau total après incrémentation.
 *
 * La fonction SQL attendue dans Supabase :
 *   CREATE OR REPLACE FUNCTION increment_api_quota(p_date DATE, p_provider TEXT, p_n INT)
 *   RETURNS INT LANGUAGE plpgsql AS $$
 *   DECLARE v_calls INT;
 *   BEGIN
 *     INSERT INTO api_quota (date, provider, calls_used)
 *       VALUES (p_date, p_provider, p_n)
 *     ON CONFLICT (date, provider)
 *       DO UPDATE SET calls_used = api_quota.calls_used + EXCLUDED.calls_used
 *     RETURNING calls_used INTO v_calls;
 *     RETURN v_calls;
 *   END; $$;
 */
export async function incrementQuota(provider = DEFAULT_PROVIDER, n = 1): Promise<number> {
  const { data, error } = await adminSupabase.rpc('increment_api_quota', {
    p_date: todayUTC(),
    p_provider: provider,
    p_n: n,
  })

  if (error) throw new Error(`quota-tracker incrementQuota: ${error.message}`)
  return data as number
}

/**
 * Retourne le nombre de requêtes restantes pour aujourd'hui.
 */
export async function getRemainingQuota(provider = DEFAULT_PROVIDER): Promise<number> {
  const used = await getQuotaUsed(provider)
  return Math.max(0, DAILY_LIMIT - used)
}
