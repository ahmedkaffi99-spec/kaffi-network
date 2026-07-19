import { NextRequest, NextResponse } from 'next/server'
import { runPipeline } from '@/lib/orchestrator'
import { isAuthorizedCronRequest } from '@/lib/tools/cron-auth'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runPipeline()
  return NextResponse.json(result, { status: result.success ? 200 : 422 })
}
