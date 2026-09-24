'use strict';

const { ESCALATION_MINUTES, TICKET_STATUSES } = require('../config/constants');
const { transitionStatus }                     = require('./statusService');

/**
 * Escalation Engine
 *
 * Runs as a background interval job. On each tick it:
 *   1. Scans all tickets in `new` or `in_progress` status.
 *   2. Compares the current time against the ticket's SLA deadline
 *      (stored on ticket.timestamps.slaDeadline at creation time).
 *   3. Any ticket that has breached its deadline is automatically
 *      transitioned to `escalated` and a history entry is appended.
 */

/** Statuses eligible for auto-escalation. */
const ESCALATABLE_STATUSES = new Set([
  TICKET_STATUSES.NEW,
  TICKET_STATUSES.IN_PROGRESS,
]);

/**
 * Compute the escalation deadline for a ticket.
 * Uses ticket.timestamps.slaDeadline if set (preferred), otherwise
 * derives it from createdAt + ESCALATION_MINUTES[priority].
 *
 * @param {Object} ticket
 * @returns {Date}
 */
function getEscalationDeadline(ticket) {
  // Prefer the SLA deadline stamped at creation.
  if (ticket.timestamps && ticket.timestamps.slaDeadline) {
    return new Date(ticket.timestamps.slaDeadline);
  }

  // Fallback: compute from createdAt + priority minutes.
  const minutes = ESCALATION_MINUTES[ticket.priority] ?? ESCALATION_MINUTES.medium;
  const created = new Date(ticket.timestamps.createdAt);
  return new Date(created.getTime() + minutes * 60 * 1000);
}

/**
 * Inspect all store tickets and escalate any that are past their deadline.
 *
 * @param {Object} store - The ticketStore module (must expose findAll & update)
 * @returns {{ escalated: string[], checked: number }} - Summary of what happened
 */
function checkAndEscalate(store) {
  const now  = new Date();
  const { tickets } = store.findAll({ limit: 1000 }); // fetch a large batch

  const escalatedIds = [];

  for (const ticket of tickets) {
    if (!ESCALATABLE_STATUSES.has(ticket.status)) continue;

    const deadline = getEscalationDeadline(ticket);
    if (now < deadline) continue; // still within SLA

    // Build the auto-escalation note
    const minutesOverdue = Math.round((now - deadline) / 60_000);
    const note = `Auto-escalated by system: SLA deadline breached by ${minutesOverdue} minute(s). Priority: ${ticket.priority}.`;

    try {
      // transitionStatus mutates the ticket object in-place
      const updatedTicket = transitionStatus(ticket, TICKET_STATUSES.ESCALATED, note, 'system');

      // Add an explicit escalation marker to the last history entry
      const lastEntry = updatedTicket.history[updatedTicket.history.length - 1];
      lastEntry.action       = 'auto_escalated';
      lastEntry.minutesOverdue = minutesOverdue;

      // Persist back to the store
      store.save(updatedTicket);
      escalatedIds.push(ticket.id);

      console.warn(
        `[ESCALATION ENGINE] Auto-escalated ticket ${ticket.id} ` +
        `(priority=${ticket.priority}, ${minutesOverdue}m overdue)`
      );
    } catch (err) {
      // If the transition fails (e.g. race condition), log and continue
      console.error(`[ESCALATION ENGINE] Failed to escalate ${ticket.id}: ${err.message}`);
    }
  }

  return { escalated: escalatedIds, checked: tickets.length };
}

/**
 * Start the background escalation engine.
 *
 * @param {Object} store         - The ticketStore module
 * @param {number} [intervalMs]  - How often to run (default: 60 000 ms)
 * @returns {Function}           - Call this function to stop the engine
 */
function startEscalationEngine(store, intervalMs) {
  const ms = intervalMs
    ?? parseInt(process.env.ESCALATION_CHECK_INTERVAL_MS)
    ?? 60_000;

  console.log(
    `[ESCALATION ENGINE] Started. Checking every ${ms / 1000}s for SLA breaches.`
  );

  // Run once immediately on startup, then on interval
  checkAndEscalate(store);

  const handle = setInterval(() => {
    const { escalated, checked } = checkAndEscalate(store);
    if (escalated.length > 0) {
      console.warn(
        `[ESCALATION ENGINE] Tick: checked ${checked} tickets, ` +
        `escalated ${escalated.length}: [${escalated.join(', ')}]`
      );
    } else {
      console.log(
        `[ESCALATION ENGINE] Tick: checked ${checked} tickets, none overdue.`
      );
    }
  }, ms);

  // Return a stop function for clean shutdown
  return function stopEscalationEngine() {
    clearInterval(handle);
    console.log('[ESCALATION ENGINE] Stopped.');
  };
}

module.exports = {
  checkAndEscalate,
  startEscalationEngine,
};
