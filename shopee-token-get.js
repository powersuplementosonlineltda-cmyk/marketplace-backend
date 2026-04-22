const crypto = require('crypto');

const partner_id = '2033230';
const partner_key = 'shpk7150797956504a58504e63695579496a6e4675696e54497357485656596f';
const shop_id = 1005930564;
const code = process.argv[2];

if (!code) {
  console.error('Uso: node shopee-token-get.js <code>');
  process.exit(1);
}

const path = '/api/v2/auth/token/get';
const timestamp = Math.floor(Date.now() / 1000);
const baseString = `${partner_id}${path}${timestamp}`;
const sign = crypto.createHmac('sha256', partner_key).update(baseString).digest('hex');
const url = `https://partner.shopeemobile.com${path}?partner_id=${partner_id}&timestamp=${timestamp}&sign=${sign}`;

async function main() {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      shop_id,
      partner_id: Number(partner_id),
    }),
  });

  const text = await resp.text();
  console.log('Status:', resp.status);
  console.log(text);
}

main().catch((err) => {
  console.error('Erro ao trocar code por token:', err.message);
  process.exit(1);
});
