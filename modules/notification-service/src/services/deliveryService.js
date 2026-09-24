'use strict';

/**
 * Delivery Service
 *
 * Dispatches notifications to registered delivery targets (email + webhook).
 *
 * Design principles:
 *  - Fire-and-forget: dispatch() is async but never throws — failures are logged
 *    and recorded on the notification object without blocking the caller.
 *  - Retry: webhooks retry up to WEBHOOK_MAX_RETRIES times with exponential back-off.
 *  - Zero-config dev: when SMTP_HOST is unset, nodemailer falls back to an
 *    Ethereal (ethereal.email) test account and logs a preview URL to the console.
 */

const https       = require('https');
const http        = require('http');
const nodemailer  = require('nodemailer');
const targetStore = require('../store/deliveryTargetStore');

// ── Config ─────────────────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS   = parseInt(process.env.WEBHOOK_TIMEOUT_MS)    || 5_000;
const WEBHOOK_MAX_RETRIES  = parseInt(process.env.WEBHOOK_MAX_RETRIES)   || 3;
const WEBHOOK_RETRY_BASE   = parseInt(process.env.WEBHOOK_RETRY_BASE_MS) || 1_000;

// ── Transport singleton ────────────────────────────────────────────────────

/** Cached nodemailer transporter (created once). */
let _transporter = null;

/**
 * Build (or return cached) nodemailer transport.
 * Falls back to Ethereal test account when SMTP_HOST is not configured.
 */
async function _getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth:   {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    });
    console.log(`[DELIVERY] Email transport → SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`);
  } else {
    // Dev fallback: Ethereal fake SMTP
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host:   'smtp.ethereal.email',
      port:   587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('[DELIVERY] ⚠️  SMTP_HOST not set — using Ethereal test account.');
    console.log(`[DELIVERY]    Preview emails at: https://ethereal.email`);
  }

  return _transporter;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Dispatch a notification to all matching active delivery targets.
 * Runs asynchronously; never rejects — errors are caught and recorded.
 *
 * @param {Object} notification - The notification object from notificationService
 */
function dispatch(notification) {
  if (!notification.deliveries) notification.deliveries = [];

  // Find all active targets interested in this notification type
  const targets = targetStore.findForEvent(notification.type);
  if (targets.length === 0) return;

  // Fire all deliveries in parallel (non-blocking)
  for (const target of targets) {
    _deliver(target, notification).catch(() => {/* already handled inside */});
  }
}

// ── Private: delivery routing ──────────────────────────────────────────────

async function _deliver(target, notification) {
  if (target.type === 'webhook') {
    await _sendWebhook(target, notification);
  } else if (target.type === 'email') {
    await _sendEmail(target, notification);
  }
}

// ── Webhook adapter ────────────────────────────────────────────────────────

/**
 * POST the notification payload as JSON to the target URL.
 * Retries up to WEBHOOK_MAX_RETRIES times with exponential back-off.
 *
 * @param {Object} target
 * @param {Object} notification
 */
async function _sendWebhook(target, notification) {
  const payload = JSON.stringify({
    event:        notification.type,
    notificationId: notification.id,
    ticketId:     notification.ticketId,
    channel:      notification.channel,
    priority:     notification.priority,
    subject:      notification.subject,
    detail:       notification.detail,
    createdAt:    notification.createdAt,
  });

  let lastError = null;

  for (let attempt = 1; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
    try {
      await _httpPost(target.target, payload);
      _recordDelivery(notification, target, 'delivered', attempt);
      console.log(`[DELIVERY] ✅  Webhook → ${target.target} (attempt ${attempt})`);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[DELIVERY] ⚠️  Webhook → ${target.target} attempt ${attempt} failed: ${err.message}`);

      if (attempt < WEBHOOK_MAX_RETRIES) {
        const backoff = WEBHOOK_RETRY_BASE * Math.pow(2, attempt - 1);
        await _sleep(backoff);
      }
    }
  }

  _recordDelivery(notification, target, 'failed', WEBHOOK_MAX_RETRIES, lastError?.message);
  console.error(`[DELIVERY] ❌  Webhook → ${target.target} failed after ${WEBHOOK_MAX_RETRIES} attempts: ${lastError?.message}`);
}

/**
 * Minimal HTTP/HTTPS POST helper that resolves on 2xx and rejects on anything else.
 * Uses Node's built-in `http`/`https` — no extra deps.
 */
function _httpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlStr);
    const lib     = url.protocol === 'https:' ? https : http;
    const options = {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'TicketService-NotificationDelivery/1.0',
      },
      timeout: WEBHOOK_TIMEOUT_MS,
    };

    const req = lib.request(url, options, (res) => {
      // Drain the response body to free the socket
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(res.statusCode);
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Email adapter ──────────────────────────────────────────────────────────

const PRIORITY_EMOJI = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const TYPE_LABEL = {
  NEW_COMPLAINT:        '🎫 New Complaint',
  DEADLINE_APPROACHING: '⏰ SLA Deadline Approaching',
  ESCALATION:           '🚨 Ticket Escalated',
};

/**
 * Send an email notification via nodemailer.
 *
 * @param {Object} target
 * @param {Object} notification
 */
async function _sendEmail(target, notification) {
  try {
    const transport = await _getTransporter();
    const emoji     = PRIORITY_EMOJI[notification.priority] || '📋';
    const typeLabel = TYPE_LABEL[notification.type] || notification.type;
    const subject   = `[${emoji} ${notification.priority?.toUpperCase()}] ${typeLabel} — ${notification.subject}`;

    const textBody = [
      `Event: ${typeLabel}`,
      `Ticket ID: ${notification.ticketId}`,
      `Priority: ${notification.priority}`,
      `Channel: ${notification.channel}`,
      `Subject: ${notification.subject}`,
      ``,
      notification.detail,
      ``,
      `Timestamp: ${notification.createdAt}`,
    ].join('\n');

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
  <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:16px;">
    <h2 style="margin:0 0 4px 0;font-size:18px;">${typeLabel}</h2>
    <p style="margin:0;font-size:13px;color:#6b7280;">Ticket Notification</p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;width:130px;">Ticket ID</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-family:monospace;">${notification.ticketId}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">Priority</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${emoji} ${notification.priority?.toUpperCase()}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">Channel</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${notification.channel}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">Subject</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${notification.subject}</td></tr>
  </table>
  <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px 16px;border-radius:0 4px 4px 0;margin-bottom:16px;">
    <p style="margin:0;font-size:14px;">${notification.detail}</p>
  </div>
  <p style="font-size:12px;color:#9ca3af;margin:0;">Sent at ${notification.createdAt}</p>
</body>
</html>`;

    const info = await transport.sendMail({
      from:    process.env.EMAIL_FROM || '"Ticket Service" <noreply@ticket.local>',
      to:      target.target,
      subject,
      text:    textBody,
      html:    htmlBody,
    });

    _recordDelivery(notification, target, 'delivered', 1);

    // In dev, log the Ethereal preview URL
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[DELIVERY] ✅  Email → ${target.target} | Preview: ${previewUrl}`);
    } else {
      console.log(`[DELIVERY] ✅  Email → ${target.target} (messageId: ${info.messageId})`);
    }
  } catch (err) {
    _recordDelivery(notification, target, 'failed', 1, err.message);
    console.error(`[DELIVERY] ❌  Email → ${target.target} failed: ${err.message}`);
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Append a delivery record to notification.deliveries[].
 */
function _recordDelivery(notification, target, status, attempts, error) {
  if (!Array.isArray(notification.deliveries)) notification.deliveries = [];
  notification.deliveries.push({
    targetId:    target.id,
    type:        target.type,
    target:      target.target,
    status,
    attempts,
    attemptedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  });
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Test helper — override transporter ────────────────────────────────────

/**
 * Inject a custom nodemailer transport (for testing).
 * @param {Object} transport
 */
function _setTransporter(transport) {
  _transporter = transport;
}

module.exports = { dispatch, _sendWebhook, _sendEmail, _setTransporter };
