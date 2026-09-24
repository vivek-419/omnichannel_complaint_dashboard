'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  CHANNELS,
  PRIORITIES,
  PRIORITY_WEIGHT,
  PRIORITY_KEYWORDS,
  TICKET_PREFIX,
  SLA_MINUTES,
} = require('../config/constants');

/**
 * Derive the final priority for a complaint given:
 *   - channel default priority
 *   - keyword-boost score computed from the complaint text
 *   - any explicitly supplied priority override from the caller
 *
 * @param {string} channel      - One of the keys in CHANNELS
 * @param {string} text         - Combined subject + body text
 * @param {string|null} override- Optional explicit priority
 * @returns {string}            - One of PRIORITIES values
 */
function computePriority(channel, text, override) {
  // 1. Caller-supplied override wins if valid.
  if (override && Object.values(PRIORITIES).includes(override.toLowerCase())) {
    return override.toLowerCase();
  }

  // 2. Compute keyword boost score.
  let score = 0;
  const sample = String(text || '').substring(0, 2000); // guard huge payloads
  for (const { pattern, boost } of PRIORITY_KEYWORDS) {
    if (pattern.test(sample)) score += boost;
  }

  // 3. Start from the channel's base priority.
  const channelDef = CHANNELS[channel?.toUpperCase()] || CHANNELS.API;
  let priority = channelDef.basePriority;

  // 4. Escalate based on score thresholds.
  if (score >= 3) {
    priority = PRIORITIES.URGENT;
  } else if (score >= 2) {
    priority = upgradePriority(priority, PRIORITIES.HIGH);
  } else if (score >= 1) {
    priority = upgradePriority(priority, PRIORITIES.MEDIUM);
  }

  return priority;
}

/**
 * Return the higher of two priority strings.
 */
function upgradePriority(current, candidate) {
  return PRIORITY_WEIGHT[candidate] > PRIORITY_WEIGHT[current] ? candidate : current;
}

/**
 * Compute the SLA deadline timestamp given a priority and creation time.
 *
 * @param {string} priority   - One of PRIORITIES values
 * @param {Date}   createdAt  - Ticket creation date
 * @returns {string}          - ISO 8601 deadline string
 */
function computeSLADeadline(priority, createdAt) {
  const minutes = SLA_MINUTES[priority] ?? SLA_MINUTES.medium;
  const deadline = new Date(createdAt.getTime() + minutes * 60 * 1000);
  return deadline.toISOString();
}

/**
 * Generate a human-readable, unique ticket ID.
 * Format: TKT-YYYYMMDD-XXXXXXXX  (date + 8 uppercase hex chars from UUID)
 *
 * @returns {string}
 */
function generateTicketId() {
  const datePart = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  const uniquePart = uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);
  return `${TICKET_PREFIX}-${datePart}-${uniquePart}`;
}

/**
 * Normalise and validate the inbound channel string.
 * Returns a known CHANNELS key or throws.
 *
 * @param {string} raw
 * @returns {string}
 */
function resolveChannel(raw) {
  const normalised = String(raw || '').trim().toUpperCase();
  if (!normalised || !CHANNELS[normalised]) {
    const valid = Object.keys(CHANNELS).join(', ');
    throw Object.assign(
      new Error(`Invalid channel "${raw}". Must be one of: ${valid}`),
      { statusCode: 400 }
    );
  }
  return normalised;
}

/**
 * Core ticket factory.
 * Accepts a raw complaint payload and returns a fully-formed ticket object.
 *
 * @param {Object} payload
 * @param {string}  payload.channel      - Inbound channel key
 * @param {string}  payload.subject      - Short complaint summary
 * @param {string}  payload.body         - Full complaint text
 * @param {string} [payload.priority]    - Optional explicit priority override
 * @param {Object} [payload.customer]    - Optional customer info { name, email, phone, id }
 * @param {Object} [payload.metadata]    - Optional free-form key/value metadata
 * @returns {Object}                     - The newly created ticket
 */
function createTicket(payload) {
  const { channel: rawChannel, subject, body, priority: priorityOverride, customer, metadata } = payload;

  // --- Validate required fields ---
  if (!rawChannel) throw Object.assign(new Error('channel is required'), { statusCode: 400 });
  if (!subject)    throw Object.assign(new Error('subject is required'),  { statusCode: 400 });
  if (!body)       throw Object.assign(new Error('body is required'),     { statusCode: 400 });

  const channel  = resolveChannel(rawChannel);
  const now      = new Date();
  const priority = computePriority(channel, `${subject} ${body}`, priorityOverride);
  const ticketId = generateTicketId();
  const slaDeadline = computeSLADeadline(priority, now);

  const ticket = {
    id:          ticketId,
    uuid:        uuidv4(),          // internal correlation ID (always unique)
    channel,
    channelLabel: CHANNELS[channel].label,
    status:      'new',
    priority,
    subject:     String(subject).trim(),
    body:        String(body).trim(),
    customer:    sanitiseCustomer(customer),
    metadata:    metadata && typeof metadata === 'object' ? metadata : {},
    timestamps: {
      createdAt:   now.toISOString(),
      updatedAt:   now.toISOString(),
      slaDeadline,
    },
    history: [
      {
        action:    'created',
        timestamp: now.toISOString(),
        detail:    `Ticket created via ${CHANNELS[channel].label} channel`,
      },
    ],
  };

  return ticket;
}

/**
 * Sanitise customer object — keep only known safe fields.
 */
function sanitiseCustomer(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    id:    raw.id    ? String(raw.id).slice(0, 64)    : undefined,
    name:  raw.name  ? String(raw.name).slice(0, 128) : undefined,
    email: raw.email ? String(raw.email).slice(0, 254): undefined,
    phone: raw.phone ? String(raw.phone).slice(0, 20) : undefined,
  };
}

module.exports = {
  createTicket,
  computePriority,
  generateTicketId,
  resolveChannel,
};
