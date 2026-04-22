create table if not exists public.shopee_oauth_callbacks (
  id bigserial primary key,
  code text not null,
  shop_id text,
  received_at timestamptz not null default now(),
  raw_query text,
  token_response text
);

create index if not exists idx_shopee_oauth_callbacks_received_at
  on public.shopee_oauth_callbacks (received_at desc);
