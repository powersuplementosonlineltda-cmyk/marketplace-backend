const adsAgentService = require('../services/adsAgentService');

async function trainAdsSpecialist(input) {
  const shopId = String(input.shopId || '').trim();
  if (!shopId) throw new Error('shopId is required');
  return adsAgentService.trainAgent({ shopId, days: input.days });
}

async function runAdsSpecialistRecommendations(input) {
  const shopId = String(input.shopId || '').trim();
  if (!shopId) throw new Error('shopId is required');
  return adsAgentService.recommend({
    shopId,
    days: input.days,
    syncBefore: input.syncBefore !== false,
  });
}

async function runAdsSpecialistCycle(input) {
  const shopId = String(input.shopId || '').trim();
  if (!shopId) throw new Error('shopId is required');
  return adsAgentService.runAutomatedCycle({
    shopId,
    days: input.days,
    autoApprove: Boolean(input.autoApprove),
    dryRun: input.dryRun !== false,
  });
}

module.exports = {
  trainAdsSpecialist,
  runAdsSpecialistRecommendations,
  runAdsSpecialistCycle,
};
