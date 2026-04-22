create table if not exists public.shopee_ads_api_logs (
  id bigserial primary key,
  shop_id text not null,
  endpoint text not null,
  http_method text not null,
  http_status integer not null,
  request_url text,
  request_params jsonb,
  response_body jsonb,
  flattened_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_shopee_ads_api_logs_shop_created
  on public.shopee_ads_api_logs (shop_id, created_at desc);

create table if not exists public.shopee_ads_campaigns_raw (
  id bigserial primary key,
  shop_id text not null,
  campaign_id text not null,
  metric_date text,
  ad_name text,
  ad_type text,
  campaign_placement text,
  endpoint text not null,
  request_params jsonb,
  payload jsonb,
  flattened_payload jsonb,
  updated_at timestamptz not null default now(),
  unique (shop_id, campaign_id, metric_date, endpoint)
);

create index if not exists idx_shopee_ads_campaigns_raw_shop_campaign
  on public.shopee_ads_campaigns_raw (shop_id, campaign_id, metric_date);

alter table public.shopee_ads_api_logs disable row level security;
alter table public.shopee_ads_campaigns_raw disable row level security;
