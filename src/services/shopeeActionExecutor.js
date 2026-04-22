const crypto = require('crypto');
const { supabase } = require('../lib/supabase');

const partnerId = process.env.SHOPEE_PARTNER_ID || '2033230';
const partnerKey = process.env.SHOPEE_PARTNER_KEY || 'shpk7150797956504a58504e63695579496a6e4675696e54497357485656596f';
const baseUrl = process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com';

function signForShop(path, accessToken, shopId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  const sign = crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
  return { timestamp, sign };
}

async function refreshToken(shopId, refreshToken) {
  const path = '/api/v2/auth/access_token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}`;
  const sign = crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');

  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('partner_id', String(partnerId));
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(payload?.message || payload?.error || 'refresh token failed');
  }

  const expireIn = Number(payload.expire_in || 0);
  const expiresAt = new Date(Date.now() + expireIn * 1000).toISOString();

  const { error } = await supabase.from('shopee_shop_tokens').upsert(
    {
      shop_id: String(shopId),
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expire_in: expireIn,
      expires_at: expiresAt,
      token_error: payload.error || '',
      token_message: payload.message || '',
      source: 'refresh',
      partner_id: String(partnerId),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id' }
  );

  if (error) throw new Error(error.message);
  return payload.access_token;
}

async function getValidToken(shopId) {
  const { data, error } = await supabase
    .from('shopee_shop_tokens')
    .select('*')
    .eq('shop_id', String(shopId))
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('token for shop not found');

  const expiresAt = new Date(data.expires_at || 0).getTime();
  const needsRefresh = !expiresAt || expiresAt <= Date.now() + 5 * 60 * 1000;

  if (!needsRefresh) return data.access_token;
  return refreshToken(shopId, data.refresh_token);
}

async function executeShopeeAction({ shopId, endpoint, method = 'POST', payload = {} }) {
  const accessToken = await getValidToken(shopId);
  const path = String(endpoint || '').trim();
  if (!path.startsWith('/api/v2/ads/')) {
    throw new Error('Only /api/v2/ads/* endpoints are allowed for action execution');
  }

  const { timestamp, sign } = signForShop(path, accessToken, shopId);
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('partner_id', String(partnerId));
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('access_token', String(accessToken));
  url.searchParams.set('shop_id', String(shopId));
  url.searchParams.set('sign', sign);

  // Para GET, adicionar payload como query params
  const isGet = method.toUpperCase() === 'GET';
  if (isGet && payload && typeof payload === 'object') {
    Object.entries(payload).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  const response = await fetch(url.toString(), {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' },
    body: isGet ? undefined : JSON.stringify(payload),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    json = { raw_text: text };
  }

  return {
    ok: response.ok && !json?.error,
    status: response.status,
    endpoint: path,
    method: method.toUpperCase(),
    request_payload: payload,
    response: json,
  };
}

// Normaliza string para comparação de nomes de produtos
function normalizeProductName(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Busca todos os produtos da loja e retorna mapa: normalizedName -> item_id
async function fetchShopeeItemIdMap(shopId) {
  const accessToken = await getValidToken(shopId);
  const allItems = [];
  let offset = 0;

  while (true) {
    const path = '/api/v2/product/get_item_list';
    const { timestamp, sign } = signForShop(path, accessToken, shopId);
    const url = new URL(`${baseUrl}${path}`);
    url.searchParams.set('partner_id', String(partnerId));
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('access_token', String(accessToken));
    url.searchParams.set('shop_id', String(shopId));
    url.searchParams.set('sign', sign);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('page_size', '100');
    url.searchParams.set('item_status', 'NORMAL');

    const r = await fetch(url.toString(), { method: 'GET' });
    const json = await r.json();
    const items = json?.response?.item || [];
    allItems.push(...items);
    if (!json?.response?.has_next_page || !items.length) break;
    offset += 100;
  }

  if (!allItems.length) return {};

  // Buscar nomes em lotes de 50
  const nameMap = {}; // item_id -> name
  const itemIds = allItems.map((i) => i.item_id);
  for (let i = 0; i < itemIds.length; i += 50) {
    const chunk = itemIds.slice(i, i + 50);
    const path = '/api/v2/product/get_item_base_info';
    const { timestamp, sign } = signForShop(path, accessToken, shopId);
    const url = new URL(`${baseUrl}${path}`);
    url.searchParams.set('partner_id', String(partnerId));
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('access_token', String(accessToken));
    url.searchParams.set('shop_id', String(shopId));
    url.searchParams.set('sign', sign);
    url.searchParams.set('item_id_list', chunk.join(','));
    url.searchParams.set('need_tax_info', 'false');

    const r = await fetch(url.toString(), { method: 'GET' });
    const json = await r.json();
    (json?.response?.item_list || []).forEach((item) => {
      nameMap[String(item.item_id)] = item.item_name;
    });
  }

  // Inverter: normalizedName -> item_id
  const result = {};
  Object.entries(nameMap).forEach(([itemId, name]) => {
    result[normalizeProductName(name)] = itemId;
  });
  return result;
}

// Busca o item_id para uma campanha específica usando ad_name como chave
function matchItemIdForAdName(adName, itemIdMap) {
  const norm = normalizeProductName(adName);
  if (!norm) return null;

  // Exact match
  if (itemIdMap[norm]) return itemIdMap[norm];

  // Partial match: ad_name starts with product name prefix (names can be truncated)
  for (const [productNorm, itemId] of Object.entries(itemIdMap)) {
    const prefix = Math.min(norm.length, productNorm.length, 40);
    if (prefix >= 20 && (norm.startsWith(productNorm.slice(0, prefix)) || productNorm.startsWith(norm.slice(0, prefix)))) {
      return itemId;
    }
  }
  return null;
}

module.exports = {
  executeShopeeAction,
  fetchShopeeItemIdMap,
  matchItemIdForAdName,
};
