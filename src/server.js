const app = require('./app');
const { getConfig } = require('./config/env.config');
const { initDatabase } = require('./config/database.config');
const ticketStore = require('./stores/ticket.store');
const notificationService = require('./services/notification.service');
const { syncGmailComplaints } = require('./controllers/channel.controller');
const { initTelegramBot } = require('./services/telegram.service');
const { initDiscordBot } = require('./services/discord.service');

const PORT = getConfig().port || process.env.PORT || 5001;

// ==========================================
// BACKGROUND JOBS & LISTENERS
// ==========================================

// 1. Start SLA Escalation background poller (runs every 20s)
notificationService.startEscalationPoller(ticketStore, 20000);

// 2. Auto-sync Gmail every 15 seconds
setInterval(() => {
  syncGmailComplaints();
}, 15000);

// ==========================================
// START SERVER
// ==========================================
const server = app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 CCMRS Omnichannel Platform running at: http://localhost:${PORT}`);
  console.log(`🌐 Web Portal & Workspace: http://localhost:${PORT}/index.html`);
  console.log(`📩 Unified Tickets API: http://localhost:${PORT}/api/tickets`);
  console.log(`======================================================\n`);

  // 1. Connect and initialize PostgreSQL Database
  await initDatabase();

  // 2. Initialize Telegram Bot
  await initTelegramBot();

  // 3. Initialize Discord Bot
  await initDiscordBot();

  // 4. Trigger initial Gmail check
  syncGmailComplaints();
});

module.exports = server;
