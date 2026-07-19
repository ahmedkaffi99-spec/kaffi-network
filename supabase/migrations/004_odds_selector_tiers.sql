-- Support de 3 combinés/jour (prudent / équilibré / audacieux) décidés par
-- le nouvel agent Sélecteur de cotes (lib/agents/odds-selector.ts). Les picks
-- candidats de l'Analyste sont désormais partagés entre paliers — une même
-- session (date) peut donc avoir jusqu'à 3 lignes, une par palier.

alter table pronostic_sessions add column if not exists tier text not null default 'prudent';
alter table pronostic_sessions add column if not exists odds_selector_output jsonb;

alter table pronostic_sessions drop constraint if exists pronostic_sessions_tier_check;
alter table pronostic_sessions add constraint pronostic_sessions_tier_check
  check (tier in ('prudent', 'equilibre', 'audacieux'));

-- Remplace la contrainte "une session par jour" par "une session par jour et par palier"
alter table pronostic_sessions drop constraint if exists pronostic_sessions_date_key;
alter table pronostic_sessions drop constraint if exists unique_session_per_day;
drop index if exists pronostic_sessions_date_key;
alter table pronostic_sessions add constraint pronostic_sessions_date_tier_key unique (date, tier);

-- Anti-doublon : un même match ne bloque plus les autres paliers le même
-- jour (partage volontaire des picks entre paliers) — seul un doublon dans
-- le MÊME palier reste bloqué.
alter table published_matches add column if not exists tier text not null default 'prudent';

alter table published_matches drop constraint if exists published_matches_tier_check;
alter table published_matches add constraint published_matches_tier_check
  check (tier in ('prudent', 'equilibre', 'audacieux'));

alter table published_matches drop constraint if exists published_matches_home_team_away_team_match_date_key;
alter table published_matches add constraint published_matches_home_team_away_team_match_date_tier_key
  unique (home_team, away_team, match_date, tier);
