const express = require('express');
const { runInventoryAgent } = require('../agents/inventoryAgent');

const router = express.Router();

router.get('/inventory', async (req, res) => {
  try {
    const result = await runInventoryAgent({
      shopId: req.query.shop_id,
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
      limit: req.query.limit,
    });

    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
});

module.exports = router;
