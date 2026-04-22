async function syncAdsCampaigns({ shopId, startDate, endDate }) {
  const base = process.env.SHOPEE_SYNC_BASE_URL || 'http://localhost:3000';
  const url = new URL('/ads/sync/campaigns', base);
  url.searchParams.set('shop_id', String(shopId));
  if (startDate) url.searchParams.set('start_date', startDate);
  if (endDate) url.searchParams.set('end_date', endDate);

  const controller = new AbortController();
  const timeoutMs = Number(process.env.SHOPEE_SYNC_TIMEOUT_MS || 45000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(url.toString(), { method: 'GET', signal: controller.signal });
  clearTimeout(timeout);
  const payload = await response.json();

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || payload?.error || 'Shopee sync failed');
  }

  return payload;
}

module.exports = { syncAdsCampaigns };
