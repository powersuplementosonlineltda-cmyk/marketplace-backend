const { executeShopeeAction, fetchShopeeItemIdMap, matchItemIdForAdName } = require('./shopeeActionExecutor');
const { supabase } = require('../lib/supabase');

// Resolve o item_id (reference_id) de uma campanha via product API
async function resolveReferenceId(shopId, campaignId) {
  try {
    const { data } = await supabase
      .from('shopee_ads_campaigns_raw')
      .select('ad_name')
      .eq('shop_id', String(shopId))
      .eq('campaign_id', String(campaignId))
      .not('ad_name', 'is', null)
      .limit(1)
      .maybeSingle();
    if (!data?.ad_name) return null;
    const itemIdMap = await fetchShopeeItemIdMap(shopId);
    return matchItemIdForAdName(data.ad_name, itemIdMap) || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Pausar uma campanha de ads
 */
async function pauseCampaign({ shopId, campaignId }) {
  if (!campaignId) {
    throw new Error('campaign_id é obrigatório');
  }

  const referenceId = await resolveReferenceId(shopId, campaignId);
  if (!referenceId) {
    throw new Error(`Não foi possível encontrar o item_id para a campanha ${campaignId}`);
  }

  const result = await executeShopeeAction({
    shopId,
    endpoint: '/api/v2/ads/edit_manual_product_ads',
    method: 'POST',
    payload: {
      campaign_id: Number(campaignId),
      reference_id: String(referenceId),
      edit_action: 'pause',
    },
  });

  if (!result.ok || result.response?.error) {
    throw new Error(
      result.response?.message || result.response?.error || 'Falha ao pausar campanha'
    );
  }

  return {
    success: true,
    campaign_id: String(campaignId),
    reference_id: String(referenceId),
    action: 'pause',
    shopee_response: result.response,
  };
}

/**
 * Ativar/reativar uma campanha de ads
 */
async function enableCampaign({ shopId, campaignId }) {
  if (!campaignId) {
    throw new Error('campaign_id é obrigatório');
  }

  const referenceId = await resolveReferenceId(shopId, campaignId);
  if (!referenceId) {
    throw new Error(`Não foi possível encontrar o item_id para a campanha ${campaignId}`);
  }

  const result = await executeShopeeAction({
    shopId,
    endpoint: '/api/v2/ads/edit_manual_product_ads',
    method: 'POST',
    payload: {
      campaign_id: Number(campaignId),
      reference_id: String(referenceId),
      edit_action: 'resume',
    },
  });

  if (!result.ok || result.response?.error) {
    throw new Error(
      result.response?.message || result.response?.error || 'Falha ao ativar campanha'
    );
  }

  return {
    success: true,
    campaign_id: String(campaignId),
    reference_id: String(referenceId),
    action: 'resume',
    shopee_response: result.response,
  };
}

/**
 * Atualizar orçamento de uma campanha
 */
async function updateBudget({ shopId, campaignId, budget, budgetMultiplier }) {
  if (!campaignId) {
    throw new Error('campaign_id é obrigatório');
  }
  if (!budget && !budgetMultiplier) {
    throw new Error('budget ou budget_multiplier é obrigatório');
  }

  const referenceId = await resolveReferenceId(shopId, campaignId);
  if (!referenceId) {
    throw new Error(`Não foi possível encontrar o item_id para a campanha ${campaignId}`);
  }

  // budget em reais (a API da Shopee aceita reais, não centavos)
  let dailyBudget;
  if (budget) {
    dailyBudget = Math.round(Number(budget));
  } else if (budgetMultiplier) {
    // Sem budget atual disponível via API, usa multiplicador sobre valor padrão R$50
    dailyBudget = Math.round(50 * Number(budgetMultiplier));
  }

  const result = await executeShopeeAction({
    shopId,
    endpoint: '/api/v2/ads/edit_manual_product_ads',
    method: 'POST',
    payload: {
      campaign_id: Number(campaignId),
      reference_id: String(referenceId),
      edit_action: 'change_budget',
      budget: dailyBudget,
    },
  });

  if (!result.ok || result.response?.error) {
    throw new Error(
      result.response?.message || result.response?.error || 'Falha ao atualizar orçamento'
    );
  }

  return {
    success: true,
    campaign_id: String(campaignId),
    reference_id: String(referenceId),
    action: 'change_budget',
    daily_budget: dailyBudget,
    shopee_response: result.response,
  };
}

/**
 * Listar campanhas com dados de Supabase
 */
async function getCampaigns({ shopId, limit = 100 }) {
  const { data, error } = await supabase
    .from('shopee_ads_campaigns_raw')
    .select('campaign_id,ad_name,ad_type,campaign_placement,payload,metric_date')
    .eq('shop_id', String(shopId))
    .order('metric_date', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  // Agrupar por campaign_id e pegar última métrica
  const byCampaign = new Map();
  (data || []).forEach((row) => {
    const key = String(row.campaign_id || '');
    if (!key || byCampaign.has(key)) return;
    
    const metrics = row.payload?.metrics || {};
    byCampaign.set(key, {
      campaign_id: key,
      campaign_name: row.ad_name || '',
      ad_type: row.ad_type || '',
      campaign_placement: row.campaign_placement || '',
      metric_date: row.metric_date || '',
      expense: Number(metrics.expense || 0),
      sales: Number(metrics.broad_gmv || 0),
      clicks: Number(metrics.clicks || 0),
      impressions: Number(metrics.impression || 0),
      conversions: Number(metrics.broad_order || 0),
    });
  });

  const campaigns = Array.from(byCampaign.values());

  return {
    success: true,
    shop_id: String(shopId),
    count: campaigns.length,
    campaigns,
  };
}

/**
 * Obter dados de desempenho de campanhas
 */
async function getPerformance({ shopId, campaignId, days = 14 }) {
  let query = supabase
    .from('shopee_ads_campaigns_raw')
    .select('campaign_id,ad_name,payload,metric_date')
    .eq('shop_id', String(shopId))
    .order('metric_date', { ascending: false });

  if (campaignId) {
    query = query.eq('campaign_id', String(campaignId));
  }

  const { data, error } = await query.limit(500);

  if (error) {
    throw new Error(error.message);
  }

  // Agrupar por campaign_id e agregar métricas
  const byCampaign = new Map();
  
  (data || []).forEach((row) => {
    const key = String(row.campaign_id || '');
    if (!key) return;
    
    const metrics = row.payload?.metrics || {};
    
    if (!byCampaign.has(key)) {
      byCampaign.set(key, {
        campaign_id: key,
        campaign_name: row.ad_name || '',
        count_days: 0,
        total_expense: 0,
        total_sales: 0,
        total_clicks: 0,
        total_impressions: 0,
        total_conversions: 0,
      });
    }
    
    const c = byCampaign.get(key);
    c.count_days += 1;
    c.total_expense += Number(metrics.expense || 0);
    c.total_sales += Number(metrics.broad_gmv || 0);
    c.total_clicks += Number(metrics.clicks || 0);
    c.total_impressions += Number(metrics.impression || 0);
    c.total_conversions += Number(metrics.broad_order || 0);
  });

  const campaigns = Array.from(byCampaign.values()).map((c) => ({
    campaign_id: c.campaign_id,
    campaign_name: c.campaign_name,
    days_tracked: c.count_days,
    total_expense: Number(c.total_expense.toFixed(2)),
    total_sales: Number(c.total_sales.toFixed(2)),
    total_clicks: c.total_clicks,
    total_impressions: c.total_impressions,
    total_conversions: c.total_conversions,
    avg_cpc: c.total_clicks > 0 ? Number((c.total_expense / c.total_clicks).toFixed(2)) : 0,
    avg_ctr: c.total_impressions > 0 ? Number(((c.total_clicks / c.total_impressions) * 100).toFixed(2)) : 0,
    roas: c.total_expense > 0 ? Number((c.total_sales / c.total_expense).toFixed(2)) : 0,
    acos: c.total_sales > 0 ? Number(((c.total_expense / c.total_sales) * 100).toFixed(2)) : 0,
  }));

  return {
    success: true,
    shop_id: String(shopId),
    period_days: days,
    campaign_id: campaignId ? String(campaignId) : undefined,
    count: campaigns.length,
    data: campaigns,
  };
}

module.exports = {
  pauseCampaign,
  enableCampaign,
  updateBudget,
  getCampaigns,
  getPerformance,
};
