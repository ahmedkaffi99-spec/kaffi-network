import { NextRequest, NextResponse } from 'next/server'
import { runPipeline } from '@/lib/orchestrator'
import { isAuthorizedCronRequest } from '@/lib/tools/cron-auth'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?date=YYYY-MM-DD optionnel — permet de cibler une journée précise
  // (ex: tester le calendrier de demain) au lieu de toujours "aujourd'hui".
  const date = req.nextUrl.searchParams.get('date') ?? undefined
  const result = await runPipeline(date)
  return NextResponse.json(result, { status: result.success ? 200 : 422 })
}
