'use strict';

const express = require('express');
const router  = express.Router();

const { createTicket }              = require('../services/ticketService');
const { transitionStatus, getValidTransitions } = require('../services/statusService');
const ticketStore                   = require('../store/ticketStore');
const { CHANNELS }                  = require('../config/constants');

/* ─────────────────────────────────────────────
   POST /api/complaints
   Ingest a new complaint from any channel.
   Body: { channel, subject, body, priority?, customer?, metadata? }
   Created tickets start in status: 'new'
───────────────────────────────────────────── */
router.post('/', (req, res, next) => {
  try {
    const ticket = createTicket(req.body);
    ticketStore.save(ticket);

    console.log(
      `[TICKET CREATED] id=${ticket.id} channel=${ticket.channel} ` +
      `priority=${ticket.priority} status=${ticket.status}`
    );

    return res.status(201).json({
      success: true,
      message: 'Complaint received. Ticket created successfully.',
      ticket,
    });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────
   GET /api/complaints
   List all tickets with optional filters & pagination.
   Query: ?channel=EMAIL&status=in_progress&priority=high&page=1&limit=20
   Valid statuses: new | in_progress | escalated | resolved | closed
───────────────────────────────────────────── */
router.get('/', (req, res) => {
  const { channel, status, priority, page, limit } = req.query;
  const result = ticketStore.findAll({ channel, status, priority, page, limit });

  return res.json({
    success: true,
    ...result,
  });
});

/* ─────────────────────────────────────────────
   GET /api/complaints/stats
   Aggregate statistics across all tickets.
───────────────────────────────────────────── */
router.get('/stats', (_req, res) => {
  return res.json({
    success: true,
    stats: ticketStore.stats(),
  });
});

/* ─────────────────────────────────────────────
   GET /api/complaints/channels
   List all supported channels.
───────────────────────────────────────────── */
router.get('/channels', (_req, res) => {
  const channels = Object.entries(CHANNELS).map(([key, def]) => ({
    key,
    label: def.label,
    basePriority: def.basePriority,
  }));
  return res.json({ success: true, channels });
});

/* ─────────────────────────────────────────────
   GET /api/complaints/:id
   Retrieve a single ticket by ID.
───────────────────────────────────────────── */
router.get('/:id', (req, res, next) => {
  const ticket = ticketStore.findById(req.params.id);
  if (!ticket) {
    return next(Object.assign(new Error(`Ticket "${req.params.id}" not found`), { statusCode: 404 }));
  }
  return res.json({ success: true, ticket });
});

/* ─────────────────────────────────────────────
   PATCH /api/complaints/:id/status
   Transition a ticket through the defined workflow.
   NOTE: must be declared BEFORE PATCH /:id so Express
   does not treat "status" as the :id param.

   Body: { status, note? }
   Workflow:
     new → in_progress | escalated
     in_progress → escalated | resolved
     escalated → in_progress | resolved
     resolved → closed
     closed → (terminal)
───────────────────────────────────────────── */
router.patch('/:id/status', (req, res, next) => {
  try {
    const ticket = ticketStore.findById(req.params.id);
    if (!ticket) {
      return next(Object.assign(new Error(`Ticket "${req.params.id}" not found`), { statusCode: 404 }));
    }

    const { status: newStatus, note } = req.body;
    if (!newStatus) {
      return next(Object.assign(
        new Error('Request body must include "status". Valid transitions for this ticket: ' +
          getValidTransitions(ticket.status).join(', ') || 'none (terminal state)'),
        { statusCode: 400 }
      ));
    }

    // transitionStatus mutates ticket in-place and throws on invalid moves
    const updated = transitionStatus(ticket, newStatus, note || '', 'agent');
    ticketStore.save(updated); // persist the mutation

    console.log(
      `[STATUS TRANSITION] id=${updated.id} → ${updated.status} ` +
      `(note: ${note || 'none'})`
    );

    return res.json({
      success: true,
      message: `Ticket status updated to "${updated.status}".`,
      ticket:  updated,
      validNextTransitions: getValidTransitions(updated.status),
    });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────
   PATCH /api/complaints/:id
   Update mutable fields: priority, assignee.
   NOTE: status is excluded — use PATCH /:id/status instead.
───────────────────────────────────────────── */
router.patch('/:id', (req, res, next) => {
  const ticket = ticketStore.findById(req.params.id);
  if (!ticket) {
    return next(Object.assign(new Error(`Ticket "${req.params.id}" not found`), { statusCode: 404 }));
  }

  // Explicitly reject status updates through the generic endpoint
  if (req.body.status !== undefined) {
    return next(Object.assign(
      new Error(
        'Use PATCH /api/complaints/:id/status to change ticket status. ' +
        `Valid transitions from "${ticket.status}": ` +
        (getValidTransitions(ticket.status).join(', ') || 'none — ticket is in terminal state.')
      ),
      { statusCode: 400 }
    ));
  }

  const updated = ticketStore.update(req.params.id, req.body);
  return res.json({
    success: true,
    message: 'Ticket updated.',
    ticket: updated,
  });
});

module.exports = router;
