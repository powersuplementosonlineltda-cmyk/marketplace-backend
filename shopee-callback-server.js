const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');

const PORT = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL || 'https://zoejwaivyurplmbyzeaw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_fznDPUWJl_OpROQMAcHPeA_GSlfo5Ya';
const partnerId = process.env.SHOPEE_PARTNER_ID || '2033230';
const partnerKey = process.env.SHOPEE_PARTNER_KEY || 'shpk7150797956504a58504e63695579496a6e4675696e54497357485656596f';
const TOKEN_REFRESH_WINDOW_SECONDS = Number(process.env.TOKEN_REFRESH_WINDOW_SECONDS || 300);
const DEFAULT_ADS_RANGE_DAYS = Number(process.env.DEFAULT_ADS_RANGE_DAYS || 7);

const supabase = createClient(supabaseUrl, supabaseKey);

function buildSignedUrl(path) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}`;
  const sign = crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
  return `https://partner.shopeemobile.com${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;
}

function buildSignedShopUrl(path, accessToken, shopId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  const sign = crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
  const url = new URL(`https://partner.shopeemobile.com${path}`);
  url.searchParams.set('partner_id', String(partnerId));
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('access_token', String(accessToken));
  url.searchParams.set('shop_id', String(shopId));
  url.searchParams.set('sign', sign);
  return url.toString();
}

function formatDateDDMMYYYY(date) {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function getDefaultAdsDateRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - DEFAULT_ADS_RANGE_DAYS);
  return {
    startDate: formatDateDDMMYYYY(start),
    endDate: formatDateDDMMYYYY(end),
  };
}

function flattenObject(input, prefix = '', out = {}) {
  if (input === null || input === undefined) {
    if (prefix) out[prefix] = input;
    return out;
  }

  if (Array.isArray(input)) {
    input.forEach((item, idx) => {
      const key = prefix ? `${prefix}[${idx}]` : `[${idx}]`;
      flattenObject(item, key, out);
    });
    return out;
  }

  if (typeof input === 'object') {
    Object.entries(input).forEach(([key, value]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenObject(value, next, out);
    });
    return out;
  }

  if (prefix) out[prefix] = input;
  return out;
}

function uniqueNumbers(values) {
  return Array.from(new Set(values.filter((n) => Number.isFinite(n) && n > 0)));
}

function collectCampaignIds(payload) {
  const result = [];

  function walk(node, keyName = '') {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, keyName));
      return;
    }
    if (typeof node !== 'object') return;

    Object.entries(node).forEach(([k, v]) => {
      const lower = String(k).toLowerCase();
      if (lower === 'campaign_id') {
        const n = Number(v);
        if (Number.isFinite(n)) result.push(n);
      }
      if (lower === 'campaign_id_list' && typeof v === 'string') {
        v.split(',').forEach((part) => {
          const n = Number(part.trim());
          if (Number.isFinite(n)) result.push(n);
        });
      }
      walk(v, k);
    });
  }

  walk(payload);
  return uniqueNumbers(result);
}

function extractCampaignMetricsRows(payload, shopId, endpoint, requestParams) {
  const rows = [];
  const responseNode = payload?.response;
  const responses = Array.isArray(responseNode) ? responseNode : responseNode ? [responseNode] : [];

  responses.forEach((shopBlock) => {
    const campaignList = Array.isArray(shopBlock?.campaign_list) ? shopBlock.campaign_list : [];
    campaignList.forEach((campaign) => {
      const campaignId = Number(campaign?.campaign_id || 0);
      const adName = campaign?.ad_name || '';
      const adType = campaign?.ad_type || '';
      const placement = campaign?.campaign_placement || '';
      const metricsList = Array.isArray(campaign?.metrics_list) ? campaign.metrics_list : [];

      if (!metricsList.length) {
        rows.push({
          shop_id: String(shopId),
          campaign_id: String(campaignId || ''),
          metric_date: null,
          ad_name: adName,
          ad_type: adType,
          campaign_placement: placement,
          endpoint,
          request_params: requestParams,
          payload: campaign,
          flattened_payload: flattenObject(campaign),
        });
        return;
      }

      metricsList.forEach((metric) => {
        rows.push({
          shop_id: String(shopId),
          campaign_id: String(campaignId || ''),
          metric_date: metric?.date || null,
          ad_name: adName,
          ad_type: adType,
          campaign_placement: placement,
          endpoint,
          request_params: requestParams,
          payload: { ...campaign, metrics: metric },
          flattened_payload: flattenObject({ ...campaign, metrics: metric }),
        });
      });
    });
  });

  return rows;
}

async function callShopeeAdsGet(path, shopId, accessToken, extraParams = {}) {
  const signedBase = buildSignedShopUrl(path, accessToken, shopId);
  const url = new URL(signedBase);
  Object.entries(extraParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const response = await fetch(url.toString(), { method: 'GET' });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_err) {
    json = null;
  }

  return {
    status: response.status,
    endpoint: path,
    method: 'GET',
    request_url: url.toString(),
    request_params: extraParams,
    body_text: text,
    body_json: json,
  };
}

async function insertAdsApiLog(shopId, callResult) {
  const row = {
    shop_id: String(shopId),
    endpoint: callResult.endpoint,
    http_method: callResult.method,
    http_status: Number(callResult.status || 0),
    request_url: callResult.request_url,
    request_params: callResult.request_params,
    response_body: callResult.body_json || { raw_text: callResult.body_text },
    flattened_response: flattenObject(callResult.body_json || { raw_text: callResult.body_text }),
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('shopee_ads_api_logs').insert(row);
  if (error) {
    throw new Error(error.message);
  }
}

async function upsertAdsCampaignRows(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from('shopee_ads_campaigns_raw').upsert(rows, {
    onConflict: 'shop_id,campaign_id,metric_date,endpoint',
  });
  if (error) {
    throw new Error(error.message);
  }
}

function buildExpiry(expireInSeconds) {
  const value = Number(expireInSeconds || 0);
  return new Date(Date.now() + value * 1000).toISOString();
}

function hasShopeeError(payload) {
  if (!payload) return true;
  const err = payload.error || '';
  return Boolean(err && err.trim());
}

async function exchangeCodeForToken(code, shopId) {
  const path = '/api/v2/auth/token/get';
  const url = buildSignedUrl(path);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    }),
  });

  const json = await response.json();
  return { status: response.status, data: json };
}

async function refreshAccessToken(shopId, refreshToken) {
  const path = '/api/v2/auth/access_token/get';
  const url = buildSignedUrl(path);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    }),
  });

  const json = await response.json();
  return { status: response.status, data: json };
}

async function upsertActiveToken(shopId, tokenPayload, source) {
  const row = {
    shop_id: String(shopId),
    access_token: tokenPayload?.access_token || '',
    refresh_token: tokenPayload?.refresh_token || '',
    expire_in: Number(tokenPayload?.expire_in || 0),
    expires_at: buildExpiry(tokenPayload?.expire_in),
    token_error: tokenPayload?.error || '',
    token_message: tokenPayload?.message || '',
    source,
    partner_id: String(partnerId),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('shopee_shop_tokens').upsert(row, { onConflict: 'shop_id' });
  if (error) {
    throw new Error(error.message);
  }
}

async function getTokenRow(shopId) {
  const { data, error } = await supabase
    .from('shopee_shop_tokens')
    .select('*')
    .eq('shop_id', String(shopId))
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function getValidTokenByShopId(requestedShopId) {
  const tokenRow = await getTokenRow(requestedShopId);
  if (!tokenRow) {
    return { ok: false, status: 404, message: 'Nenhum token ativo encontrado para a loja.' };
  }

  if (!shouldRefreshToken(tokenRow)) {
    return {
      ok: true,
      refreshed: false,
      token: {
        shop_id: tokenRow.shop_id,
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expire_in: tokenRow.expire_in,
        expires_at: tokenRow.expires_at,
      },
    };
  }

  const refreshed = await refreshAccessToken(requestedShopId, tokenRow.refresh_token);
  if (hasShopeeError(refreshed.data)) {
    return { ok: false, status: 502, message: 'Falha ao atualizar token.', shopee: refreshed.data };
  }

  await upsertActiveToken(requestedShopId, refreshed.data, 'refresh');
  return {
    ok: true,
    refreshed: true,
    token: {
      shop_id: requestedShopId,
      access_token: refreshed.data.access_token,
      refresh_token: refreshed.data.refresh_token,
      expire_in: refreshed.data.expire_in,
      expires_at: buildExpiry(refreshed.data.expire_in),
    },
  };
}

function shouldRefreshToken(tokenRow) {
  if (!tokenRow?.expires_at) return true;
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  const threshold = Date.now() + TOKEN_REFRESH_WINDOW_SECONDS * 1000;
  return expiresAt <= threshold;
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2937; }
      .card { max-width: 720px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
      h1 { margin-top: 0; font-size: 24px; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      ${body}
    </div>
  </body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const code = reqUrl.searchParams.get('code');
  const shopId = reqUrl.searchParams.get('shop_id');

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }

  if (reqUrl.pathname === '/token') {
    const requestedShopId = reqUrl.searchParams.get('shop_id') || '';
    if (!requestedShopId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: 'Informe shop_id em /token?shop_id=...' }));
      return;
    }

    try {
      const validToken = await getValidTokenByShopId(requestedShopId);
      if (!validToken.ok) {
        res.writeHead(validToken.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(validToken));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          refreshed: validToken.refreshed,
          shop_id: validToken.token.shop_id,
          access_token: validToken.token.access_token,
          refresh_token: validToken.token.refresh_token,
          expire_in: validToken.token.expire_in,
          expires_at: validToken.token.expires_at,
        })
      );
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: err.message }));
      return;
    }
  }

  if (reqUrl.pathname === '/test/shop-info') {
    const requestedShopId = reqUrl.searchParams.get('shop_id') || '';
    if (!requestedShopId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: 'Informe shop_id em /test/shop-info?shop_id=...' }));
      return;
    }

    try {
      const validToken = await getValidTokenByShopId(requestedShopId);
      if (!validToken.ok) {
        res.writeHead(validToken.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(validToken));
        return;
      }

      const path = '/api/v2/shop/get_shop_info';
      const signedUrl = buildSignedShopUrl(path, validToken.token.access_token, requestedShopId);
      const response = await fetch(signedUrl, { method: 'GET' });
      const payload = await response.json();

      res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: response.ok,
          endpoint: path,
          shop_id: requestedShopId,
          refreshed: validToken.refreshed,
          shopee: payload,
        })
      );
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: err.message }));
      return;
    }
  }

  if (reqUrl.pathname === '/ads/sync/campaigns') {
    const requestedShopId = reqUrl.searchParams.get('shop_id') || '';
    if (!requestedShopId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: 'Informe shop_id em /ads/sync/campaigns?shop_id=...' }));
      return;
    }

    const range = getDefaultAdsDateRange();
    const startDate = reqUrl.searchParams.get('start_date') || range.startDate;
    const endDate = reqUrl.searchParams.get('end_date') || range.endDate;

    try {
      const validToken = await getValidTokenByShopId(requestedShopId);
      if (!validToken.ok) {
        res.writeHead(validToken.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(validToken));
        return;
      }

      const calls = [];

      const idListCall = await callShopeeAdsGet(
        '/api/v2/ads/get_product_level_campaign_id_list',
        requestedShopId,
        validToken.token.access_token,
        {}
      );
      calls.push(idListCall);
      await insertAdsApiLog(requestedShopId, idListCall);

      const campaignIds = collectCampaignIds(idListCall.body_json || {});
      if (!campaignIds.length) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            refreshed: validToken.refreshed,
            shop_id: requestedShopId,
            start_date: startDate,
            end_date: endDate,
            campaign_ids_found: 0,
            saved_rows: 0,
            message: 'Nenhuma campanha retornada pela Shopee Ads neste momento.',
            id_list_response: idListCall.body_json || idListCall.body_text,
          })
        );
        return;
      }

      const savedRows = [];
      for (let i = 0; i < campaignIds.length; i += 100) {
        const chunk = campaignIds.slice(i, i + 100);

        const perfCall = await callShopeeAdsGet(
          '/api/v2/ads/get_product_campaign_daily_performance',
          requestedShopId,
          validToken.token.access_token,
          {
            start_date: startDate,
            end_date: endDate,
            campaign_id_list: chunk.join(','),
          }
        );
        calls.push(perfCall);
        await insertAdsApiLog(requestedShopId, perfCall);

        const rows = extractCampaignMetricsRows(
          perfCall.body_json || {},
          requestedShopId,
          perfCall.endpoint,
          perfCall.request_params
        );
        if (rows.length) {
          await upsertAdsCampaignRows(rows);
          savedRows.push(...rows);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          refreshed: validToken.refreshed,
          shop_id: requestedShopId,
          start_date: startDate,
          end_date: endDate,
          campaign_ids_found: campaignIds.length,
          api_calls: calls.length,
          saved_rows: savedRows.length,
        })
      );
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: err.message }));
      return;
    }
  }

  if (reqUrl.pathname === '/ads/campaigns') {
    const requestedShopId = reqUrl.searchParams.get('shop_id') || '';
    const limit = Number(reqUrl.searchParams.get('limit') || 100);

    if (!requestedShopId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: 'Informe shop_id em /ads/campaigns?shop_id=...&limit=100' }));
      return;
    }

    try {
      const { data, error } = await supabase
        .from('shopee_ads_campaigns_raw')
        .select('*')
        .eq('shop_id', String(requestedShopId))
        .order('id', { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 5000));

      if (error) {
        throw new Error(error.message);
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, shop_id: requestedShopId, count: data.length, items: data }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: err.message }));
      return;
    }
  }

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      htmlPage(
        'Shopee Callback',
        '<h1>Servidor de callback ativo</h1><p>Aguardando retorno da Shopee em <code>?code=...</code>.</p>'
      )
    );
    return;
  }

  console.log('Shopee callback recebido:');
  console.log('code:', code);
  console.log('shop_id:', shopId);

  let tokenResult = null;
  try {
    tokenResult = await exchangeCodeForToken(code, shopId);
    console.log('Token get status:', tokenResult.status);
    console.log('Token get response:', JSON.stringify(tokenResult.data));

    if (!hasShopeeError(tokenResult.data)) {
      await upsertActiveToken(shopId, tokenResult.data, 'oauth_callback');
    }
  } catch (err) {
    console.error('Erro ao trocar code por token:', err.message);
  }

  try {
    const { error } = await supabase.from('shopee_oauth_callbacks').insert({
      code,
      shop_id: shopId,
      received_at: new Date().toISOString(),
      raw_query: reqUrl.search,
      token_response: tokenResult ? JSON.stringify(tokenResult.data) : null,
    });

    if (error) {
      console.error('Falha ao salvar no Supabase:', error.message);
    }
  } catch (err) {
    console.error('Erro ao enviar callback para Supabase:', err.message);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  const accessToken = tokenResult?.data?.access_token || '';
  const refreshToken = tokenResult?.data?.refresh_token || '';
  const expireIn = tokenResult?.data?.expire_in || '';
  const tokenError = tokenResult?.data?.error || '';
  res.end(
    htmlPage(
      'Autorizacao Concluida',
      `<h1>Autorizacao recebida com sucesso</h1>
       <p>Code: <code>${code}</code></p>
       <p>Shop ID: <code>${shopId || ''}</code></p>
       <p>Access Token: <code>${accessToken}</code></p>
       <p>Refresh Token: <code>${refreshToken}</code></p>
       <p>Expire In: <code>${expireIn}</code></p>
       <p>Token Error: <code>${tokenError}</code></p>`
    )
  );
});

server.listen(PORT, () => {
  console.log(`Callback server rodando em http://localhost:${PORT}`);
});