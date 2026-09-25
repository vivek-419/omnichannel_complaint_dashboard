const fs = require('fs');
const { getDataPath } = require('../config/paths.config');
const notificationService = require('../services/notification.service');
const { dbSaveTicket, dbFetchAllTickets } = require('../services/db.service');

const DB_FILE = getDataPath('tickets.json');

// In-memory ticket cache
let tickets = [];

// Load persisted tickets on startup
function loadTickets() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      tickets = JSON.parse(data);
      // Sort newest first
      tickets.sort((a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0));
      console.log(`[TicketStore] Loaded ${tickets.length} tickets (in-memory + JSON backup)`);
    } else {
      tickets = [];
    }
  } catch (err) {
    console.error('[TicketStore] Error loading tickets.json:', err.message);
    tickets = [];
  }
}

// Save tickets to disk & sync to PostgreSQL
function saveTickets() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(tickets, null, 2), 'utf8');
    // Asynchronously sync active tickets to PostgreSQL
    for (const t of tickets.slice(0, 50)) {
      dbSaveTicket(t).catch(() => {});
    }
  } catch (err) {
    console.error('[TicketStore] Error saving tickets:', err.message);
  }
}

// Rule-based priority detector based on complaint content
function detectPriority(subject = '', body = '') {
  const content = `${subject} ${body}`.toLowerCase();
  if (
    content.includes('urgent') ||
    content.includes('immediately') ||
    content.includes('emergency') ||
    content.includes('fraud') ||
    content.includes('unauthorized') ||
    content.includes('critical')
  ) {
    return 'Critical';
  }
  if (
    content.includes('delay') ||
    content.includes('refund') ||
    content.includes('cancel') ||
    content.includes('damaged') ||
    content.includes('broken') ||
    content.includes('missing') ||
    content.includes('stolen')
  ) {
    return 'High';
  }
  if (
    content.includes('wrong') ||
    content.includes('not working') ||
    content.includes('issue') ||
    content.includes('complaint') ||
    content.includes('problem') ||
    content.includes('error') ||
    content.includes('bug')
  ) {
    return 'Medium';
  }
  return 'Low';
}

// Rule-based sentiment detector
function detectSentiment(text = '') {
  const lower = (text || '').toLowerCase();
  const negativeWords = ['angry', 'worst', 'horrible', 'bad', 'scam', 'terrible', 'useless', 'broken', 'never', 'fail', 'hate', 'disappointed', 'poor', 'damaged', 'delay'];
  const positiveWords = ['thank', 'great', 'good', 'awesome', 'fixed', 'resolved', 'appreciate', 'happy', 'pleased', 'fast'];

  let negCount = 0;
  let posCount = 0;

  for (const w of negativeWords) {
    if (lower.includes(w)) negCount++;
  }
  for (const w of positiveWords) {
    if (lower.includes(w)) posCount++;
  }

  if (negCount > posCount) return 'Negative';
  if (posCount > negCount) return 'Positive';
  return 'Neutral';
}

// Helper to detect category for AI Insights
function detectCategory(text = '') {
  const lower = (text || '').toLowerCase();
  if (lower.includes('delivery') || lower.includes('delay') || lower.includes('tracking') || lower.includes('package') || lower.includes('courier')) {
    return 'Delayed Delivery';
  }
  if (lower.includes('damaged') || lower.includes('broken') || lower.includes('torn') || lower.includes('defective') || lower.includes('quality')) {
    return 'Damaged / Defective Item';
  }
  if (lower.includes('refund') || lower.includes('payment') || lower.includes('charged') || lower.includes('card') || lower.includes('double')) {
    return 'Billing & Refund';
  }
  if (lower.includes('login') || lower.includes('app') || lower.includes('crash') || lower.includes('bug') || lower.includes('error') || lower.includes('500')) {
    return 'App Technical Issue';
  }
  return 'General Inquiry';
}

// Helper to generate a unique Ticket ID
function generateTicketId(channel) {
  const prefixMap = {
    gmail: 'GMAIL',
    telegram: 'TG',
    discord: 'DC'
  };
  const prefix = prefixMap[channel] || 'TICK';
  const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${prefix}-${randomSuffix}`;
}

// Add or update a normalized complaint ticket
function addTicket(ticketData) {
  if (ticketData.channelMessageId) {
    const existing = tickets.find(
      t => t.channel === ticketData.channel && t.channelMessageId === ticketData.channelMessageId
    );
    if (existing) {
      if (ticketData.attachments && ticketData.attachments.length > 0) {
        existing.attachments = ticketData.attachments;
        saveTickets();
      }
      return { ticket: existing, isNew: false };
    }
  }

  const priority = ticketData.priority || detectPriority(ticketData.subject, ticketData.message);
  const timestamp = ticketData.timestamp || new Date().toISOString();
  const slaDeadline = ticketData.slaDeadline || notificationService.calculateSLADeadline(priority, timestamp);

  // Round-robin or default assign agent
  const defaultAgents = [
    { id: 'usr-agent-1', name: 'Rahul Sharma' },
    { id: 'usr-agent-2', name: 'Priya Patel' }
  ];
  const assigned = defaultAgents[tickets.length % defaultAgents.length];

  const normalized = {
    ticketId: ticketData.ticketId || generateTicketId(ticketData.channel),
    channel: ticketData.channel, // 'gmail' | 'telegram' | 'discord'
    channelMessageId: ticketData.channelMessageId || `${Date.now()}`,
    sender: ticketData.sender || 'Unknown Sender',
    senderId: ticketData.senderId || null,
    chatId: ticketData.chatId || null, // for Telegram
    channelId: ticketData.channelId || null, // for Discord
    subject: ticketData.subject || `Complaint via ${ticketData.channel}`,
    message: ticketData.message || '',
    category: detectCategory(ticketData.message || ticketData.subject),
    timestamp: timestamp,
    priority: priority,
    sentiment: ticketData.sentiment || detectSentiment(ticketData.message),
    status: ticketData.status || 'New',
    assignedAgentId: ticketData.assignedAgentId || assigned.id,
    assignedAgentName: ticketData.assignedAgentName || assigned.name,
    slaDeadline: slaDeadline,
    isEscalated: false,
    attachments: ticketData.attachments || [],
    messages: [
      {
        id: `msg-${Date.now()}-1`,
        senderType: 'customer',
        senderName: ticketData.sender || 'Customer',
        text: ticketData.message || '',
        timestamp: timestamp
      }
    ],
    agentReply: null,
    resolvedAt: null
  };

  tickets.unshift(normalized);
  saveTickets();

  // Create In-App & Email Notification
  notificationService.createNotification({
    type: 'NEW_COMPLAINT',
    ticket: normalized,
    title: `New ${normalized.channel.toUpperCase()} Grievance`,
    message: `${normalized.sender}: "${normalized.message.substring(0, 80)}..."`,
    priority: normalized.priority
  });

  console.log(`[TicketStore] 📥 New ${normalized.channel.toUpperCase()} Ticket created: [${normalized.ticketId}] assigned to ${normalized.assignedAgentName}`);
  return { ticket: normalized, isNew: true };
}

// Add an attachment to an existing ticket (e.g. uploaded via UI to AWS S3)
function addAttachment(ticketId, attachment) {
  const t = tickets.find(x => x.ticketId === ticketId);
  if (!t) return null;
  if (!t.attachments) t.attachments = [];
  t.attachments.push(attachment);
  saveTickets();
  return t;
}

// Retrieve all tickets with optional filtering
function getTickets(filter = {}) {
  let result = [...tickets];

  if (filter.channel && filter.channel !== 'all') {
    result = result.filter(t => t.channel === filter.channel);
  }

  if (filter.status && filter.status !== 'all') {
    result = result.filter(t => t.status === filter.status);
  }

  if (filter.priority && filter.priority !== 'all') {
    result = result.filter(t => t.priority === filter.priority);
  }

  if (filter.agentId && filter.agentId !== 'all') {
    result = result.filter(t => t.assignedAgentId === filter.agentId);
  }

  if (filter.search) {
    const q = filter.search.toLowerCase();
    result = result.filter(
      t =>
        t.ticketId.toLowerCase().includes(q) ||
        t.sender.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.message.toLowerCase().includes(q)
    );
  }

  // Ensure consistent newest-first ordering
  result.sort((a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0));

  return result;
}

// Find ticket by Ticket ID
function getTicketById(ticketId) {
  return tickets.find(t => t.ticketId === ticketId);
}

// Record an agent reply on a ticket
function recordAgentReply(ticketId, replyText, agentName = 'Support Agent') {
  const ticket = getTicketById(ticketId);
  if (!ticket) return null;

  ticket.agentReply = replyText;
  ticket.status = 'Resolved';
  ticket.resolvedAt = new Date().toISOString();

  if (!ticket.messages) {
    ticket.messages = [
      {
        id: `msg-${Date.now()}-c`,
        senderType: 'customer',
        senderName: ticket.sender,
        text: ticket.message,
        timestamp: ticket.timestamp
      }
    ];
  }

  ticket.messages.push({
    id: `msg-${Date.now()}-a`,
    senderType: 'agent',
    senderName: agentName,
    text: replyText,
    timestamp: new Date().toISOString()
  });

  saveTickets();
  return ticket;
}

// Reassign ticket to another agent
function reassignTicket(ticketId, newAgentId, newAgentName) {
  const ticket = getTicketById(ticketId);
  if (!ticket) return null;

  const prevAgent = ticket.assignedAgentName;
  ticket.assignedAgentId = newAgentId;
  ticket.assignedAgentName = newAgentName;
  saveTickets();

  notificationService.createNotification({
    type: 'REASSIGNED',
    ticket: ticket,
    title: `Ticket ${ticket.ticketId} Reassigned`,
    message: `Reassigned from ${prevAgent} to ${newAgentName}`,
    priority: ticket.priority
  });

  return ticket;
}

// Update ticket status
function updateTicketStatus(ticketId, status) {
  const ticket = getTicketById(ticketId);
  if (!ticket) return null;

  ticket.status = status;
  if (status === 'Resolved' && !ticket.resolvedAt) {
    ticket.resolvedAt = new Date().toISOString();
  }
  saveTickets();
  return ticket;
}

// Manually update ticket priority and category (Agent/Manager Override)
function updateTicketClassification(ticketId, { priority, category }, updatedBy = 'Support Staff') {
  const ticket = getTicketById(ticketId);
  if (!ticket) return null;

  const validPriorities = ['Critical', 'High', 'Medium', 'Low'];
  const validCategories = ['Delayed Delivery', 'Damaged / Defective Item', 'Billing & Refund', 'App Technical Issue', 'General Inquiry'];

  const changes = [];
  const oldPriority = ticket.priority;
  const oldCategory = ticket.category;

  if (priority && validPriorities.includes(priority) && priority !== ticket.priority) {
    ticket.priority = priority;
    changes.push(`Priority changed from "${oldPriority}" to "${priority}"`);

    // Recalculate SLA Target Window if ticket is not yet resolved
    if (ticket.status !== 'Resolved') {
      const now = Date.now();
      const slaMinutesMap = {
        'Critical': 15,
        'High': 60,
        'Medium': 240,
        'Low': 1440
      };
      const mins = slaMinutesMap[priority] || 240;
      const createdAtMs = new Date(ticket.timestamp).getTime();
      const candidateDeadline = createdAtMs + mins * 60 * 1000;
      ticket.slaDeadline = new Date(Math.max(now + Math.min(mins, 15) * 60 * 1000, candidateDeadline)).toISOString();
      ticket.isEscalated = new Date(ticket.slaDeadline).getTime() <= now;
    }
  }

  if (category && validCategories.includes(category) && category !== ticket.category) {
    ticket.category = category;
    changes.push(`Category changed from "${oldCategory}" to "${category}"`);
  }

  if (changes.length > 0) {
    if (!ticket.messages) {
      ticket.messages = [
        {
          id: `msg-${Date.now()}-c`,
          senderType: 'customer',
          senderName: ticket.sender,
          text: ticket.message,
          timestamp: ticket.timestamp
        }
      ];
    }

    ticket.messages.push({
      id: `msg-${Date.now()}-sys`,
      senderType: 'system',
      senderName: 'System Audit',
      text: `⚙️ Manual Classification Updated by ${updatedBy}: ${changes.join(', ')}.`,
      timestamp: new Date().toISOString()
    });

    saveTickets();

    notificationService.createNotification({
      type: 'CLASSIFICATION_UPDATED',
      ticket: ticket,
      title: `Ticket ${ticket.ticketId} Classification Updated`,
      message: `${changes.join(', ')} (by ${updatedBy})`,
      priority: ticket.priority
    });
  }

  return ticket;
}

// Delete ticket
function deleteTicket(ticketId) {
  const index = tickets.findIndex(t => t.ticketId === ticketId);
  if (index !== -1) {
    const deleted = tickets.splice(index, 1)[0];
    saveTickets();
    return deleted;
  }
  return null;
}

// Calculate executive analytics for Delivery Head Dashboard
function getAnalyticsSummary() {
  const total = tickets.length;
  const pending = tickets.filter(t => t.status === 'New' || t.status === 'In Progress').length;
  const resolved = tickets.filter(t => t.status === 'Resolved').length;
  const escalated = tickets.filter(t => t.isEscalated || t.status === 'Escalated').length;

  // Channel breakdown
  const channels = {
    gmail: tickets.filter(t => t.channel === 'gmail').length,
    telegram: tickets.filter(t => t.channel === 'telegram').length,
    discord: tickets.filter(t => t.channel === 'discord').length
  };

  // Priority breakdown
  const priorities = {
    Critical: tickets.filter(t => t.priority === 'Critical').length,
    High: tickets.filter(t => t.priority === 'High').length,
    Medium: tickets.filter(t => t.priority === 'Medium').length,
    Low: tickets.filter(t => t.priority === 'Low').length
  };

  // Agent Workloads
  const agentMap = {};
  for (const t of tickets) {
    const agent = t.assignedAgentName || 'Unassigned';
    if (!agentMap[agent]) {
      agentMap[agent] = { name: agent, total: 0, pending: 0, resolved: 0, escalated: 0 };
    }
    agentMap[agent].total++;
    if (t.status === 'Resolved') agentMap[agent].resolved++;
    else agentMap[agent].pending++;
    if (t.isEscalated || t.status === 'Escalated') agentMap[agent].escalated++;
  }

  // Category breakdown for AI Recurring Pain Points
  const catMap = {};
  for (const t of tickets) {
    const cat = t.category || detectCategory(t.message || t.subject);
    catMap[cat] = (catMap[cat] || 0) + 1;
  }
  const topCategories = Object.keys(catMap)
    .map(name => ({
      category: name,
      count: catMap[name],
      percentage: total > 0 ? Math.round((catMap[name] / total) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count);

  // SLA Compliance %
  const slaBreachedCount = tickets.filter(t => t.isEscalated).length;
  const slaComplianceRate = total > 0 ? Math.round(((total - slaBreachedCount) / total) * 100) : 100;

  return {
    total,
    pending,
    resolved,
    escalated,
    slaComplianceRate,
    channels,
    priorities,
    agentWorkloads: Object.values(agentMap),
    topCategories
  };
}

// Initialize on require
loadTickets();

module.exports = {
  loadTickets,
  saveTickets,
  addTicket,
  getTickets,
  getTicketById,
  recordAgentReply,
  reassignTicket,
  updateTicketStatus,
  updateTicketClassification,
  deleteTicket,
  detectPriority,
  detectSentiment,
  detectCategory,
  getAnalyticsSummary,
  addAttachment
};
