import { createClient } from '@supabase/supabase-js'

// Client avec service_role — bypass RLS, usage serveur uniquement (cron jobs, agents)
export const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
