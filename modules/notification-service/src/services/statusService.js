'use strict';

const { ALLOWED_TRANSITIONS, TICKET_STATUSES } = require('../config/constants');

/**
 * Status Workflow Service
 *
 * Encapsulates all business rules around ticket status transitions.
 * Does NOT interact with the store directly — callers are responsible
 * for persisting the mutated ticket object.
 */

/**
 * Check whether a transition from one status to another is permitted.
 *
 * @param {string} fromStatus - Current ticket status
 * @param {string} toStatus   - Desired next status
 * @returns {boolean}
 */
function canTransition(fromStatus, toStatus) {
  const valid = ALLOWED_TRANSITIONS[fromStatus];
  return Array.isArray(valid) && valid.includes(toStatus);
}

/**
 * Return the list of valid next statuses for a given current status.
 *
 * @param {string} currentStatus
 * @returns {string[]}
 */
function getValidTransitions(currentStatus) {
  return ALLOWED_TRANSITIONS[currentStatus] || [];
}

/**
 * Apply a status transition to a ticket object (mutates in-place).
 *
 * Throws a structured error (with statusCode 400) if the transition is
 * not permitted so the route layer can forward it to errorHandler cleanly.
 *
 * @param {Object} ticket        - The ticket object from the store
 * @param {string} newStatus     - Desired next status
 * @param {string} [agentNote]   - Optional note from the support agent
 * @param {string} [triggeredBy] - Who/what triggered this ('agent' | 'system')
 * @returns {Object}             - The mutated ticket
 */
function transitionStatus(ticket, newStatus, agentNote = '', triggeredBy = 'agent') {
  const normNew = String(newStatus || '').trim().toLowerCase();

  // 1. Validate target status is a known value
  const knownStatuses = Object.values(TICKET_STATUSES);
  if (!knownStatuses.includes(normNew)) {
    throw Object.assign(
      new Error(`Unknown status "${newStatus}". Valid statuses: ${knownStatuses.join(', ')}`),
      { statusCode: 400 }
    );
  }

  // 2. Guard no-op transitions
  if (ticket.status === normNew) {
    throw Object.assign(
      new Error(`Ticket is already in "${normNew}" status.`),
      { statusCode: 400 }
    );
  }

  // 3. Enforce transition rules
  if (!canTransition(ticket.status, normNew)) {
    const valid = getValidTransitions(ticket.status);
    const hint  = valid.length
      ? `Valid transitions from "${ticket.status}": ${valid.join(', ')}`
      : `Ticket is in terminal status "${ticket.status}" and cannot be transitioned further.`;

    throw Object.assign(
      new Error(`Cannot transition from "${ticket.status}" to "${normNew}". ${hint}`),
      { statusCode: 400 }
    );
  }

  // 4. Apply the transition
  const prevStatus = ticket.status;
  const now        = new Date().toISOString();

  ticket.status = normNew;
  ticket.timestamps.updatedAt = now;

  // Track when ticket was first picked up
  if (normNew === TICKET_STATUSES.IN_PROGRESS && !ticket.timestamps.firstPickedUpAt) {
    ticket.timestamps.firstPickedUpAt = now;
  }

  // Track resolution time
  if (normNew === TICKET_STATUSES.RESOLVED && !ticket.timestamps.resolvedAt) {
    ticket.timestamps.resolvedAt = now;
  }

  // Track closure time
  if (normNew === TICKET_STATUSES.CLOSED && !ticket.timestamps.closedAt) {
    ticket.timestamps.closedAt = now;
  }

  // Track escalation time (first escalation only)
  if (normNew === TICKET_STATUSES.ESCALATED && !ticket.timestamps.firstEscalatedAt) {
    ticket.timestamps.firstEscalatedAt = now;
  }

  // Append history entry
  const historyEntry = {
    action:      'status_changed',
    from:        prevStatus,
    to:          normNew,
    timestamp:   now,
    triggeredBy,
    detail: agentNote
      ? `Status changed from "${prevStatus}" to "${normNew}". Note: ${agentNote}`
      : `Status changed from "${prevStatus}" to "${normNew}"`,
  };
  ticket.history.push(historyEntry);

  return ticket;
}

module.exports = {
  canTransition,
  getValidTransitions,
  transitionStatus,
};
