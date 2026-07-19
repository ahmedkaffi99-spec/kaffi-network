-- Synchronise le repo avec le schéma déjà appliqué en production
-- (colonnes/tables créées directement sur le projet Supabase, jamais capturées
-- en migration locale). Écrit en idempotent pour ne rien casser si déjà présent.

-- Colonnes ajoutées à pronostic_sessions après le schéma initial
alter table pronostic_sessions add column if not exists telegram_image_url text;
alter table pronostic_sessions add column if not exists planner_output jsonb;
alter table pronostic_sessions add column if not exists analyst_output jsonb;
alter table pronostic_sessions add column if not exists writer_output text;
alter table pronostic_sessions add column if not exists supervisor_notes jsonb;
alter table pronostic_sessions add column if not exists iterations integer not null default 0;

alter table pronostic_sessions drop constraint if exists pronostic_sessions_status_check;
alter table pronostic_sessions add constraint pronostic_sessions_status_check
  check (status in ('draft', 'approved', 'published', 'rejected'));

-- Colonnes ajoutées à picks après le schéma initial
alter table picks add column if not exists was_rejected boolean not null default false;
alter table picks add column if not exists rejection_reason text;
alter table picks add column if not exists result_checked_at timestamptz;

-- Mémoire de performance par type de pari / compétition (lue par l'analyste)
create table if not exists bet_performance (
  id            uuid primary key default gen_random_uuid(),
  bet_type      text not null,
  competition   text not null,
  total_picks   integer not null default 0,
  wins          integer not null default 0,
  losses        integer not null default 0,
  voids         integer not null default 0,
  avg_odds      numeric,
  last_updated  timestamptz not null default now(),
  constraint bet_performance_bet_type_competition_key unique (bet_type, competition)
);

alter table bet_performance enable row level security;
drop policy if exists "auth only" on bet_performance;
create policy "auth only" on bet_performance for all using (auth.role() = 'authenticated');

-- Anti-doublon : matchs déjà publiés dans un combiné
create table if not exists published_matches (
  id            uuid primary key default gen_random_uuid(),
  home_team     text not null,
  away_team     text not null,
  match_date    date not null,
  session_id    uuid references pronostic_sessions(id) on delete cascade,
  published_at  timestamptz not null default now(),
  constraint published_matches_home_team_away_team_match_date_key unique (home_team, away_team, match_date)
);

alter table published_matches enable row level security;
drop policy if exists "auth only" on published_matches;
create policy "auth only" on published_matches for all using (auth.role() = 'authenticated');

-- Suivi du quota journalier des API externes (API-Football, etc.)
create table if not exists api_quota (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  provider     text not null default 'api-football',
  calls_used   integer not null default 0,
  updated_at   timestamptz default now(),
  constraint api_quota_date_provider_key unique (date, provider)
);

alter table api_quota enable row level security;
drop policy if exists "auth only" on api_quota;
create policy "auth only" on api_quota for all using (auth.role() = 'authenticated');

-- Incrémentation atomique du quota (utilisée par lib/tools/quota-tracker.ts)
create or replace function increment_api_quota(p_date date, p_provider text, p_n integer default 1)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_calls int;
begin
  insert into api_quota (date, provider, calls_used)
  values (p_date, p_provider, p_n)
  on conflict (date, provider)
  do update set
    calls_used = api_quota.calls_used + excluded.calls_used,
    updated_at = now()
  returning calls_used into v_calls;
  return v_calls;
end;
$$;
