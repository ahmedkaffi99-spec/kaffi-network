export type SportType = 'football'
export type SessionStatus = 'draft' | 'approved' | 'published' | 'rejected'
export type ResultType = 'win' | 'loss' | 'void' | null

// ─── Picks ────────────────────────────────────────────────────────────────────

export interface Pick {
  id: string
  session_id: string
  competition: string
  home_team: string
  away_team: string
  match_datetime: string | null
  bet_type: string
  odds: number
  trend_label: string
  trend_pct: number
  sample_size: number
  was_rejected: boolean
  rejection_reason: string | null
  result: ResultType
  result_checked_at: string | null
  created_at: string
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export interface PronosticSession {
  id: string
  date: string
  status: SessionStatus
  combined_odds: number | null
  published_at: string | null
  telegram_msg_id: string | null
  telegram_image_url: string | null
  planner_output: PlannerOutput | null
  analyst_output: AnalystOutput | null
  writer_output: string | null
  supervisor_notes: SupervisorNotes | null
  iterations: number
  notes: string | null
  created_at: string
  picks?: Pick[]
}

// ─── Sorties agents ───────────────────────────────────────────────────────────

export interface PlannerOutput {
  date: string
  competitions: string[]
  focus_areas: string[]
  context: string
  model_used?: string
}

export interface PickCandidate {
  competition: string
  home_team: string
  away_team: string
  match_datetime: string
  bet_type: string
  odds: number
  trend_label: string
  trend_pct: number
  sample_size: number
  memory_context?: string
  news_context?: string
}

export interface RejectedPick {
  match: string
  competition: string
  bet_type?: string
  raison: string
}

export interface AnalystOutput {
  picks_retenus: PickCandidate[]
  picks_rejetés: RejectedPick[]
  summary: string
  model_used?: string
}

export interface SupervisorCheck {
  verdict: 'approved' | 'revision_needed'
  issues?: string[]
  feedback?: string
}

export interface SupervisorNotes {
  checks: SupervisorCheck[]
  final_verdict: 'approved' | 'rejected'
  iterations: number
  model_used?: string
}

// ─── Mémoire / performance ────────────────────────────────────────────────────

export interface BetPerformance {
  id: string
  bet_type: string
  competition: string
  total_picks: number
  wins: number
  losses: number
  voids: number
  avg_odds: number | null
  last_updated: string
}

// ─── Stats dashboard ──────────────────────────────────────────────────────────

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
