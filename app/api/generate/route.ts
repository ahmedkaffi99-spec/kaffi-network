import { NextResponse } from 'next/server'
import { generateDailyPronostics } from '@/lib/generator'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  try {
    const session = await generateDailyPronostics()
    return NextResponse.json({ success: true, session })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne du serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
