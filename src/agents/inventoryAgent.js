const inventoryService = require('../services/inventoryService');

async function runInventoryAgent(input) {
  const shopId = (input.shopId || '').toString().trim();
  if (!shopId) {
    throw new Error('shopId is required');
  }

  return inventoryService.getCampaignInventory({
    shopId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    limit: input.limit,
  });
}

module.exports = {
  runInventoryAgent,
};
