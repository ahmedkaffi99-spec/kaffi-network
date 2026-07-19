-- Agent Kernel — mémoire long terme et journal de communication inter-agents
-- (lib/agent-kernel/*). Générique : `scope` identifie le "crew" (ex:
-- 'pronostics-foot'), pas de dépendance dure aux tables du pipeline foot
-- sauf le lien optionnel vers pronostic_sessions pour l'UI dashboard.

-- Mémoire long terme : leçons distillées qui survivent aux runs individuels
create table if not exists agent_memory_long_term (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null,
  key           text not null,
  value         text not null,
  confidence    numeric(3, 2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint agent_memory_long_term_scope_key_key unique (scope, key)
);

create index if not exists agent_memory_long_term_scope_idx on agent_memory_long_term(scope);

alter table agent_memory_long_term enable row level security;
drop policy if exists "auth only" on agent_memory_long_term;
create policy "auth only" on agent_memory_long_term for all using (auth.role() = 'authenticated');

-- Journal des messages échangés entre agents sur le blackboard d'un run
-- (mémoire court terme persistée pour audit/transcript — le blackboard
-- lui-même reste en mémoire pendant l'exécution du run).
create table if not exists agent_messages (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,
  scope         text not null,
  session_id    uuid references pronostic_sessions(id) on delete set null,
  from_role     text not null,
  to_role       text,
  type          text not null check (type in ('observation', 'plan', 'decision', 'reflection', 'result', 'action')),
  content       text not null,
  created_at    timestamptz not null default now()
);

create index if not exists agent_messages_run_id_idx on agent_messages(run_id);
create index if not exists agent_messages_session_id_idx on agent_messages(session_id);

alter table agent_messages enable row level security;
drop policy if exists "auth only" on agent_messages;
create policy "auth only" on agent_messages for all using (auth.role() = 'authenticated');
