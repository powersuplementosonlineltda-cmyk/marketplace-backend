const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// DADOS DE PRODUÇÃO SHOPEE ADS
const partner_id = '2033230';
const partner_key = 'shpk7150797956504a58504e63695579496a6e4675696e54497357485656596f';
const shop_id = '1005930564';
const redirect_url =
	process.env.SHOPEE_REDIRECT_URL ||
	process.env.APP_BASE_URL ||
	'http://localhost:3000';
const base_url = 'https://partner.shopeemobile.com';
const path = '/api/v2/shop/auth_partner';
const timestamp = Math.floor(Date.now() / 1000);

// Geração do sign para auth_partner (sem shop_id no base string)
const baseString = `${partner_id}${path}${timestamp}`;
const sign = crypto.createHmac('sha256', partner_key).update(baseString).digest('hex');

const url = new URL(base_url + path);
url.searchParams.set('partner_id', partner_id);
url.searchParams.set('timestamp', String(timestamp));
url.searchParams.set('sign', sign);
url.searchParams.set('redirect', redirect_url);

console.log('Shopee Auth URL:');
console.log(url.toString());
console.log('Base string:', baseString);
console.log('Sign:', sign);
console.log('Timestamp:', timestamp);
console.log('Redirect URL:', redirect_url);

// Conexão com o Supabase
const supabaseUrl = 'https://zoejwaivyurplmbyzeaw.supabase.co';
const supabaseKey = 'sb_publishable_fznDPUWJl_OpROQMAcHPeA_GSlfo5Ya';
const supabase = createClient(supabaseUrl, supabaseKey);
