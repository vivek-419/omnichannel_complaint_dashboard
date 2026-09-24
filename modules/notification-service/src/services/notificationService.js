'use strict';

/**
 * Notification Engine
 *
 * Manages in-process alert notifications for:
 *   - NEW_COMPLAINT  : fired when a ticket is first created
 *   - DEADLINE_APPROACHING : fired when a ticket's SLA deadline is imminent
 *   - ESCALATION     : fired when a ticket is transitioned to 'escalated'
 *
 * All notifications are stored in a capped in-memory array.
 * In production, swap the array for a DB-backed store (MongoDB, Redis, etc.)
 * without changing the public interface.
 */

const { v4: uuidv4 }        = require('uuid');
const { NOTIFICATION_TYPES, DEADLINE_WARN_MINUTES } = require('../config/constants');

// ── Internal State ─────────────────────────────────────────────────────────

/** Maximum notifications held in memory before oldest are evicted. */
const MAX_STORE = parseInt(process.env.NOTIFICATION_MAX_STORE) || 500;

/** The in-memory notification store (newest first on read). */
let notifications = [];

/**
 * Set of ticketIds that have already received a DEADLINE_APPROACHING
 * notification in the current SLA window — prevents duplicate alerts.
 * @type {Set<string>}
 */
const deadlineAlertedIds = new Set();

/** Reference to the active poller interval (used to stop it in tests). */
let _pollerHandle = null;

// ── Store reference (injected lazily to avoid circular deps) ───────────────
let _ticketStore = null;
function _getStore() {
  if (!_ticketStore) _ticketStore = require('../store/ticketStore');
  return _ticketStore;
}

// ── Delivery service reference (lazy to avoid circular deps) ───────────────
let _deliveryService = null;
function _getDelivery() {
  if (!_deliveryService) _deliveryService = require('./deliveryService');
  return _deliveryService;
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Create and store a new notification.
 *
 * @param {string} type     - One of NOTIFICATION_TYPES values
 * @param {Object} ticket   - The related ticket object
 * @param {string} [detail] - Optional human-readable detail message
 * @returns {Object} The created notification
 */
function emit(type, ticket, detail) {
  if (!Object.values(NOTIFICATION_TYPES).includes(type)) {
    throw new Error(`Unknown notification type: "${type}"`);
  }

  const notification = {
    id:        uuidv4(),
    type,
    ticketId:  ticket.id,
    channel:   ticket.channel,
    priority:  ticket.priority,
    subject:   ticket.subject,
    detail:    detail || _defaultDetail(type, ticket),
    read:      false,
    createdAt: new Date().toISOString(),
  };

  // Prepend (newest first)
  notifications.unshift(notification);

  // Evict oldest if over cap
  if (notifications.length > MAX_STORE) {
    notifications = notifications.slice(0, MAX_STORE);
  }

  console.log(`[NOTIFICATION] type=${type} ticketId=${ticket.id} priority=${ticket.priority}`);

  // Push to outbound delivery targets (fire-and-forget)
  _getDelivery().dispatch(notification);

  return notification;
}

/**
 * Query stored notifications with optional filters and pagination.
 *
 * @param {Object} [opts]
 * @param {string}  [opts.type]      - Filter by notification type
 * @param {string}  [opts.ticketId]  - Filter by associated ticket ID
 * @param {string}  [opts.read]      - 'true' | 'false' — filter by read state
 * @param {number}  [opts.page]      - 1-based page number (default 1)
 * @param {number}  [opts.limit]     - Items per page (default 20, max 100)
 * @returns {{ notifications: Object[], total: number, unread: number, page: number, limit: number }}
 */
function getAll(opts = {}) {
  const { type, ticketId } = opts;
  const page  = Math.max(1, parseInt(opts.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(opts.limit) || 20));

  let result = [...notifications];

  if (type)     result = result.filter(n => n.type     === type.toUpperCase());
  if (ticketId) result = result.filter(n => n.ticketId === ticketId);

  // read filter: 'true' → only read; 'false' → only unread
  if (opts.read === 'true')  result = result.filter(n =>  n.read);
  if (opts.read === 'false') result = result.filter(n => !n.read);

  const total  = result.length;
  const unread = result.filter(n => !n.read).length;
  const start  = (page - 1) * limit;
  const paged  = result.slice(start, start + limit);

  return { notifications: paged, total, unread, page, limit };
}

/**
 * Return the count of unread notifications (for badge display).
 * @returns {number}
 */
function getUnreadCount() {
  return notifications.filter(n => !n.read).length;
}

/**
 * Mark specific notifications as read.
 *
 * @param {string[]} ids - Array of notification IDs to mark read
 * @returns {number} Count of notifications actually updated
 */
function markRead(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const idSet = new Set(ids);
  let count = 0;
  for (const n of notifications) {
    if (idSet.has(n.id) && !n.read) {
      n.read = true;
      count++;
    }
  }
  return count;
}

/**
 * Mark ALL notifications as read.
 * @returns {number} Count of notifications updated
 */
function markAllRead() {
  let count = 0;
  for (const n of notifications) {
    if (!n.read) { n.read = true; count++; }
  }
  return count;
}

/**
 * Clear all stored notifications (useful for dev/admin resets).
 */
function clearAll() {
  notifications = [];
  deadlineAlertedIds.clear();
}

// ── Deadline Poller ────────────────────────────────────────────────────────

/**
 * Start a background interval that scans all tickets and emits
 * DEADLINE_APPROACHING notifications when a ticket's SLA deadline
 * is within DEADLINE_WARN_MINUTES of expiry.
 *
 * Each ticket only receives one alert per SLA window (deduplicated via Set).
 * Re-opened / escalated tickets clear their dedup entry so they can
 * receive a fresh warning after status change.
 *
 * @param {number} [intervalMs] - Polling interval in ms (default from env or 60 000)
 * @returns {NodeJS.Timeout} The interval handle (for tests that need to clear it)
 */
function startDeadlinePoller(intervalMs) {
  const ms = intervalMs
    ?? parseInt(process.env.NOTIFICATION_POLL_INTERVAL_MS)
    ?? 60_000;

  if (_pollerHandle) {
    clearInterval(_pollerHandle);
  }

  console.log(`[NOTIFICATION POLLER] Started — checking every ${ms / 1000}s, warn at ${DEADLINE_WARN_MINUTES} min before SLA breach`);

  _pollerHandle = setInterval(() => _runDeadlineScan(), ms);

  // Run immediately on start so the first check isn't delayed
  _runDeadlineScan();

  return _pollerHandle;
}

/**
 * Stop the deadline poller (used in tests).
 */
function stopDeadlinePoller() {
  if (_pollerHandle) {
    clearInterval(_pollerHandle);
    _pollerHandle = null;
  }
}

/**
 * Internal: scan all tickets and fire deadline alerts as needed.
 */
function _runDeadlineScan() {
  const store = _getStore();
  const { tickets } = store.findAll({ limit: 1000 }); // scan up to 1 000 live tickets
  const now         = Date.now();
  const warnMs      = DEADLINE_WARN_MINUTES * 60 * 1000;

  for (const ticket of tickets) {
    // Skip already-terminal tickets
    if (['resolved', 'closed'].includes(ticket.status)) {
      deadlineAlertedIds.delete(ticket.id); // reset so re-open gets a fresh alert
      continue;
    }

    const deadline = new Date(ticket.timestamps.slaDeadline).getTime();
    const msLeft   = deadline - now;

    // Only alert if: within warning window AND not yet past deadline AND not already alerted
    if (msLeft > 0 && msLeft <= warnMs && !deadlineAlertedIds.has(ticket.id)) {
      const minsLeft = Math.round(msLeft / 60_000);
      emit(
        NOTIFICATION_TYPES.DEADLINE_APPROACHING,
        ticket,
        `SLA deadline in ${minsLeft} min${minsLeft !== 1 ? 's' : ''} — ticket ${ticket.id} (${ticket.priority} priority)`,
      );
      deadlineAlertedIds.add(ticket.id);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _defaultDetail(type, ticket) {
  switch (type) {
    case NOTIFICATION_TYPES.NEW_COMPLAINT:
      return `New ${ticket.priority} priority complaint received via ${ticket.channelLabel || ticket.channel}`;
    case NOTIFICATION_TYPES.DEADLINE_APPROACHING:
      return `SLA deadline approaching for ticket ${ticket.id}`;
    case NOTIFICATION_TYPES.ESCALATION:
      return `Ticket ${ticket.id} has been escalated to ${ticket.priority} priority`;
    default:
      return `Notification for ticket ${ticket.id}`;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  NOTIFICATION_TYPES,
  emit,
  getAll,
  getUnreadCount,
  markRead,
  markAllRead,
  clearAll,
  startDeadlinePoller,
  stopDeadlinePoller,
};
