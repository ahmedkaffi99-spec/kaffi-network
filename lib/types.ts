export type SportType = 'football'

export type SessionStatus = 'draft' | 'approved' | 'published'

export type ResultType = 'win' | 'loss' | 'void' | null

export interface Pick {
  id: string
  session_id: string
  competition: string
  home_team: string
  away_team: string
  bet_type: string
  odds: number
  trend_label: string
  trend_pct: number
  sample_size: number
  match_datetime: string | null
  result: ResultType
  created_at: string
}

export interface PronosticSession {
  id: string
  date: string
  status: SessionStatus
  combined_odds: number | null
  published_at: string | null
  telegram_msg_id: string | null
  notes: string | null
  created_at: string
  picks?: Pick[]
}

export interface MonthlyStats {
  month: string
  total: number
  wins: number
  losses: number
  voids: number
  win_rate: number
  roi: number
}

export interface DashboardStats {
  total_this_month: number
  win_rate: number
  pending_review: number
  published_today: number
  current_streak: number
  roi_this_month: number
}
