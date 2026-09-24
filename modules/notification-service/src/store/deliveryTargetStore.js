'use strict';

/**
 * Delivery Target Store
 *
 * In-memory registry of outbound delivery targets.
 * Each target is either an email address or a webhook URL that should
 * receive push notifications when matching events are emitted.
 *
 * Schema:
 * {
 *   id        {string}   - UUID
 *   type      {string}   - 'email' | 'webhook'
 *   target    {string}   - email address or URL
 *   events    {string[]} - notification types to receive, or ['*'] for all
 *   active    {boolean}  - false = paused, receives no deliveries
 *   label     {string}   - optional human-readable name
 *   createdAt {string}   - ISO timestamp
 *   updatedAt {string}   - ISO timestamp
 * }
 */

const { v4: uuidv4 } = require('uuid');

const VALID_TYPES  = ['email', 'webhook'];
const ALL_WILDCARD = '*';

/** @type {Map<string, Object>} */
const store = new Map();

// ── Validation helpers ─────────────────────────────────────────────────────

function _validateType(type) {
  if (!VALID_TYPES.includes(type)) {
    throw Object.assign(
      new Error(`Invalid target type "${type}". Must be one of: ${VALID_TYPES.join(', ')}`),
      { statusCode: 400 }
    );
  }
}

function _validateTarget(type, target) {
  if (!target || typeof target !== 'string' || !target.trim()) {
    throw Object.assign(new Error('target is required'), { statusCode: 400 });
  }
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.trim())) {
    throw Object.assign(
      new Error(`Invalid email address: "${target}"`),
      { statusCode: 400 }
    );
  }
  if (type === 'webhook') {
    try {
      const u = new URL(target.trim());
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    } catch {
      throw Object.assign(
        new Error(`Invalid webhook URL: "${target}". Must be a valid http/https URL.`),
        { statusCode: 400 }
      );
    }
  }
}

function _validateEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw Object.assign(
      new Error('events must be a non-empty array, e.g. ["*"] or ["NEW_COMPLAINT","ESCALATION"]'),
      { statusCode: 400 }
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Register a new delivery target.
 *
 * @param {Object} opts
 * @param {string}   opts.type    - 'email' | 'webhook'
 * @param {string}   opts.target  - email address or URL
 * @param {string[]} opts.events  - notification types, or ['*']
 * @param {string}  [opts.label]  - optional display name
 * @returns {Object} The created target
 */
function add({ type, target, events, label }) {
  _validateType(type);
  _validateTarget(type, target);
  _validateEvents(events);

  const now    = new Date().toISOString();
  const record = {
    id:        uuidv4(),
    type,
    target:    target.trim(),
    events:    events.map(e => e === ALL_WILDCARD ? ALL_WILDCARD : e.toUpperCase()),
    active:    true,
    label:     label ? String(label).slice(0, 128) : null,
    createdAt: now,
    updatedAt: now,
  };

  store.set(record.id, record);
  return record;
}

/**
 * Return all registered targets.
 *
 * @param {Object} [opts]
 * @param {string}  [opts.type]    - Filter by 'email' | 'webhook'
 * @param {boolean} [opts.active]  - Filter by active state (pass true/false as string or bool)
 * @returns {Object[]}
 */
function findAll(opts = {}) {
  let targets = [...store.values()];

  if (opts.type)   targets = targets.filter(t => t.type === opts.type);
  if (opts.active !== undefined) {
    const want = opts.active === 'true' || opts.active === true;
    targets = targets.filter(t => t.active === want);
  }

  return targets;
}

/**
 * Find a single target by ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
function findById(id) {
  return store.get(id);
}

/**
 * Update mutable fields on a target.
 * Allowed: events, active, label.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
function update(id, updates) {
  const target = store.get(id);
  if (!target) return null;

  const { events, active, label } = updates;

  if (events !== undefined) {
    _validateEvents(events);
    target.events = events.map(e => e === ALL_WILDCARD ? ALL_WILDCARD : e.toUpperCase());
  }
  if (active !== undefined) target.active = Boolean(active);
  if (label  !== undefined) target.label  = label ? String(label).slice(0, 128) : null;

  target.updatedAt = new Date().toISOString();
  store.set(id, target);
  return target;
}

/**
 * Remove a target by ID.
 * @param {string} id
 * @returns {boolean} true if deleted, false if not found
 */
function remove(id) {
  return store.delete(id);
}

/**
 * Return all active targets that should receive a given notification type.
 *
 * @param {string} notificationType - e.g. 'NEW_COMPLAINT'
 * @returns {Object[]}
 */
function findForEvent(notificationType) {
  return [...store.values()].filter(t =>
    t.active && (
      t.events.includes(ALL_WILDCARD) ||
      t.events.includes(notificationType)
    )
  );
}

module.exports = { add, findAll, findById, update, remove, findForEvent };
