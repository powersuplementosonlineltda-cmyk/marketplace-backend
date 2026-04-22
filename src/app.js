const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const auth = require('./middleware/auth');
const { supabase } = require('./lib/supabase');
const agentInventoryRoutes = require('./routes/agentInventoryRoutes');
const adsAgentRoutes = require('./routes/adsAgentRoutes');
const { runAdsSpecialistCycle } = require('./agents/adsSpecialistAgent');

const app = express();
const port = Number(process.env.PORT || process.env.APP_PORT || 4000);
const shopeePartnerId = Number(process.env.SHOPEE_PARTNER_ID || '2033230');
const shopeePartnerKey = process.env.SHOPEE_PARTNER_KEY || 'shpk7150797956504a58504e63695579496a6e4675696e54497357485656596f';

function buildSignedAuthUrl(pathname) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${shopeePartnerId}${pathname}${timestamp}`;
  const sign = crypto.createHmac('sha256', shopeePartnerKey).update(baseString).digest('hex');
  const url = new URL(`https://partner.shopeemobile.com${pathname}`);
  url.searchParams.set('partner_id', String(shopeePartnerId));
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  return url.toString();
}

function buildExpiry(expireInSeconds) {
  return new Date(Date.now() + Number(expireInSeconds || 0) * 1000).toISOString();
}

function hasShopeeError(payload) {
  const err = payload?.error || '';
  return Boolean(String(err).trim());
}

async function exchangeCodeForToken(code, shopId) {
  const url = buildSignedAuthUrl('/api/v2/auth/token/get');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(shopeePartnerId),
    }),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function upsertTokenRow(shopId, tokenPayload) {
  const row = {
    shop_id: String(shopId),
    access_token: tokenPayload?.access_token || '',
    refresh_token: tokenPayload?.refresh_token || '',
    expire_in: Number(tokenPayload?.expire_in || 0),
    expires_at: buildExpiry(tokenPayload?.expire_in),
    token_error: tokenPayload?.error || '',
    token_message: tokenPayload?.message || '',
    source: 'oauth_callback',
    partner_id: String(shopeePartnerId),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('shopee_shop_tokens').upsert(row, { onConflict: 'shop_id' });
  if (error) throw new Error(error.message);
}

app.use(express.json());
app.use('/cockpit', express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'inventory-agent-api' });
});

app.get('/ads-cockpit', (_req, res) => {
  return res.redirect('/cockpit/ads-cockpit.html');
});

app.get('/', async (req, res) => {
  const code = String(req.query.code || '').trim();
  const shopId = String(req.query.shop_id || '').trim();

  if (!code || !shopId) {
    return res.status(200).send('API online. Use /health or /ads-cockpit.');
  }

  try {
    const tokenResult = await exchangeCodeForToken(code, shopId);
    if (!tokenResult.status || tokenResult.status >= 400 || hasShopeeError(tokenResult.payload)) {
      return res.status(502).json({
        ok: false,
        message: 'Falha ao trocar code por token na Shopee.',
        shopee: tokenResult.payload,
      });
    }

    await upsertTokenRow(shopId, tokenResult.payload);

    return res.status(200).json({
      ok: true,
      message: 'Autorizacao Shopee concluida com sucesso.',
      shop_id: String(shopId),
      expires_at: buildExpiry(tokenResult.payload?.expire_in),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.use('/api', auth, agentInventoryRoutes);
app.use('/api', auth, adsAgentRoutes);

const automationEnabled = String(process.env.ADS_AGENT_AUTOMATION_ENABLED || 'false').toLowerCase() === 'true';
const automationShopId = (process.env.ADS_AGENT_DEFAULT_SHOP_ID || '').trim();
const automationEveryMs = Number(process.env.ADS_AGENT_AUTOMATION_EVERY_MS || 60 * 60 * 1000);

if (automationEnabled && automationShopId) {
  setInterval(async () => {
    try {
      await runAdsSpecialistCycle({
        shopId: automationShopId,
        days: Number(process.env.ADS_AGENT_AUTOMATION_DAYS || 14),
        autoApprove: String(process.env.ADS_AGENT_AUTO_APPROVE || 'false').toLowerCase() === 'true',
        dryRun: String(process.env.ADS_AGENT_DRY_RUN || 'true').toLowerCase() !== 'false',
      });
      console.log('[ads-agent] automated cycle executed');
    } catch (error) {
      console.error('[ads-agent] automated cycle failed:', error.message);
    }
  }, Math.max(60 * 1000, automationEveryMs));

  console.log('[ads-agent] automation enabled for shop', automationShopId);
}

app.listen(port, () => {
  console.log(`Inventory API running at http://localhost:${port}`);
});

module.exports = app;
