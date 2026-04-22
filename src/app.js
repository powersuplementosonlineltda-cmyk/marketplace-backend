const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const auth = require('./middleware/auth');
const agentInventoryRoutes = require('./routes/agentInventoryRoutes');
const adsAgentRoutes = require('./routes/adsAgentRoutes');
const { runAdsSpecialistCycle } = require('./agents/adsSpecialistAgent');

const app = express();
const port = Number(process.env.PORT || process.env.APP_PORT || 4000);

app.use(express.json());
app.use('/cockpit', express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'inventory-agent-api' });
});

app.get('/ads-cockpit', (_req, res) => {
  return res.redirect('/cockpit/ads-cockpit.html');
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
