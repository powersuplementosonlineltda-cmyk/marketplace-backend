const { supabase } = require('../lib/supabase');

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractMetricPayload(row) {
  const metrics = row?.payload?.metrics || {};

  return {
    impression: numberOrZero(metrics.impression),
    clicks: numberOrZero(metrics.clicks),
    expense: numberOrZero(metrics.expense),
    broad_gmv: numberOrZero(metrics.broad_gmv),
    broad_order: numberOrZero(metrics.broad_order),
    direct_gmv: numberOrZero(metrics.direct_gmv),
    direct_order: numberOrZero(metrics.direct_order),
    ctr: numberOrZero(metrics.ctr),
    cpc: numberOrZero(metrics.cpc),
    cr: numberOrZero(metrics.cr),
  };
}

async function getCampaignInventory({ shopId, fromDate, toDate, limit = 200 }) {
  let query = supabase
    .from('shopee_ads_campaigns_raw')
    .select('shop_id,campaign_id,metric_date,ad_name,ad_type,campaign_placement,payload')
    .eq('shop_id', String(shopId))
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 200, 1), 5000));

  if (fromDate) query = query.gte('metric_date', fromDate);
  if (toDate) query = query.lte('metric_date', toDate);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const items = (data || []).map((row) => {
    const metrics = extractMetricPayload(row);
    return {
      shop_id: row.shop_id,
      campaign_id: row.campaign_id,
      metric_date: row.metric_date,
      ad_name: row.ad_name,
      ad_type: row.ad_type,
      campaign_placement: row.campaign_placement,
      ...metrics,
      raw: row.payload,
    };
  });

  const summary = items.reduce(
    (acc, item) => {
      acc.rows += 1;
      acc.impression += item.impression;
      acc.clicks += item.clicks;
      acc.expense += item.expense;
      acc.broad_gmv += item.broad_gmv;
      acc.broad_order += item.broad_order;
      acc.direct_gmv += item.direct_gmv;
      acc.direct_order += item.direct_order;
      return acc;
    },
    {
      rows: 0,
      impression: 0,
      clicks: 0,
      expense: 0,
      broad_gmv: 0,
      broad_order: 0,
      direct_gmv: 0,
      direct_order: 0,
    }
  );

  return {
    shop_id: String(shopId),
    filters: { fromDate: fromDate || null, toDate: toDate || null, limit: Number(limit) || 200 },
    summary,
    items,
  };
}

module.exports = {
  getCampaignInventory,
};
