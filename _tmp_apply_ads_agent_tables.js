const { Client } = require('pg');
const fs = require('fs');

const connectionString =
  process.env.SUPABASE_DB_URL ||
  'postgresql://postgres:Fluxaagency121%40@db.zoejwaivyurplmbyzeaw.supabase.co:5432/postgres';
const sqlPath = 'C:/Users/ranye/shopee-backend/supabase/create_ads_agent_tables.sql';

async function main() {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('Ads agent tables applied successfully.');
}

main().catch((err) => {
  console.error('Failed to apply ads agent tables:', err.message);
  process.exit(1);
});
