const crypto = require('crypto');

const partner_id = '2033096';
const partner_key = 'shpk557972556a516b47774a4e58627770774a6d687a6e786e584e7942466a5a';
const shop_id = '1005930564';
const redirect_url = 'https://www.pwsuplementos.com.br';
const base_url = 'https://partner.shopeemobile.com';
const path = '/api/v2/shop/auth_partner';
const timestamp = Math.floor(Date.now() / 1000);

const baseString = `${partner_id}${path}${timestamp}${shop_id}`;
const sign = crypto.createHmac('sha256', partner_key).update(baseString).digest('hex');

const url = new URL(base_url + path);
url.searchParams.set('partner_id', partner_id);
url.searchParams.set('timestamp', String(timestamp));
url.searchParams.set('sign', sign);
url.searchParams.set('redirect', redirect_url);
url.searchParams.set('shop_id', shop_id);

console.log('Shopee Auth URL:');
console.log(url.toString());
console.log('Base string:', baseString);
console.log('Sign:', sign);
console.log('Timestamp:', timestamp);
