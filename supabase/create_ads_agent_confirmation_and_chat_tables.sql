create table if not exists public.ads_agent_execution_confirmations (
  id bigserial primary key,
  shop_id text not null,
  confirmation_token text not null,
  confirmation_code text not null,
  dry_run boolean not null default true,
  approved_action_ids bigint[] not null default '{}',
  status text not null default 'pending',
  expires_at timestamptz not null,
  execution_result jsonb,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create index if not exists idx_ads_agent_exec_confirmations_shop_status
  on public.ads_agent_execution_confirmations (shop_id, status, created_at desc);

create table if not exists public.ads_agent_chat_logs (
  id bigserial primary key,
  shop_id text not null,
  user_message text,
  agent_answer text,
  context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ads_agent_chat_logs_shop_created
  on public.ads_agent_chat_logs (shop_id, created_at desc);

alter table public.ads_agent_execution_confirmations disable row level security;
alter table public.ads_agent_chat_logs disable row level security;
