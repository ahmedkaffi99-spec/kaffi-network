import { NextRequest, NextResponse } from 'next/server'
import { checkPendingResults } from '@/lib/tools/result-checker'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await checkPendingResults()
  return NextResponse.json({ success: true, ...result })
}
