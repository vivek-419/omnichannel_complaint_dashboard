const { saveConfig } = require('../config/env.config');
const ticketStore = require('../stores/ticket.store');
const { fetchComplaintEmails, getGmailStatus } = require('../services/gmail.service');
const { initTelegramBot, getTelegramStatus } = require('../services/telegram.service');
const { initDiscordBot, getDiscordStatus } = require('../services/discord.service');

// Sync emails from Gmail into central ticketStore
async function syncGmailComplaints() {
  try {
    const gmailStatus = getGmailStatus();
    if (!gmailStatus.connected) {
      return { success: false, error: gmailStatus.error || 'Gmail not authenticated' };
    }

    const newComplaints = await fetchComplaintEmails(30);
    let addedCount = 0;

    for (const item of newComplaints) {
      const { isNew } = ticketStore.addTicket(item);
      if (isNew) addedCount++;
    }

    if (addedCount > 0) {
      console.log(`[Gmail Sync] Added ${addedCount} new complaint(s). Total tickets: ${ticketStore.getTickets().length}`);
    }
    return { success: true, total: ticketStore.getTickets().length, added: addedCount };
  } catch (err) {
    console.error('[Gmail Sync Error]:', err.message);
    return { success: false, error: err.message };
  }
}

// GET /api/channels/status
function getStatus(req, res) {
  res.json({
    success: true,
    channels: {
      gmail: getGmailStatus(),
      telegram: getTelegramStatus(),
      discord: getDiscordStatus()
    }
  });
}

// POST /api/channels/config
async function updateConfig(req, res) {
  const { telegramBotToken, discordBotToken, discordChannelId } = req.body;
  const updates = {};

  if (typeof telegramBotToken === 'string') updates.telegramBotToken = telegramBotToken.trim();
  if (typeof discordBotToken === 'string') updates.discordBotToken = discordBotToken.trim();
  if (typeof discordChannelId === 'string') updates.discordChannelId = discordChannelId.trim();

  saveConfig(updates);

  if (updates.telegramBotToken !== undefined) {
    await initTelegramBot(updates.telegramBotToken);
  }
  if (updates.discordBotToken !== undefined) {
    await initDiscordBot(updates.discordBotToken);
  }

  res.json({
    success: true,
    message: 'Channel configurations updated and services re-initialized!',
    channels: {
      gmail: getGmailStatus(),
      telegram: getTelegramStatus(),
      discord: getDiscordStatus()
    }
  });
}

// POST /api/sync
async function syncGmail(req, res) {
  const result = await syncGmailComplaints();
  res.json(result);
}

module.exports = {
  getStatus,
  updateConfig,
  syncGmail,
  syncGmailComplaints
};
