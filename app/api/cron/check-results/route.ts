import { NextRequest, NextResponse } from 'next/server'
import { checkPendingResults, announceSessionResults } from '@/lib/tools/result-checker'
import { isAuthorizedCronRequest } from '@/lib/tools/cron-auth'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await checkPendingResults()
  const announcements = await announceSessionResults()
  return NextResponse.json({ success: true, ...result, announcements })
}
