const crypto = require('crypto');
const https = require('https');

const partner_id = '2033230';
const key = 'shpk7150797956504a58504e63695579496a6e4675696e5449735748565656596f';
const redirect = 'https://08c203f7e33eda.lhr.life';
const path = '/api/v2/shop/auth_partner';
const ts = Math.floor(Date.now() / 1000);
const bases = ['https://partner.shopeemobile.com', 'https://openplatform.shopee.com'];
const paths = [
  '/api/v2/shop/auth_partner',
  'api/v2/shop/auth_partner',
  '/api/v2/shop/auth_partner/',
];

const variants = [
  ['p+path+ts', `${partner_id}${path}${ts}`],
  ['p+path+ts+shop', `${partner_id}${path}${ts}1005930564`],
  ['p+path+ts+redirect', `${partner_id}${path}${ts}${redirect}`],
  ['p+path+ts+redirectEncoded', `${partner_id}${path}${ts}${encodeURIComponent(redirect)}`],
];

function req(u) {
  return new Promise((resolve) => {
    https
      .get(u, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ code: res.statusCode, body: d }));
      })
      .on('error', (e) => resolve({ code: 0, body: String(e) }));
  });
}

(async () => {
  for (const p of paths) {
    for (const base of bases) {
      for (const [name, bsTemplate] of variants) {
        const bs = bsTemplate.replace(path, p);
        const sign = crypto.createHmac('sha256', key).update(bs).digest('hex');
        const cleanPath = p.startsWith('/') ? p : `/${p}`;
        const u = new URL(base + cleanPath);
        u.searchParams.set('partner_id', partner_id);
        u.searchParams.set('timestamp', String(ts));
        u.searchParams.set('sign', sign);
        u.searchParams.set('redirect', redirect);
        const out = await req(u.toString());

        console.log('---', name, '| host=', base, '| path=', p);
        console.log('baseString=', bs);
        console.log('sign=', sign);
        console.log('resp=', out.body);
      }
    }
  }
})();
