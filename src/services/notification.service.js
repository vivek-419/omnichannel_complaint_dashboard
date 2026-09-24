const fs = require('fs');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { getDataPath } = require('../config/paths.config');
const { SLA_MINUTES } = require('../constants/sla.constants');
const { getConfig } = require('../config/env.config');
const { dbSaveNotification } = require('../services/db.service');

const NOTIFICATIONS_FILE = getDataPath('notifications.json');

// In-memory store
let notifications = [];
let alertedImminent = new Set();
let alertedEscalated = new Set();
let transporter = null;

// Initialize notifications store
function initNotificationStore() {
  try {
    if (fs.existsSync(NOTIFICATIONS_FILE)) {
      notifications = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8'));
    } else {
      notifications = [];
    }
  } catch (err) {
    console.error('[NotificationService] Error loading notifications.json:', err.message);
    notifications = [];
  }
}

function saveNotifications() {
  try {
    // Keep last 300 notifications
    if (notifications.length > 300) {
      notifications = notifications.slice(0, 300);
    }
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2), 'utf8');
    if (notifications[0]) {
      dbSaveNotification(notifications[0]).catch(() => {});
    }
  } catch (err) {
    console.error('[NotificationService] Error saving notifications.json:', err.message);
  }
}

// Nodemailer transport setup (falls back to Ethereal dev preview)
async function getEmailTransporter() {
  if (transporter) return transporter;

  const cfg = getConfig();
  if (cfg.smtpHost) {
    transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpSecure,
      auth: {
        user: cfg.smtpUser,
        pass: cfg.smtpPass
      }
    });
  } else {
    // Development fake account
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      console.log('[NotificationService] 📧 Using Ethereal Email Dev Transporter.');
    } catch (e) {
      console.warn('[NotificationService] Could not initialize Ethereal transport:', e.message);
    }
  }
  return transporter;
}

// Calculate SLA deadline for a ticket
function calculateSLADeadline(priority = 'Medium', createdAt = new Date().toISOString()) {
  const mins = SLA_MINUTES[priority] || SLA_MINUTES.Medium;
  const created = new Date(createdAt).getTime();
  return new Date(created + mins * 60 * 1000).toISOString();
}

// Create a new notification alert
function createNotification({ type, ticket, title, message, priority }) {
  const item = {
    id: `notif-${uuidv4().substring(0, 8)}`,
    type: type, // 'NEW_COMPLAINT' | 'DEADLINE_APPROACHING' | 'ESCALATION' | 'REASSIGNED' | 'CLASSIFICATION_UPDATED'
    ticketId: ticket ? ticket.ticketId : null,
    channel: ticket ? ticket.channel : null,
    priority: priority || (ticket ? ticket.priority : 'Medium'),
    title: title || `Alert on Ticket ${ticket ? ticket.ticketId : ''}`,
    message: message || '',
    read: false,
    createdAt: new Date().toISOString()
  };

  notifications.unshift(item);
  saveNotifications();

  // Trigger non-blocking email dispatch
  sendEmailAlert(item, ticket).catch(e => console.error('[Notification Email Alert Error]:', e.message));

  console.log(`[NotificationService] 🔔 Alert Generated: [${item.type}] ${item.title}`);
  return item;
}

// Send Email Alert
async function sendEmailAlert(notification, ticket) {
  try {
    const mailer = await getEmailTransporter();
    if (!mailer) return;

    const to = process.env.SUPERVISOR_EMAIL || 'support-leads@ccmrs.internal';
    const channelBadge = ticket ? `[${ticket.channel.toUpperCase()}]` : '';

    const mailOptions = {
      from: '"CCMRS Omnichannel Alerts" <alerts@ccmrs.local>',
      to: to,
      subject: `🚨 [CCMRS Alert] ${notification.type}: ${notification.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4f46e5;">CCMRS Grievance Alert</h2>
          <p><strong>Alert Type:</strong> ${notification.type}</p>
          <p><strong>Channel:</strong> ${channelBadge}</p>
          <p><strong>Priority:</strong> <span style="color: #dc2626; font-weight: bold;">${notification.priority}</span></p>
          <p><strong>Message:</strong> ${notification.message}</p>
          ${ticket ? `
            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
            <p><strong>Customer:</strong> ${ticket.sender}</p>
            <p><strong>Original Complaint:</strong> "${ticket.message}"</p>
          ` : ''}
          <div style="margin-top: 20px;">
            <a href="http://localhost:5001/index.html" style="background: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Open CCMRS Dashboard</a>
          </div>
        </div>
      `
    };

    const info = await mailer.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[NotificationService] ✉️ Email alert sent! Preview URL: ${previewUrl}`);
    }
  } catch (err) {
    // Non-fatal, just log
  }
}

// Background SLA Scanner
function runSLACheck(ticketStore) {
  try {
    const allTickets = ticketStore.getTickets();
    const now = Date.now();

    for (const t of allTickets) {
      // Only inspect unresolved tickets
      if (t.status === 'Resolved' || t.status === 'Closed') continue;

      const deadline = new Date(t.slaDeadline || calculateSLADeadline(t.priority, t.timestamp)).getTime();
      const timeRemainingMs = deadline - now;
      const totalSlaMs = (SLA_MINUTES[t.priority] || 60) * 60 * 1000;

      // 1. Check for Breach / Escalation
      if (timeRemainingMs <= 0) {
        if (!t.isEscalated && !alertedEscalated.has(t.ticketId)) {
          alertedEscalated.add(t.ticketId);
          t.isEscalated = true;
          t.status = 'Escalated';
          ticketStore.saveTickets();

          createNotification({
            type: 'ESCALATION',
            ticket: t,
            title: `Ticket ${t.ticketId} SLA Breached!`,
            message: `Grievance from ${t.sender} via ${t.channel.toUpperCase()} has exceeded its ${t.priority} SLA deadline without resolution. Immediate supervisor action required!`,
            priority: 'Critical'
          });
        }
      }
      // 2. Check for Imminent Deadline (< 25% time remaining or < 10 mins)
      else if (timeRemainingMs <= Math.max(10 * 60 * 1000, totalSlaMs * 0.25)) {
        if (!alertedImminent.has(t.ticketId)) {
          alertedImminent.add(t.ticketId);
          const minsLeft = Math.max(1, Math.round(timeRemainingMs / 60000));

          createNotification({
            type: 'DEADLINE_APPROACHING',
            ticket: t,
            title: `SLA Deadline Approaching (${minsLeft}m left)`,
            message: `Ticket ${t.ticketId} (${t.priority} priority) will breach its resolution SLA in ${minsLeft} minutes.`,
            priority: t.priority
          });
        }
      }
    }
  } catch (err) {
    console.error('[NotificationService SLA Error]:', err.message);
  }
}

// Start Background SLA Escalation Poller
let pollerInterval = null;
function startEscalationPoller(ticketStore, intervalMs = 20000) {
  if (pollerInterval) clearInterval(pollerInterval);

  console.log(`[NotificationService] ⏱️ SLA Escalation & Alert engine running (interval: ${intervalMs / 1000}s).`);
  pollerInterval = setInterval(() => {
    runSLACheck(ticketStore);
  }, intervalMs);
}

// Fetch all notifications with unread count
function getNotifications(filter = {}) {
  let result = [...notifications];
  if (filter.type) {
    result = result.filter(n => n.type === filter.type);
  }
  if (filter.unreadOnly === true || filter.unreadOnly === 'true') {
    result = result.filter(n => !n.read);
  }

  const unreadCount = notifications.filter(n => !n.read).length;
  return {
    total: result.length,
    unreadCount,
    notifications: result
  };
}

// Mark single notification as read
function markNotificationRead(id) {
  const item = notifications.find(n => n.id === id);
  if (item) {
    item.read = true;
    saveNotifications();
  }
  return item;
}

// Mark all as read
function markAllNotificationsRead() {
  notifications.forEach(n => (n.read = true));
  saveNotifications();
  return { success: true, count: notifications.length };
}

initNotificationStore();

module.exports = {
  calculateSLADeadline,
  createNotification,
  startEscalationPoller,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  SLA_MINUTES
};
