'use strict';

/**
 * In-memory ticket store.
 *
 * Provides a simple Map-backed store for development / demo purposes.
 * In production replace the underlying Map with a database adapter
 * (MongoDB, PostgreSQL, etc.) while keeping this interface intact.
 */

const store = new Map();

/**
 * Persist a ticket and return it.
 * @param {Object} ticket
 * @returns {Object}
 */
function save(ticket) {
  store.set(ticket.id, ticket);
  return ticket;
}

/**
 * Retrieve a single ticket by ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
function findById(id) {
  return store.get(id);
}

/**
 * Return all tickets as an array, newest first by default.
 * Supports optional filter/sort params.
 *
 * @param {Object} [opts]
 * @param {string}  [opts.channel]   - Filter by channel key (exact, case-insensitive)
 * @param {string}  [opts.status]    - Filter by status (exact, case-insensitive)
 * @param {string}  [opts.priority]  - Filter by priority (exact, case-insensitive)
 * @param {string}  [opts.agent]     - Filter by assignee (substring, case-insensitive)
 * @param {string}  [opts.dateFrom]  - Include tickets created on/after this ISO date string
 * @param {string}  [opts.dateTo]    - Include tickets created on/before this ISO date string
 * @param {string}  [opts.q]         - Free-text search across subject, body, customer.name
 * @param {string}  [opts.sortBy]    - Field to sort by: 'createdAt' | 'priority' | 'slaDeadline' (default: 'createdAt')
 * @param {string}  [opts.order]     - Sort direction: 'asc' | 'desc' (default: 'desc')
 * @param {number}  [opts.page]      - 1-based page number
 * @param {number}  [opts.limit]     - Items per page (default 20, max 100)
 * @returns {{ tickets: Object[], total: number, page: number, limit: number }}
 */
function findAll(opts = {}) {
  const { channel, status, priority, agent, dateFrom, dateTo, q } = opts;
  const page    = Math.max(1, parseInt(opts.page)  || 1);
  const limit   = Math.min(100, Math.max(1, parseInt(opts.limit) || 20));
  const sortBy  = ['createdAt', 'priority', 'slaDeadline'].includes(opts.sortBy) ? opts.sortBy : 'createdAt';
  const order   = opts.order === 'asc' ? 'asc' : 'desc';

  let tickets = [...store.values()];

  // ── Exact filters ──────────────────────────────────────────────────────
  if (channel)  tickets = tickets.filter(t => t.channel  === channel.toUpperCase());
  if (status)   tickets = tickets.filter(t => t.status   === status.toLowerCase());
  if (priority) tickets = tickets.filter(t => t.priority === priority.toLowerCase());

  // ── Agent / assignee filter (substring, case-insensitive) ─────────────
  if (agent) {
    const agentLower = agent.toLowerCase();
    tickets = tickets.filter(t =>
      t.assignee && String(t.assignee).toLowerCase().includes(agentLower)
    );
  }

  // ── Date-range filter ─────────────────────────────────────────────────
  if (dateFrom) {
    const from = new Date(dateFrom).getTime();
    if (!isNaN(from)) {
      tickets = tickets.filter(t => new Date(t.timestamps.createdAt).getTime() >= from);
    }
  }
  if (dateTo) {
    // Treat dateTo as end-of-day if only a date (no time) is supplied
    const raw  = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
    const to   = new Date(raw).getTime();
    if (!isNaN(to)) {
      tickets = tickets.filter(t => new Date(t.timestamps.createdAt).getTime() <= to);
    }
  }

  // ── Free-text search ──────────────────────────────────────────────────
  if (q) {
    const needle = q.toLowerCase();
    tickets = tickets.filter(t => {
      const haystack = [
        t.subject,
        t.body,
        t.customer?.name,
        t.customer?.email,
        t.id,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }

  // ── Sorting ───────────────────────────────────────────────────────────
  const PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };

  tickets.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'priority') {
      cmp = (PRIORITY_WEIGHT[a.priority] || 0) - (PRIORITY_WEIGHT[b.priority] || 0);
    } else if (sortBy === 'slaDeadline') {
      cmp = new Date(a.timestamps.slaDeadline) - new Date(b.timestamps.slaDeadline);
    } else {
      // default: createdAt
      cmp = new Date(a.timestamps.createdAt) - new Date(b.timestamps.createdAt);
    }
    return order === 'asc' ? cmp : -cmp;
  });

  const total = tickets.length;
  const start = (page - 1) * limit;
  tickets = tickets.slice(start, start + limit);

  return { tickets, total, page, limit };
}

/**
 * Update a ticket's mutable fields.
 * Returns the updated ticket or null if not found.
 *
 * @param {string} id
 * @param {Object} updates - Partial fields to merge
 * @returns {Object|null}
 */
function update(id, updates) {
  const ticket = store.get(id);
  if (!ticket) return null;

  const now = new Date().toISOString();

  const allowed = ['status', 'priority', 'assignee'];
  for (const key of allowed) {
    if (updates[key] !== undefined) ticket[key] = updates[key];
  }

  ticket.timestamps.updatedAt = now;

  // Append to history
  ticket.history.push({
    action:    'updated',
    timestamp: now,
    detail:    `Fields updated: ${Object.keys(updates).filter(k => allowed.includes(k)).join(', ')}`,
  });

  store.set(id, ticket);
  return ticket;
}

/**
 * Return basic aggregate statistics across all tickets.
 */
function stats() {
  const all = [...store.values()];
  const byChannel  = {};
  const byPriority = {};
  const byStatus   = {};

  for (const t of all) {
    byChannel[t.channel]   = (byChannel[t.channel]   || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    byStatus[t.status]     = (byStatus[t.status]     || 0) + 1;
  }

  return { total: all.length, byChannel, byPriority, byStatus };
}

/**
 * Return tickets eligible for auto-escalation:
 *   - Status is 'new' or 'in_progress'
 *   - SLA deadline has passed
 *
 * @returns {Object[]}
 */
function findEscalationCandidates() {
  const now = new Date();
  return [...store.values()].filter(t => {
    if (t.status !== 'new' && t.status !== 'in_progress') return false;
    if (!t.timestamps || !t.timestamps.slaDeadline) return false;
    return now >= new Date(t.timestamps.slaDeadline);
  });
}

module.exports = { save, findById, findAll, update, stats, findEscalationCandidates };

