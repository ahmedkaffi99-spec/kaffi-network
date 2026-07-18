-- Kaffi Network — schéma initial
-- Un pronostic = une session (combiné du jour) → N picks (relation 1-N)
-- Le nombre de picks est une conséquence de l'analyse, jamais un paramètre.

create extension if not exists "uuid-ossp";

-- Session du jour (le "combiné")
create table pronostic_sessions (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  status           text not null default 'draft'
                   check (status in ('draft', 'approved', 'published')),
  combined_odds    numeric(7, 2),
  published_at     timestamptz,
  telegram_msg_id  text,
  notes            text,
  created_at       timestamptz not null default now(),

  constraint unique_session_per_day unique (date)
);

-- Picks individuels dans une session
create table picks (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references pronostic_sessions(id) on delete cascade,
  competition      text not null,
  home_team        text not null,
  away_team        text not null,
  bet_type         text not null,        -- ex: "Moins de 3.5 buts", "BTTS Non"
  odds             numeric(6, 2) not null,
  trend_label      text not null,        -- ex: "Arsenal: 13/15 matchs sous 3.5 buts"
  trend_pct        numeric(5, 2) not null, -- ex: 86.7
  sample_size      integer not null,     -- ex: 15 (nombre de matchs analysés)
  match_datetime   timestamptz,
  result           text check (result in ('win', 'loss', 'void') or result is null),
  created_at       timestamptz not null default now()
);

-- Indexes utiles
create index idx_sessions_date on pronostic_sessions(date desc);
create index idx_picks_session on picks(session_id);
create index idx_picks_result on picks(result);

-- RLS : accès uniquement aux utilisateurs authentifiés
alter table pronostic_sessions enable row level security;
alter table picks enable row level security;

create policy "Authenticated users only" on pronostic_sessions
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users only" on picks
  for all using (auth.role() = 'authenticated');

-- Vue pratique pour les stats
create view session_stats as
  select
    s.id,
    s.date,
    s.status,
    s.combined_odds,
    s.published_at,
    count(p.id) as total_picks,
    count(p.id) filter (where p.result = 'win') as wins,
    count(p.id) filter (where p.result = 'loss') as losses,
    count(p.id) filter (where p.result = 'void') as voids,
    round(
      count(p.id) filter (where p.result = 'win')::numeric /
      nullif(count(p.id) filter (where p.result is not null and p.result != 'void'), 0) * 100,
      1
    ) as win_rate
  from pronostic_sessions s
  left join picks p on p.session_id = s.id
  group by s.id;
