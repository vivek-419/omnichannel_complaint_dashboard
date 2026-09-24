'use strict';

/**
 * Supported inbound channels.
 * Each channel has a display label and a default base priority.
 */
const CHANNELS = {
  EMAIL:    { label: 'Email',          basePriority: 'medium' },
  CHAT:     { label: 'Live Chat',      basePriority: 'high'   },
  PHONE:    { label: 'Phone Call',     basePriority: 'high'   },
  WEB:      { label: 'Web Form',       basePriority: 'medium' },
  SOCIAL:   { label: 'Social Media',   basePriority: 'low'    },
  WHATSAPP: { label: 'WhatsApp',       basePriority: 'medium' },
  SMS:      { label: 'SMS',            basePriority: 'medium' },
  API:      { label: 'API Integration',basePriority: 'medium' },
};

/**
 * Priority levels (highest → lowest).
 */
const PRIORITIES = {
  URGENT: 'urgent',
  HIGH:   'high',
  MEDIUM: 'medium',
  LOW:    'low',
};

/** Numeric weight for each priority (used in sorting / comparisons). */
const PRIORITY_WEIGHT = {
  urgent: 4,
  high:   3,
  medium: 2,
  low:    1,
};

/**
 * Keywords that raise priority.
 * Each entry: { pattern: RegExp, boost: number }
 * boost values accumulate; final score drives the override rule.
 */
const PRIORITY_KEYWORDS = [
  // Urgent escalators
  { pattern: /\b(urgent|emergency|critical|immediately|asap|life.?threaten|danger)\b/i, boost: 3 },
  { pattern: /\b(server.?down|outage|breach|data.?loss|hack|compromised)\b/i,          boost: 3 },

  // High escalators
  { pattern: /\b(broken|not.?work|failure|fail|error|crash|unable|cannot)\b/i,          boost: 2 },
  { pattern: /\b(frustrated|unacceptable|lawsuit|refund|escalat|supervisor)\b/i,        boost: 2 },

  // Medium escalators
  { pattern: /\b(slow|delay|issue|problem|wrong|incorrect|missing)\b/i,                 boost: 1 },
  { pattern: /\b(complaint|dissatisfied|disappoint|concern|unhappy)\b/i,                boost: 1 },
];

/**
 * Ticket lifecycle statuses.
 * Lowercase values are used as the canonical form inside ticket objects.
 */
const TICKET_STATUSES = {
  NEW:         'new',
  IN_PROGRESS: 'in_progress',
  ESCALATED:   'escalated',
  RESOLVED:    'resolved',
  CLOSED:      'closed',
};

/**
 * Allowed status transitions map.
 * Key   → current status
 * Value → array of valid next statuses
 *
 * Transition diagram:
 *   new → in_progress | escalated
 *   in_progress → escalated | resolved
 *   escalated → in_progress | resolved
 *   resolved → closed
 *   closed → (terminal — no further transitions)
 */
const ALLOWED_TRANSITIONS = {
  [TICKET_STATUSES.NEW]:         [TICKET_STATUSES.IN_PROGRESS, TICKET_STATUSES.ESCALATED],
  [TICKET_STATUSES.IN_PROGRESS]: [TICKET_STATUSES.ESCALATED,   TICKET_STATUSES.RESOLVED],
  [TICKET_STATUSES.ESCALATED]:   [TICKET_STATUSES.IN_PROGRESS, TICKET_STATUSES.RESOLVED],
  [TICKET_STATUSES.RESOLVED]:    [TICKET_STATUSES.CLOSED],
  [TICKET_STATUSES.CLOSED]:      [],
};

/**
 * Minutes after creation before an unresolved ticket is auto-escalated
 * by the escalation engine.  Mirrors SLA_MINUTES exactly.
 */
const ESCALATION_MINUTES = {
  urgent: 30,
  high:   120,
  medium: 480,
  low:    1440,
};

/** Ticket ID prefix. */
const TICKET_PREFIX = process.env.TICKET_ID_PREFIX || 'TKT';

/**
 * Notification event types emitted by the notification engine.
 */
const NOTIFICATION_TYPES = {
  NEW_COMPLAINT:        'NEW_COMPLAINT',
  DEADLINE_APPROACHING: 'DEADLINE_APPROACHING',
  ESCALATION:           'ESCALATION',
};

/**
 * Minutes before SLA deadline at which a DEADLINE_APPROACHING alert fires.
 * Overridden by DEADLINE_WARN_MINUTES env var.
 */
const DEADLINE_WARN_MINUTES = parseInt(process.env.DEADLINE_WARN_MINUTES) || 30;

/** SLA response times (minutes) per priority. */
const SLA_MINUTES = {
  urgent: 30,
  high:   120,
  medium: 480,
  low:    1440,
};

module.exports = {
  CHANNELS,
  PRIORITIES,
  PRIORITY_WEIGHT,
  PRIORITY_KEYWORDS,
  TICKET_PREFIX,
  SLA_MINUTES,
  TICKET_STATUSES,
  ALLOWED_TRANSITIONS,
  ESCALATION_MINUTES,
  NOTIFICATION_TYPES,
  DEADLINE_WARN_MINUTES,
};
