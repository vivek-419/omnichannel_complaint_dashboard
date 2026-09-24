const ticketStore = require('../stores/ticket.store');
const walletStore = require('../stores/wallet.store');
const { sendEmailReply } = require('../services/gmail.service');
const { sendTelegramReply } = require('../services/telegram.service');
const { sendDiscordReply } = require('../services/discord.service');

// GET /api/tickets
function getTickets(req, res) {
  const { channel, status, priority, search, agentId } = req.query;
  const filtered = ticketStore.getTickets({ channel, status, priority, search, agentId });

  res.json({
    success: true,
    total: filtered.length,
    allCount: ticketStore.getTickets().length,
    data: filtered
  });
}

// GET /api/tickets/:id
function getTicketById(req, res) {
  const { id } = req.params;
  const ticket = ticketStore.getTicketById(id);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }
  res.json({ success: true, ticket });
}

// POST /api/tickets/:id/reply - Unified Omnichannel Dispatcher
async function replyTicket(req, res) {
  const { id } = req.params;
  const { replyMessage, agentName = (req.user ? req.user.name : 'Support Agent') } = req.body;

  const ticket = ticketStore.getTicketById(id);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  if (!replyMessage || replyMessage.trim() === '') {
    return res.status(400).json({ success: false, message: 'Reply message cannot be empty' });
  }

  try {
    let dispatchResult = null;
    const channel = ticket.channel.toLowerCase();

    if (channel === 'gmail') {
      const emailMatch = ticket.sender.match(/<([^>]+)>/) || [null, ticket.sender];
      const targetEmail = emailMatch[1] || ticket.sender;
      dispatchResult = await sendEmailReply(targetEmail, ticket.subject, replyMessage, ticket.channelMessageId);
    } else if (channel === 'telegram') {
      if (!ticket.chatId) {
        throw new Error('No Telegram Chat ID associated with this ticket.');
      }
      dispatchResult = await sendTelegramReply(ticket.chatId, replyMessage, ticket.channelMessageId);
    } else if (channel === 'discord') {
      dispatchResult = await sendDiscordReply(ticket.channelId, replyMessage, ticket.channelMessageId);
    } else {
      dispatchResult = { note: `Simulated dispatch for channel ${channel}` };
    }

    // Record reply and update status
    const updatedTicket = ticketStore.recordAgentReply(id, replyMessage.trim(), agentName);

    res.json({
      success: true,
      message: `Reply successfully dispatched via ${ticket.channel.toUpperCase()}!`,
      ticket: updatedTicket,
      dispatchResult
    });
  } catch (err) {
    console.error(`[Reply Error on ${ticket.channel}]:`, err);
    res.status(500).json({
      success: false,
      message: `Failed to dispatch reply via ${ticket.channel.toUpperCase()}: ${err.message}`
    });
  }
}

// POST /api/tickets/:id/classify
function classifyTicket(req, res) {
  const { id } = req.params;
  const { priority, category, updatedBy = (req.user ? req.user.name : 'Support Staff') } = req.body;

  if (!priority && !category) {
    return res.status(400).json({ success: false, message: 'Please provide priority or category to update.' });
  }

  const updated = ticketStore.updateTicketClassification(id, { priority, category }, updatedBy);
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  res.json({
    success: true,
    message: `Ticket updated: Priority=${updated.priority}, Category=${updated.category}`,
    ticket: updated
  });
}

// POST /api/tickets/:id/reassign
function reassignTicket(req, res) {
  const { id } = req.params;
  const { agentId, agentName } = req.body;

  if (!agentName) {
    return res.status(400).json({ success: false, message: 'Agent name is required.' });
  }

  const updated = ticketStore.reassignTicket(id, agentId, agentName);
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  res.json({ success: true, message: `Ticket reassigned to ${agentName}`, ticket: updated });
}

// PATCH /api/tickets/:id/status
function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  const updated = ticketStore.updateTicketStatus(id, status);
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  res.json({ success: true, ticket: updated });
}

// DELETE /api/tickets/:id
function deleteTicket(req, res) {
  const { id } = req.params;
  const deleted = ticketStore.deleteTicket(id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }
  res.json({ success: true, message: 'Ticket removed', ticket: deleted });
}

// POST /api/tickets/:id/issue-reward
async function issueReward(req, res) {
  const { id } = req.params;
  const { points = 50, discount = '10%', reason = 'Service Apology' } = req.body;

  const ticket = ticketStore.getTicketById(id);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  const customerId = walletStore.normalizeCustomerId(ticket);

  try {
    const result = walletStore.issueReward(customerId, ticket.sender, {
      points: parseInt(points, 10) || 50,
      discount: discount || '10%',
      reason: reason || 'Service Apology',
      ticketId: ticket.ticketId
    });

    // Stamp reward on the ticket record
    ticket.loyaltyReward = {
      voucherCode: result.voucher.code,
      points: result.pointsAdded,
      discount: result.voucher.discount,
      reason: result.voucher.reason,
      issuedAt: result.voucher.issuedAt
    };
    ticketStore.saveTickets();

    // Auto-dispatch formatted reward confirmation to customer's native channel
    const rewardNotificationText = `🎁 **Service Apology Compensation Credit**\n\nWe sincerely apologize for the inconvenience regarding your grievance [**${ticket.ticketId}**].\n\n• **Loyalty Points Credited:** +${result.pointsAdded} Points\n• **Apology Discount Code:** \`${result.voucher.code}\` (${result.voucher.discount} off your next order)\n• **Updated Wallet Balance:** ${result.wallet.pointsBalance} Points\n\nThank you for choosing us!`;

    let dispatchResult = null;
    const channel = ticket.channel.toLowerCase();

    if (channel === 'telegram' && ticket.chatId) {
      dispatchResult = await sendTelegramReply(ticket.chatId, rewardNotificationText, ticket.channelMessageId).catch(e => ({ error: e.message }));
    } else if (channel === 'discord' && ticket.channelId) {
      dispatchResult = await sendDiscordReply(ticket.channelId, rewardNotificationText, ticket.channelMessageId).catch(e => ({ error: e.message }));
    } else if (channel === 'gmail') {
      const emailMatch = ticket.sender.match(/<([^>]+)>/) || [null, ticket.sender];
      const targetEmail = emailMatch[1] || ticket.sender;
      dispatchResult = await sendEmailReply(targetEmail, `🎁 Service Apology & Loyalty Credit [${ticket.ticketId}]`, rewardNotificationText, ticket.channelMessageId).catch(e => ({ error: e.message }));
    }

    res.json({
      success: true,
      message: `Successfully issued ${result.pointsAdded} points & Voucher [${result.voucher.code}] to customer!`,
      wallet: result.wallet,
      voucher: result.voucher,
      ticket,
      dispatchResult
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// POST /api/simulate-message
function simulateMessage(req, res) {
  const { channel = 'telegram', sender, message, subject, chatId, channelId, priority } = req.body;

  if (!message || message.trim() === '') {
    return res.status(400).json({ success: false, message: 'Message content is required.' });
  }

  const simulatedData = {
    channel: channel.toLowerCase(),
    sender: sender || (channel === 'telegram' ? 'Alex Kumar (@alex_k)' : (channel === 'discord' ? 'Priya_R#4421' : 'customer@example.com')),
    subject: subject || `Urgent issue with order via ${channel}`,
    message: message.trim(),
    priority: priority || undefined,
    chatId: chatId || '123456789',
    channelId: channelId || '987654321',
    channelMessageId: `sim_${channel}_${Date.now()}`
  };

  const { ticket, isNew } = ticketStore.addTicket(simulatedData);

  res.json({
    success: true,
    message: `Simulated ${channel.toUpperCase()} message received and ticket created!`,
    ticket,
    isNew
  });
}

module.exports = {
  getTickets,
  getTicketById,
  replyTicket,
  classifyTicket,
  reassignTicket,
  updateStatus,
  deleteTicket,
  issueReward,
  simulateMessage
};
