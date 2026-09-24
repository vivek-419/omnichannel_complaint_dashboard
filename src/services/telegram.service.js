const { getConfig } = require('../config/env.config');
const ticketStore = require('../stores/ticket.store');

let pollingActive = false;
let pollingAbortController = null;
let lastUpdateId = 0;
let botInfo = null;

let botStatus = {
  configured: false,
  connected: false,
  botUsername: null,
  botName: null,
  error: null
};

// Test token and get bot details from Telegram API
async function testTelegramToken(token) {
  const url = `https://api.telegram.org/bot${token}/getMe`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || 'Invalid Telegram Bot Token');
  }
  return data.result;
}

// Initialize Telegram polling engine
async function initTelegramBot(customToken = null) {
  const token = customToken || getConfig().telegramBotToken;

  // Stop any existing polling loop
  stopTelegramPolling();

  if (!token || token.trim() === '') {
    botStatus = {
      configured: false,
      connected: false,
      botUsername: null,
      botName: null,
      error: 'Telegram Bot Token not configured'
    };
    console.log('[Telegram] ℹ️ Telegram Bot Token is not configured. Telegram listener is idle.');
    return botStatus;
  }

  try {
    console.log('[Telegram] Connecting to Telegram Bot API...');
    const me = await testTelegramToken(token.trim());
    botInfo = me;
    botStatus = {
      configured: true,
      connected: true,
      botUsername: me.username,
      botName: me.first_name,
      error: null
    };
    console.log(`[Telegram] ✅ Telegram Bot connected successfully as @${me.username} ("${me.first_name}")`);

    // Start background long polling loop
    startTelegramPolling(token.trim());

    return botStatus;
  } catch (err) {
    console.error('[Telegram Init Error]:', err.message);
    botStatus = {
      configured: true,
      connected: false,
      botUsername: null,
      botName: null,
      error: err.message
    };
    return botStatus;
  }
}

function stopTelegramPolling() {
  pollingActive = false;
  if (pollingAbortController) {
    try {
      pollingAbortController.abort();
    } catch (e) {}
    pollingAbortController = null;
  }
}

// Continuous long-polling loop
async function startTelegramPolling(token) {
  pollingActive = true;
  pollingAbortController = new AbortController();

  console.log('[Telegram] 📡 Real-time Telegram message listener started (polling active).');

  (async () => {
    while (pollingActive) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url, { signal: pollingAbortController.signal });
        const data = await res.json();

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);
            if (update.message) {
              await handleIncomingTelegramMessage(token, update.message);
            }
          }
        }
      } catch (err) {
        if (!pollingActive) break; // Exited intentionally
        if (err.name !== 'AbortError') {
          console.error('[Telegram Polling Warning]:', err.message);
          // Wait 3 seconds before reconnecting on network glitch
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
  })();
}

// Process an incoming Telegram message
async function handleIncomingTelegramMessage(token, msg) {
  try {
    const text = msg.text || msg.caption || '';
    if (!text) return; // Skip non-text messages if empty

    const chatId = msg.chat.id;
    const messageId = msg.message_id.toString();
    const senderName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || 'Telegram User';
    const usernameTag = msg.from.username ? ` (@${msg.from.username})` : '';
    const formattedSender = `${senderName}${usernameTag}`;

    // Handle initial /start greeting
    if (text.trim().toLowerCase() === '/start') {
      await sendTelegramMessageDirect(token, chatId, `👋 Welcome to **CCMRS Support Workspace**!\n\nPlease type your complaint, order issue, or question here. Our support team will assist you immediately.`, msg.message_id);
      return;
    }

    // Generate clean ticket subject
    const previewSubject = text.length > 50 ? `${text.substring(0, 47)}...` : text;
    const subject = `Telegram Grievance: ${previewSubject}`;

    const ticketData = {
      channel: 'telegram',
      channelMessageId: `tg_${chatId}_${messageId}`,
      chatId: chatId.toString(),
      sender: formattedSender,
      senderId: msg.from.id.toString(),
      subject: subject,
      message: text,
      timestamp: new Date(msg.date * 1000).toISOString()
    };

    const { ticket, isNew } = ticketStore.addTicket(ticketData);

    // Send automatic acknowledgment back to user on new complaint
    if (isNew) {
      await sendTelegramMessageDirect(
        token,
        chatId,
        `🎫 **Support Ticket Created: [${ticket.ticketId}]**\n\nThank you for reaching out. We have logged your grievance as **${ticket.priority}** priority.\nA support agent is reviewing your request and will reply here shortly.`,
        msg.message_id
      );
    }
  } catch (err) {
    console.error('[Telegram Message Handler Error]:', err);
  }
}

// Low-level helper to send Telegram message
async function sendTelegramMessageDirect(token, chatId, text, replyToMessageId = null) {
  try {
    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    };
    if (replyToMessageId) {
      body.reply_to_message_id = parseInt(replyToMessageId, 10);
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error('[Telegram send error]:', e.message);
  }
}

// Send an agent reply back to customer in Telegram
async function sendTelegramReply(chatId, replyText, replyToMessageId = null) {
  const token = getConfig().telegramBotToken;
  if (!token) {
    throw new Error('Telegram Bot Token not configured in .env');
  }

  let parsedReplyTo = null;
  if (replyToMessageId) {
    const match = replyToMessageId.toString().match(/_(\d+)$/);
    const numId = match ? match[1] : replyToMessageId;
    if (!isNaN(parseInt(numId, 10))) {
      parsedReplyTo = parseInt(numId, 10);
    }
  }

  const result = await sendTelegramMessageDirect(
    token.trim(),
    chatId,
    `🧑‍💼 **Support Agent Resolution:**\n\n${replyText}`,
    parsedReplyTo
  );

  if (!result || !result.ok) {
    throw new Error((result && result.description) || 'Failed to send message via Telegram Bot API');
  }

  return result;
}

// Webhook payload processor (if webhook mode is used)
async function processTelegramWebhookUpdate(update) {
  const token = getConfig().telegramBotToken;
  if (update && update.message && token) {
    await handleIncomingTelegramMessage(token.trim(), update.message);
  }
}

function getTelegramStatus() {
  return { ...botStatus };
}

module.exports = {
  initTelegramBot,
  sendTelegramReply,
  processTelegramWebhookUpdate,
  getTelegramStatus
};
