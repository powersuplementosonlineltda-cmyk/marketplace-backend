const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://zoejwaivyurplmbyzeaw.supabase.co',
  'sb_publishable_fznDPUWJl_OpROQMAcHPeA_GSlfo5Ya'
);

(async () => {
  const sql = `create table if not exists public.shopee_oauth_callbacks (
    id bigserial primary key,
    code text not null,
    shop_id text,
    received_at timestamptz not null default now(),
    raw_query text,
    token_response text
  );`;

  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  console.log('data:', data);
  console.log('error:', error);
})();
