create table if not exists public.shopee_shop_tokens (
  shop_id text primary key,
  access_token text not null,
  refresh_token text not null,
  expire_in integer not null default 0,
  expires_at timestamptz,
  token_error text,
  token_message text,
  source text,
  partner_id text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_shopee_shop_tokens_expires_at
  on public.shopee_shop_tokens (expires_at);

alter table public.shopee_shop_tokens disable row level security;
