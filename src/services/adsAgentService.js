const { supabase } = require('../lib/supabase');
const { syncAdsCampaigns } = require('./shopeeSyncClient');
const { generateStrategyWithChatGPT, chatWithAdsSpecialist } = require('./chatgptService');
const { executeShopeeAction, fetchShopeeItemIdMap, matchItemIdForAdName } = require('./shopeeActionExecutor');
const crypto = require('crypto');

const ADS_AGENT_WORKFLOW_ID =
  process.env.ADS_AGENT_WORKFLOW_ID || 'wf_69e82ec55890819091cc88eb646196dd002b656f6ea3da9c';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getDateRange(days) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, Number(days) || 14));

  const f = (d) => {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  return { startDate: f(start), endDate: f(end) };
}

async function readCampaignRows({ shopId, fromDate, toDate }) {
  let query = supabase
    .from('shopee_ads_campaigns_raw')
    .select('shop_id,campaign_id,metric_date,ad_name,ad_type,campaign_placement,payload')
    .eq('shop_id', String(shopId));

  if (fromDate) query = query.gte('metric_date', fromDate);
  if (toDate) query = query.lte('metric_date', toDate);

  const { data, error } = await query.limit(8000);
  if (error) throw new Error(error.message);
  return data || [];
}

function aggregateCampaigns(rows) {
  const byCampaign = new Map();

  rows.forEach((row) => {
    const key = String(row.campaign_id || '');
    if (!key) return;
    const metrics = row?.payload?.metrics || {};

    if (!byCampaign.has(key)) {
      byCampaign.set(key, {
        campaign_id: key,
        ad_name: row.ad_name || '',
        ad_type: row.ad_type || '',
        campaign_placement: row.campaign_placement || '',
        days: 0,
        impression: 0,
        clicks: 0,
        expense: 0,
        broad_gmv: 0,
        broad_order: 0,
        broad_order_amount: 0,
        direct_gmv: 0,
        direct_order: 0,
        direct_order_amount: 0,
        cpdc_sum: 0,
        active_days: 0,
      });
    }

    const c = byCampaign.get(key);
    c.days += 1;
    c.impression += toNumber(metrics.impression);
    c.clicks += toNumber(metrics.clicks);
    c.expense += toNumber(metrics.expense);
    c.broad_gmv += toNumber(metrics.broad_gmv);
    c.broad_order += toNumber(metrics.broad_order);
    c.broad_order_amount += toNumber(metrics.broad_order_amount);
    c.direct_gmv += toNumber(metrics.direct_gmv);
    c.direct_order += toNumber(metrics.direct_order);
    c.direct_order_amount += toNumber(metrics.direct_order_amount);
    c.cpdc_sum += toNumber(metrics.cpdc);
    if (toNumber(metrics.impression) > 0) c.active_days += 1;
  });

  const campaigns = Array.from(byCampaign.values()).map((c) => {
    const ctr = c.impression > 0 ? (c.clicks / c.impression) * 100 : 0;
    const cpc = c.clicks > 0 ? c.expense / c.clicks : 0;
    const roas = c.expense > 0 ? c.broad_gmv / c.expense : 0;
    const acos = c.broad_gmv > 0 ? (c.expense / c.broad_gmv) * 100 : 0;
    const conversion = c.clicks > 0 ? (c.broad_order / c.clicks) * 100 : 0;
    const direct_roas = c.expense > 0 ? c.direct_gmv / c.expense : 0;
    const direct_acos = c.direct_gmv > 0 ? (c.expense / c.direct_gmv) * 100 : 0;
    const direct_cr = c.clicks > 0 ? (c.direct_order / c.clicks) * 100 : 0;
    const avg_daily_spend = c.active_days > 0 ? c.expense / c.active_days : 0;
    const cpdc = c.direct_order > 0 ? c.expense / c.direct_order : 0;
    const { cpdc_sum, ...rest } = c;
    return { ...rest, ctr, cpc, roas, acos, conversion, direct_roas, direct_acos, direct_cr, avg_daily_spend, cpdc };
  });

  return campaigns;
}

function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const idx = Math.min(v.length - 1, Math.max(0, Math.floor((p / 100) * (v.length - 1))));
  return v[idx];
}

function buildProfile(campaigns) {
  const roasList = campaigns.map((c) => c.roas);
  const ctrList = campaigns.map((c) => c.ctr);
  const cpcList = campaigns.map((c) => c.cpc);

  return {
    campaigns_count: campaigns.length,
    thresholds: {
      roas_low: percentile(roasList, 25),
      roas_high: percentile(roasList, 75),
      ctr_low: percentile(ctrList, 25),
      ctr_high: percentile(ctrList, 75),
      cpc_high: percentile(cpcList, 75),
    },
    generated_at: new Date().toISOString(),
  };
}

function generateActionDrafts({ shopId, campaigns, profile }) {
  const t = profile.thresholds;
  const actions = [];

  campaigns.forEach((c) => {
    if (c.expense <= 0) return;

    if (c.roas < t.roas_low && c.ctr < t.ctr_low) {
      // Pausar campanha com baixo desempenho
      actions.push({
        shop_id: String(shopId),
        campaign_id: String(c.campaign_id),
        action_type: 'pause_campaign',
        confidence: 0.78,
        status: 'draft',
        reason: `ROAS ${c.roas.toFixed(2)} e CTR ${c.ctr.toFixed(2)} abaixo do perfil`,
        suggested_payload: {
          endpoint: '/api/v2/ads/edit_manual_product_ads',
          method: 'POST',
          note: 'Pausar campanha com baixo desempenho',
          campaign_id: Number(c.campaign_id),
          edit_action: 'pause',
        },
      });
    }

    if (c.roas > t.roas_high && c.ctr > t.ctr_high) {
      // Aumentar budget em ~20% baseado no gasto recente
      const estimatedNewBudget = Math.max(Math.round(c.expense * 1.2), 50);
      actions.push({
        shop_id: String(shopId),
        campaign_id: String(c.campaign_id),
        action_type: 'increase_budget',
        confidence: 0.74,
        status: 'draft',
        reason: `ROAS ${c.roas.toFixed(2)} e CTR ${c.ctr.toFixed(2)} acima do perfil`,
        suggested_payload: {
          endpoint: '/api/v2/ads/edit_manual_product_ads',
          method: 'POST',
          note: 'Aumentar budget em 20%',
          campaign_id: Number(c.campaign_id),
          edit_action: 'change_budget',
          budget: estimatedNewBudget,
        },
      });
    }

    if (c.cpc > t.cpc_high && c.roas < t.roas_low) {
      actions.push({
        shop_id: String(shopId),
        campaign_id: String(c.campaign_id),
        action_type: 'review_keywords',
        confidence: 0.7,
        status: 'draft',
        reason: `CPC ${c.cpc.toFixed(2)} alto com ROAS ${c.roas.toFixed(2)} baixo`,
        suggested_payload: {
          endpoint: '/api/v2/ads/edit_manual_product_ads',
          method: 'POST',
          note: 'Reduzir bid de keywords de baixa conversao',
          campaign_id: Number(c.campaign_id),
          edit_action: 'pause',
        },
      });
    }
  });

  return actions;
}

async function saveProfile(shopId, profile) {
  const { error } = await supabase
    .from('ads_agent_profiles')
    .upsert(
      {
        shop_id: String(shopId),
        profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' }
    );
  if (error) throw new Error(error.message);
}

async function getProfile(shopId) {
  const { data, error } = await supabase
    .from('ads_agent_profiles')
    .select('*')
    .eq('shop_id', String(shopId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function createRun(shopId, type, payload) {
  const { data, error } = await supabase
    .from('ads_agent_runs')
    .insert({
      shop_id: String(shopId),
      run_type: type,
      payload: {
        workflow_id: ADS_AGENT_WORKFLOW_ID,
        ...(payload || {}),
      },
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function saveActions(actions, runId) {
  if (!actions.length) return [];
  const rows = actions.map((a) => ({ ...a, run_id: runId, created_at: new Date().toISOString() }));
  const { data, error } = await supabase.from('ads_agent_actions').insert(rows).select('*');
  if (error) throw new Error(error.message);
  return data || [];
}

async function trainAgent({ shopId, days = 14 }) {
  const range = getDateRange(days);
  const rows = await readCampaignRows({ shopId, fromDate: range.startDate, toDate: range.endDate });
  const campaigns = aggregateCampaigns(rows);
  const profile = buildProfile(campaigns);
  await saveProfile(shopId, profile);
  await createRun(shopId, 'train', { days, campaigns_count: campaigns.length, profile });
  return {
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    shop_id: String(shopId),
    days,
    campaigns_count: campaigns.length,
    profile,
  };
}

async function recommend({ shopId, days = 14, syncBefore = true }) {
  const range = getDateRange(days);

  let syncResult = null;
  if (syncBefore) {
    try {
      syncResult = await syncAdsCampaigns({ shopId, startDate: range.startDate, endDate: range.endDate });
    } catch (error) {
      syncResult = { ok: false, message: error.message };
    }
  }

  const rows = await readCampaignRows({ shopId, fromDate: range.startDate, toDate: range.endDate });
  const campaigns = aggregateCampaigns(rows);

  const existingProfile = await getProfile(shopId);
  const profile = existingProfile?.profile || buildProfile(campaigns);
  if (!existingProfile) {
    await saveProfile(shopId, profile);
  }

  const drafts = generateActionDrafts({ shopId, campaigns, profile });
  const run = await createRun(shopId, 'recommend', {
    days,
    campaigns_count: campaigns.length,
    draft_actions_count: drafts.length,
    sync_result: syncResult,
  });

  const savedActions = await saveActions(drafts, run.id);
  const chatgpt = await generateStrategyWithChatGPT({ shopId, profile, recommendations: savedActions });

  await supabase
    .from('ads_agent_runs')
    .update({ payload: { ...run.payload, chatgpt } })
    .eq('id', run.id);

  return {
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    run_id: run.id,
    shop_id: String(shopId),
    days,
    campaigns_count: campaigns.length,
    actions_count: savedActions.length,
    chatgpt,
    actions: savedActions,
  };
}

async function listActions({ shopId, status = 'draft', limit = 100 }) {
  let query = supabase
    .from('ads_agent_actions')
    .select('*')
    .eq('shop_id', String(shopId))
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 1000));

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const actions = data || [];
  const campaignIds = Array.from(
    new Set(actions.map((a) => String(a.campaign_id || '')).filter(Boolean))
  );

  if (!campaignIds.length) {
    return actions;
  }

  const { data: campaignRows, error: campaignError } = await supabase
    .from('shopee_ads_campaigns_raw')
    .select('campaign_id,ad_name,updated_at')
    .eq('shop_id', String(shopId))
    .in('campaign_id', campaignIds)
    .order('updated_at', { ascending: false })
    .limit(5000);

  if (campaignError) throw new Error(campaignError.message);

  const byCampaignId = new Map();
  (campaignRows || []).forEach((row) => {
    const key = String(row.campaign_id || '');
    const name = String(row.ad_name || '').trim();
    if (!key || !name || byCampaignId.has(key)) return;
    byCampaignId.set(key, name);
  });

  return actions.map((action) => ({
    ...action,
    campaign_name: byCampaignId.get(String(action.campaign_id || '')) || null,
  }));
}

async function deleteAction(actionId) {
  const { error } = await supabase
    .from('ads_agent_actions')
    .delete()
    .eq('id', Number(actionId));
  if (error) throw new Error(error.message);
  return { deleted: true, id: Number(actionId) };
}

// Busca orçamento atual de uma campanha via Shopee API
// Busca o item_id (reference_id) para uma campanha via product API + ad_name matching
async function lookupItemIdForCampaign(shopId, campaignId) {
  try {
    // Buscar ad_name da campanha no DB
    const { data } = await supabase
      .from('shopee_ads_campaigns_raw')
      .select('ad_name')
      .eq('shop_id', String(shopId))
      .eq('campaign_id', String(campaignId))
      .not('ad_name', 'is', null)
      .limit(1)
      .maybeSingle();

    const adName = data?.ad_name;
    if (!adName) return null;

    // Buscar mapa de item_id por nome do produto
    const itemIdMap = await fetchShopeeItemIdMap(shopId);
    return matchItemIdForAdName(adName, itemIdMap) || null;
  } catch (_e) {
    return null;
  }
}

// Constrói payload limpo para Shopee removendo campos internos e adicionando reference_id
async function buildExecutionPayload(action, shopId) {
  const suggested = action.suggested_payload || {};
  const { endpoint, method, note, budget_multiplier, bid_multiplier, ...shopeeFields } = suggested;

  // Buscar reference_id (item_id) para edit_manual_product_ads
  const itemId = await lookupItemIdForCampaign(shopId, action.campaign_id);
  const payload = { ...shopeeFields };
  if (itemId) {
    payload.reference_id = String(itemId);
  }

  return payload;
}

async function executeSingleAction({ shopId, actionId, dryRun = true }) {
  const { data: action, error } = await supabase
    .from('ads_agent_actions')
    .select('*')
    .eq('id', Number(actionId))
    .eq('shop_id', String(shopId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!action) throw new Error(`Acao #${actionId} nao encontrada.`);

  // Approve if still draft
  if (action.status === 'draft') {
    await approveAction(actionId);
  }

  let executionResult;
  if (dryRun) {
    executionResult = { ok: true, dry_run: true, message: 'Execution skipped in dry run mode' };
  } else {
    const suggested = action.suggested_payload || {};
    const cleanPayload = await buildExecutionPayload(action, shopId);
    executionResult = await executeShopeeAction({
      shopId,
      endpoint: suggested.endpoint,
      method: suggested.method || 'POST',
      payload: cleanPayload,
    });
    executionResult.dry_run = false;
  }

  const nextStatus = executionResult.ok ? 'executed' : 'failed';
  const { data: updated, error: updateError } = await supabase
    .from('ads_agent_actions')
    .update({
      status: nextStatus,
      execution_result: executionResult,
      executed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', action.id)
    .select('*')
    .single();
  if (updateError) throw new Error(updateError.message);

  await createRun(shopId, 'execute', {
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    dry_run: Boolean(dryRun),
    single_action_id: action.id,
    actions_executed: 1,
  });

  return {
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    shop_id: String(shopId),
    dry_run: Boolean(dryRun),
    count: 1,
    actions: [updated],
  };
}

async function approveAction(actionId) {
  const { data, error } = await supabase
    .from('ads_agent_actions')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', Number(actionId))
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function executeApprovedActions({ shopId, dryRun = true, limit = 20 }) {
  const { data, error } = await supabase
    .from('ads_agent_actions')
    .select('*')
    .eq('shop_id', String(shopId))
    .eq('status', 'approved')
    .order('id', { ascending: true })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 200));

  if (error) throw new Error(error.message);
  const actions = data || [];

  const results = [];
  for (const action of actions) {
    let executionResult;
    if (dryRun) {
      executionResult = { ok: true, dry_run: true, message: 'Execution skipped in dry run mode' };
    } else {
      const suggested = action.suggested_payload || {};
      const cleanPayload = await buildExecutionPayload(action, shopId);
      executionResult = await executeShopeeAction({
        shopId,
        endpoint: suggested.endpoint,
        method: suggested.method || 'POST',
        payload: cleanPayload,
      });
      executionResult.dry_run = false;
    }

    const nextStatus = executionResult.ok ? 'executed' : 'failed';
    const { data: updated, error: updateError } = await supabase
      .from('ads_agent_actions')
      .update({
        status: nextStatus,
        execution_result: executionResult,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', action.id)
      .select('*')
      .single();

    if (updateError) throw new Error(updateError.message);
    results.push(updated);
  }

  await createRun(shopId, 'execute', { dry_run: Boolean(dryRun), actions_executed: results.length });
  return {
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    shop_id: String(shopId),
    dry_run: Boolean(dryRun),
    count: results.length,
    actions: results,
  };
}

async function prepareExecutionConfirmation({ shopId, dryRun = true, limit = 20 }) {
  const { data: approved, error } = await supabase
    .from('ads_agent_actions')
    .select('id')
    .eq('shop_id', String(shopId))
    .eq('status', 'approved')
    .order('id', { ascending: true })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 200));

  if (error) throw new Error(error.message);

  const approvedIds = (approved || []).map((x) => x.id);
  if (!approvedIds.length) {
    return {
      ok: false,
      message: 'Nenhuma acao aprovada para execucao.',
      approved_count: 0,
    };
  }

  const confirmationCode = String(Math.floor(100000 + Math.random() * 900000));
  const confirmationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: confirmation, error: insertError } = await supabase
    .from('ads_agent_execution_confirmations')
    .insert({
      shop_id: String(shopId),
      confirmation_token: confirmationToken,
      confirmation_code: confirmationCode,
      dry_run: Boolean(dryRun),
      approved_action_ids: approvedIds,
      status: 'pending',
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (insertError) throw new Error(insertError.message);

  return {
    ok: true,
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    shop_id: String(shopId),
    approved_count: approvedIds.length,
    confirmation_token: confirmation.confirmation_token,
    confirmation_code: confirmation.confirmation_code,
    expires_at: confirmation.expires_at,
    message:
      'Execucao pendente de confirmacao. Envie confirmation_token e confirmation_code para executar.',
  };
}

async function executeWithConfirmation({ shopId, confirmationToken, confirmationCode }) {
  const { data: conf, error } = await supabase
    .from('ads_agent_execution_confirmations')
    .select('*')
    .eq('shop_id', String(shopId))
    .eq('confirmation_token', String(confirmationToken))
    .eq('confirmation_code', String(confirmationCode))
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!conf) {
    throw new Error('Confirmacao invalida.');
  }
  if (conf.status !== 'pending') {
    throw new Error('Esta confirmacao nao esta mais pendente.');
  }
  if (new Date(conf.expires_at).getTime() < Date.now()) {
    throw new Error('Confirmacao expirada. Gere uma nova confirmacao.');
  }

  const execution = await executeApprovedActions({
    shopId,
    dryRun: Boolean(conf.dry_run),
    limit: Array.isArray(conf.approved_action_ids) ? conf.approved_action_ids.length : 20,
  });

  const { error: updateError } = await supabase
    .from('ads_agent_execution_confirmations')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      execution_result: execution,
    })
    .eq('id', conf.id);

  if (updateError) throw new Error(updateError.message);
  return execution;
}

async function chat({ shopId, message, days = 14 }) {
  const range = getDateRange(days);
  const rows = await readCampaignRows({ shopId, fromDate: range.startDate, toDate: range.endDate });
  const campaigns = aggregateCampaigns(rows);
  const profile = (await getProfile(shopId))?.profile || buildProfile(campaigns);
  const actions = await listActions({ shopId, status: 'draft', limit: 20 });

  const activeCampaigns = campaigns.filter((c) => c.expense > 0);
  const totalSpend = campaigns.reduce((s, c) => s + c.expense, 0);
  const totalGmv = campaigns.reduce((s, c) => s + c.broad_gmv, 0);
  const totalOrders = campaigns.reduce((s, c) => s + c.broad_order, 0);
  const totalDirectGmv = campaigns.reduce((s, c) => s + c.direct_gmv, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impression, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const overallRoas = totalSpend > 0 ? totalGmv / totalSpend : 0;
  const overallAcos = totalGmv > 0 ? (totalSpend / totalGmv) * 100 : 0;
  const avgDailySpend = totalSpend > 0 && days > 0 ? totalSpend / days : 0;

  const context = {
    days,
    date_range: range,
    campaigns_count: campaigns.length,
    active_campaigns_count: activeCampaigns.length,
    profile,
    account_summary: {
      total_spend_period: Number(totalSpend.toFixed(2)),
      total_gmv_period: Number(totalGmv.toFixed(2)),
      total_direct_gmv_period: Number(totalDirectGmv.toFixed(2)),
      total_orders_period: totalOrders,
      total_impressions_period: totalImpressions,
      total_clicks_period: totalClicks,
      overall_roas: Number(overallRoas.toFixed(2)),
      overall_acos_pct: Number(overallAcos.toFixed(2)),
      avg_daily_spend: Number(avgDailySpend.toFixed(2)),
      note_saldo: 'Saldo da conta Shopee Ads nao esta disponivel via API para esta conta. Consulte o painel Shopee Seller Center > Anuncios > Conta de Anuncios para ver o saldo atual.',
    },
    top_campaigns: campaigns
      .slice()
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 10),
    worst_campaigns: campaigns
      .filter((c) => c.expense > 0)
      .sort((a, b) => a.roas - b.roas)
      .slice(0, 5),
    zero_impression_campaigns: campaigns.filter((c) => c.impression === 0).length,
    draft_actions: actions,
  };

  const answer = await chatWithAdsSpecialist({
    shopId,
    message,
    context,
  });

  await supabase.from('ads_agent_chat_logs').insert({
    shop_id: String(shopId),
    user_message: String(message || ''),
    agent_answer: answer?.text || answer?.fallback || answer?.message || JSON.stringify(answer),
    context,
    created_at: new Date().toISOString(),
  });

  return {
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    shop_id: String(shopId),
    answer,
    context,
  };
}

async function runAutomatedCycle({ shopId, days = 14, autoApprove = false, dryRun = true }) {
  const rec = await recommend({ shopId, days, syncBefore: true });

  if (autoApprove) {
    for (const action of rec.actions) {
      await approveAction(action.id);
    }
  }

  const confirmation = await prepareExecutionConfirmation({ shopId, dryRun, limit: 50 });
  return {
    workflow_id: ADS_AGENT_WORKFLOW_ID,
    recommendation: rec,
    confirmation,
  };
}

module.exports = {
  trainAgent,
  recommend,
  listActions,
  approveAction,
  deleteAction,
  executeSingleAction,
  executeApprovedActions,
  prepareExecutionConfirmation,
  executeWithConfirmation,
  chat,
  runAutomatedCycle,
  getProfile,
};
