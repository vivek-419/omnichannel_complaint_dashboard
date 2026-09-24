const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { getConfigPath } = require('./paths.config');

const CONFIG_FILE = getConfigPath('config.json');

function loadConfig() {
  let cfg = {
    port: parseInt(process.env.PORT, 10) || 5001,
    jwtSecret: process.env.JWT_SECRET || 'ccmrs_super_secret_jwt_key_2026',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    discordBotToken: process.env.DISCORD_BOT_TOKEN || '',
    discordChannelId: process.env.DISCORD_CHANNEL_ID || '',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: parseInt(process.env.SMTP_PORT, 10) || 587,
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || ''
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg = { ...cfg, ...saved };
    }
  } catch (e) {
    console.error('[Config] Error reading config.json:', e.message);
  }

  return cfg;
}

function saveConfig(newConfig) {
  try {
    const current = loadConfig();
    const updated = { ...current, ...newConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return { success: true, config: updated };
  } catch (err) {
    console.error('[Config] Error saving config.json:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  getConfig: loadConfig,
  saveConfig
};
