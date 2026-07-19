import { NextRequest, NextResponse } from 'next/server'
import { runPipeline } from '@/lib/orchestrator'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runPipeline()
  return NextResponse.json(result, { status: result.success ? 200 : 422 })
}
