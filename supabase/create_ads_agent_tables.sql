create table if not exists public.ads_agent_profiles (
  shop_id text primary key,
  profile jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ads_agent_runs (
  id bigserial primary key,
  shop_id text not null,
  run_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ads_agent_runs_shop_created
  on public.ads_agent_runs (shop_id, created_at desc);

create table if not exists public.ads_agent_actions (
  id bigserial primary key,
  run_id bigint references public.ads_agent_runs (id) on delete set null,
  shop_id text not null,
  campaign_id text,
  action_type text not null,
  confidence numeric(5,2),
  status text not null default 'draft',
  reason text,
  suggested_payload jsonb,
  execution_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  executed_at timestamptz
);

create index if not exists idx_ads_agent_actions_shop_status
  on public.ads_agent_actions (shop_id, status, created_at desc);

alter table public.ads_agent_profiles disable row level security;
alter table public.ads_agent_runs disable row level security;
alter table public.ads_agent_actions disable row level security;
