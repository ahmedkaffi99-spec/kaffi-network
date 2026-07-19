-- Annonce du résultat d'un combiné sur Telegram une fois tous ses picks
-- résolus (win/loss/void) — lib/tools/result-checker.ts::announceSessionResults.

alter table pronostic_sessions add column if not exists combo_result text;
alter table pronostic_sessions add column if not exists result_posted_at timestamptz;

alter table pronostic_sessions drop constraint if exists pronostic_sessions_combo_result_check;
alter table pronostic_sessions add constraint pronostic_sessions_combo_result_check
  check (combo_result is null or combo_result in ('win', 'loss', 'void'));

create index if not exists pronostic_sessions_pending_result_idx
  on pronostic_sessions (status)
  where status = 'published' and result_posted_at is null;
