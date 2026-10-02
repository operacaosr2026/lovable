-- Atendimento: treino da IA com as respostas da equipe (support-learning.server.ts).
-- Cada e-mail do cliente ganha um rascunho da IA (sem enviar); quando a equipe
-- responde, a resposta real é comparada com o rascunho. O manual (regras por tag)
-- é refeito uma vez por dia com essas comparações.

alter table public.support_messages
  add column if not exists ai_draft text,
  add column if not exists ai_draft_pt text,
  add column if not exists ai_draft_at timestamptz,
  add column if not exists ai_draft_eval jsonb;

create table if not exists public.support_playbook (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb,
  based_on integer not null default 0,
  updated_at timestamptz not null default now()
);
-- Só o servidor (service role) lê e grava.
alter table public.support_playbook enable row level security;
