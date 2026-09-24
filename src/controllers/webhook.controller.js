const { processTelegramWebhookUpdate } = require('../services/telegram.service');

// POST /api/webhooks/telegram
async function handleTelegramWebhook(req, res) {
  try {
    await processTelegramWebhookUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('Telegram webhook error:', err);
    res.sendStatus(500);
  }
}

// POST /api/webhooks/discord
function handleDiscordWebhook(req, res) {
  res.status(200).json({ type: 1 });
}

module.exports = {
  handleTelegramWebhook,
  handleDiscordWebhook
};
