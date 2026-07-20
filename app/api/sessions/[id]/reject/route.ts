import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Rejet manuel d'un palier 'draft' — remplace l'ancien verdict "revision_needed"
// du Superviseur IA : c'est maintenant l'utilisateur qui juge le post et
// décide s'il publie ou non.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { error } = await supabase
    .from('pronostic_sessions')
    .update({ status: 'rejected', notes: 'Rejeté manuellement depuis le dashboard.' })
    .eq('id', id)
    .eq('status', 'draft')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
