const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getConfig } = require('../config/env.config');
const ticketStore = require('../stores/ticket.store');

let client = null;
let discordStatus = {
  configured: false,
  connected: false,
  botTag: null,
  botId: null,
  guildCount: 0,
  error: null
};

// Initialize or restart Discord Bot Client
async function initDiscordBot(customToken = null) {
  const token = customToken || getConfig().discordBotToken;

  // Destroy existing client if running
  if (client) {
    try {
      await client.destroy();
    } catch (e) {
      console.error('[Discord] Error destroying existing client:', e.message);
    }
    client = null;
  }

  if (!token || token.trim() === '') {
    discordStatus = {
      configured: false,
      connected: false,
      botTag: null,
      botId: null,
      guildCount: 0,
      error: 'Discord Bot Token not configured'
    };
    console.log('[Discord] ℹ️ Discord Bot Token is not configured. Discord listener is idle.');
    return discordStatus;
  }

  try {
    console.log('[Discord] Initializing Discord Bot Client...');
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ],
      partials: [Partials.Channel, Partials.Message]
    });

    client.once('clientReady', () => {
      discordStatus = {
        configured: true,
        connected: true,
        botTag: client.user.tag,
        botId: client.user.id,
        guildCount: client.guilds.cache.size,
        error: null
      };
      console.log(`[Discord] ✅ Discord Bot connected successfully as ${client.user.tag} (Active in ${client.guilds.cache.size} server(s))`);
    });

    client.on('messageCreate', async (message) => {
      handleIncomingDiscordMessage(message);
    });

    client.on('error', (err) => {
      console.error('[Discord Client Error]:', err.message || err);
      discordStatus.connected = false;
      discordStatus.error = err.message;
    });

    await client.login(token.trim());
    return discordStatus;
  } catch (err) {
    console.error('[Discord Init Error]:', err.message);
    discordStatus = {
      configured: true,
      connected: false,
      botTag: null,
      botId: null,
      guildCount: 0,
      error: err.message
    };
    return discordStatus;
  }
}

// Process incoming Discord message
async function handleIncomingDiscordMessage(message) {
  try {
    // Ignore messages sent by any bot (including ourselves)
    if (message.author.bot) return;

    const content = message.content ? message.content.trim() : '';
    if (!content) return; // Skip empty messages

    const senderName = message.author.globalName || message.author.username;
    const authorTag = message.author.discriminator && message.author.discriminator !== '0'
      ? `${message.author.username}#${message.author.discriminator}`
      : `@${message.author.username}`;
    const formattedSender = `${senderName} (${authorTag})`;

    const channelName = message.channel && message.channel.name ? `#${message.channel.name}` : 'Direct Message';
    const previewSubject = content.length > 50 ? `${content.substring(0, 47)}...` : content;
    const subject = `Discord (${channelName}): ${previewSubject}`;

    const ticketData = {
      channel: 'discord',
      channelMessageId: `dc_${message.channelId}_${message.id}`,
      channelId: message.channelId,
      sender: formattedSender,
      senderId: message.author.id,
      subject: subject,
      message: content,
      timestamp: message.createdAt ? message.createdAt.toISOString() : new Date().toISOString()
    };

    const { ticket, isNew } = ticketStore.addTicket(ticketData);

    // Send automated acknowledgment back in the Discord channel
    if (isNew) {
      try {
        await message.reply({
          content: `🎫 **Ticket Registered:** \`${ticket.ticketId}\`\nYour complaint has been queued with **${ticket.priority}** priority. Our support agent will assist you here shortly.`
        });
      } catch (replyErr) {
        console.error('[Discord] Failed to send ticket acknowledgment:', replyErr.message);
      }
    }
  } catch (err) {
    console.error('[Discord Message Handler Error]:', err);
  }
}

// Send an agent reply back to customer in Discord
async function sendDiscordReply(channelId, replyText, replyToMessageId = null) {
  if (!client || !discordStatus.connected) {
    const token = getConfig().discordBotToken;
    if (token) {
      await initDiscordBot(token);
    }
  }

  if (!client) {
    throw new Error('Discord Bot is not connected. Please configure a valid DISCORD_BOT_TOKEN.');
  }

  const targetChannelId = channelId || getConfig().discordChannelId;
  if (!targetChannelId) {
    throw new Error('No Discord Channel ID specified for dispatch.');
  }

  const channel = await client.channels.fetch(targetChannelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Discord channel ${targetChannelId} not found or is not text-based.`);
  }

  let formattedReply = `🧑‍💼 **Support Agent Resolution:**\n\n${replyText}`;

  let parsedMessageId = null;
  if (replyToMessageId) {
    const match = replyToMessageId.toString().match(/_(\d+)$/);
    parsedMessageId = match ? match[1] : replyToMessageId;
  }

  if (parsedMessageId) {
    try {
      const originalMessage = await channel.messages.fetch(parsedMessageId);
      if (originalMessage) {
        return await originalMessage.reply({ content: formattedReply });
      }
    } catch (e) {
      // Fall back to normal channel send if reply target message not found
    }
  }

  return await channel.send({ content: formattedReply });
}

function getDiscordStatus() {
  return { ...discordStatus };
}

module.exports = {
  initDiscordBot,
  sendDiscordReply,
  getDiscordStatus
};
