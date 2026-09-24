'use strict';

/**
 * /api/tickets router
 *
 * A clean, website-friendly alias for ticket data.
 * Designed for future integration with the main website frontend.
 *
 * Endpoints:
 *   GET  /api/tickets            — List/filter tickets
 *   GET  /api/tickets/workflow   — Describe the status workflow (self-documenting)
 *   GET  /api/tickets/:id        — Get a single ticket
 *   GET  /api/tickets/:id/history — Full audit history for a ticket
 */

const express = require('express');
const router  = express.Router();

const ticketStore                    = require('../store/ticketStore');
const { getValidTransitions }        = require('../services/statusService');
const { TICKET_STATUSES, ALLOWED_TRANSITIONS } = require('../config/constants');

/* ─────────────────────────────────────────────
   GET /api/tickets
   List tickets with optional filters & pagination.
   Query params:
     channel  = EMAIL | CHAT | PHONE | WEB | SOCIAL | WHATSAPP | SMS | API
     status   = new | in_progress | escalated | resolved | closed
     priority = urgent | high | medium | low
     page     = 1 (default)
     limit    = 20 (default, max 100)
───────────────────────────────────────────── */
router.get('/', (req, res) => {
  const { channel, status, priority, page, limit } = req.query;
  const result = ticketStore.findAll({ channel, status, priority, page, limit });

  return res.json({
    success: true,
    ...result,
    // Include workflow metadata for UI rendering
    workflow: {
      statuses: Object.values(TICKET_STATUSES),
    },
  });
});

/* ─────────────────────────────────────────────
   GET /api/tickets/workflow
   Self-documenting: returns the full status workflow
   and transition rules. Useful for frontend UIs to
   dynamically render allowed action buttons.
───────────────────────────────────────────── */
router.get('/workflow', (_req, res) => {
  const workflow = Object.entries(ALLOWED_TRANSITIONS).map(([status, nextStatuses]) => ({
    status,
    validNextStatuses: nextStatuses,
    isTerminal: nextStatuses.length === 0,
  }));

  return res.json({
    success: true,
    workflow,
    description: 'Ticket lifecycle: new → in_progress → resolved → closed. ' +
                 'Tickets can be escalated at any non-terminal stage.',
  });
});

/* ─────────────────────────────────────────────
   GET /api/tickets/:id/history
   Return the full audit history array for a ticket.
   NOTE: must be declared BEFORE GET /:id so Express does not
   treat "history" as an :id value.
───────────────────────────────────────────── */
router.get('/:id/history', (req, res, next) => {
  const ticket = ticketStore.findById(req.params.id);
  if (!ticket) {
    return next(Object.assign(
      new Error(`Ticket "${req.params.id}" not found`),
      { statusCode: 404 }
    ));
  }

  return res.json({
    success:    true,
    ticketId:   ticket.id,
    status:     ticket.status,
    priority:   ticket.priority,
    history:    ticket.history,
    eventCount: ticket.history.length,
    timestamps: ticket.timestamps,
  });
});

/* ─────────────────────────────────────────────
   GET /api/tickets/:id
   Get a single ticket by ID.
   Includes a validNextTransitions field for UI convenience.
───────────────────────────────────────────── */
router.get('/:id', (req, res, next) => {
  const ticket = ticketStore.findById(req.params.id);
  if (!ticket) {
    return next(Object.assign(
      new Error(`Ticket "${req.params.id}" not found`),
      { statusCode: 404 }
    ));
  }

  return res.json({
    success: true,
    ticket,
    validNextTransitions: getValidTransitions(ticket.status),
  });
});

module.exports = router;
