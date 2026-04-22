const { Client } = require('pg');

const connectionString = 'postgresql://postgres:Fluxaagency121%40@db.zoejwaivyurplmbyzeaw.supabase.co:5432/postgres';

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  await client.query(`
    create table if not exists public.shopee_oauth_callbacks (
      id bigserial primary key,
      code text not null,
      shop_id text,
      received_at timestamptz not null default now(),
      raw_query text,
      token_response text
    );
  `);

  await client.query(`
    create index if not exists idx_shopee_oauth_callbacks_received_at
      on public.shopee_oauth_callbacks (received_at desc);
  `);

  const check = await client.query(`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'shopee_oauth_callbacks'
    order by ordinal_position;
  `);

  console.log('Tabela criada/verificada com sucesso. Colunas:');
  for (const row of check.rows) {
    console.log(`- ${row.column_name}: ${row.data_type}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error('Erro ao criar tabela:', err.message);
  process.exit(1);
});
