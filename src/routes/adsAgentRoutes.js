const express = require('express');
const {
  trainAdsSpecialist,
  runAdsSpecialistRecommendations,
  runAdsSpecialistCycle,
} = require('../agents/adsSpecialistAgent');
const adsAgentService = require('../services/adsAgentService');
const adsOperationsService = require('../services/adsOperationsService');

const router = express.Router();

router.post('/ads-agent/train', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await trainAdsSpecialist({
      shopId: body.shop_id || req.query.shop_id,
      days: body.days || req.query.days || 14,
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/ads-agent/recommend', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runAdsSpecialistRecommendations({
      shopId: body.shop_id || req.query.shop_id,
      days: body.days || req.query.days || 14,
      syncBefore: body.sync_before !== false,
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/ads-agent/cycle', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runAdsSpecialistCycle({
      shopId: body.shop_id || req.query.shop_id,
      days: body.days || req.query.days || 14,
      autoApprove: Boolean(body.auto_approve),
      dryRun: body.dry_run !== false,
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.get('/ads-agent/profile', async (req, res) => {
  try {
    const shopId = String(req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const profile = await adsAgentService.getProfile(shopId);
    return res.json({ ok: true, data: profile });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.get('/ads-agent/actions', async (req, res) => {
  try {
    const shopId = String(req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const actions = await adsAgentService.listActions({
      shopId,
      status: req.query.status || 'draft',
      limit: req.query.limit || 100,
    });
    return res.json({ ok: true, data: actions });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.delete('/ads-agent/actions/:id', async (req, res) => {
  try {
    const result = await adsAgentService.deleteAction(req.params.id);
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/ads-agent/actions/:id/execute-single', async (req, res) => {
  try {
    const body = req.body || {};
    const shopId = String(body.shop_id || req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const result = await adsAgentService.executeSingleAction({
      shopId,
      actionId: req.params.id,
      dryRun: body.dry_run !== false,
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/ads-agent/actions/:id/approve', async (req, res) => {
  try {
    const result = await adsAgentService.approveAction(req.params.id);
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/ads-agent/actions/execute', async (req, res) => {
  try {
    const body = req.body || {};
    const shopId = String(body.shop_id || req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');

    const result = await adsAgentService.prepareExecutionConfirmation({
      shopId,
      dryRun: body.dry_run !== false,
      limit: body.limit || 20,
    });

    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/ads-agent/actions/execute/confirm', async (req, res) => {
  try {
    const body = req.body || {};
    const shopId = String(body.shop_id || req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');

    const result = await adsAgentService.executeWithConfirmation({
      shopId,
      confirmationToken: body.confirmation_token || req.query.confirmation_token,
      confirmationCode: body.confirmation_code || req.query.confirmation_code,
    });

    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/ads-agent/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const shopId = String(body.shop_id || req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');

    const result = await adsAgentService.chat({
      shopId,
      message: body.message || req.query.message || '',
      days: body.days || req.query.days || 14,
    });

    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

// ===== AGENT ADS OPERATIONS =====

router.post('/agent/ads/pause-campaign', async (req, res) => {
  try {
    const body = req.body || {};
    const shopId = String(body.shop_id || req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const campaignId = String(body.campaign_id || req.query.campaign_id || '').trim();
    if (!campaignId) throw new Error('campaign_id is required');

    const result = await adsOperationsService.pauseCampaign({ shopId, campaignId });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/agent/ads/enable-campaign', async (req, res) => {
  try {
    const body = req.body || {};
    const shopId = String(body.shop_id || req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const campaignId = String(body.campaign_id || req.query.campaign_id || '').trim();
    if (!campaignId) throw new Error('campaign_id is required');

    const result = await adsOperationsService.enableCampaign({ shopId, campaignId });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.post('/agent/ads/update-budget', async (req, res) => {
  try {
    const body = req.body || {};
    const shopId = String(body.shop_id || req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const campaignId = String(body.campaign_id || req.query.campaign_id || '').trim();
    if (!campaignId) throw new Error('campaign_id is required');

    const result = await adsOperationsService.updateBudget({
      shopId,
      campaignId,
      budget: body.budget || req.query.budget,
      budgetMultiplier: body.budget_multiplier || req.query.budget_multiplier,
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.get('/agent/ads/campaigns', async (req, res) => {
  try {
    const shopId = String(req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const limit = req.query.limit || 100;

    const result = await adsOperationsService.getCampaigns({ shopId, limit });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

router.get('/agent/ads/performance', async (req, res) => {
  try {
    const shopId = String(req.query.shop_id || '').trim();
    if (!shopId) throw new Error('shop_id is required');
    const campaignId = req.query.campaign_id ? String(req.query.campaign_id).trim() : undefined;
    const days = req.query.days || 14;

    const result = await adsOperationsService.getPerformance({ shopId, campaignId, days });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

module.exports = router;
