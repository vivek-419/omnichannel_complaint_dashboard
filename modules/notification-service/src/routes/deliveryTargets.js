'use strict';

/**
 * Delivery Targets Router
 *
 * CRUD endpoints for managing email and webhook push notification targets.
 *
 * POST   /api/delivery-targets           Register a new target
 * GET    /api/delivery-targets           List all targets
 * GET    /api/delivery-targets/:id       Get a single target
 * PATCH  /api/delivery-targets/:id       Update events/active/label
 * DELETE /api/delivery-targets/:id       Remove a target
 */

const express     = require('express');
const router      = express.Router();
const targetStore = require('../store/deliveryTargetStore');

/* ─────────────────────────────────────────────────────────────────────────
   POST /api/delivery-targets
   Register a new email or webhook delivery target.

   Body:
     { type: 'webhook', target: 'https://...', events: ['*'], label?: '...' }
     { type: 'email',   target: 'ops@co.com',  events: ['NEW_COMPLAINT'],  label?: '...' }
───────────────────────────────────────────────────────────────────────── */
router.post('/', (req, res, next) => {
  try {
    const { type, target, events, label } = req.body || {};
    const record = targetStore.add({ type, target, events, label });

    console.log(`[DELIVERY TARGET] Registered ${record.type} → ${record.target} events=${record.events.join(',')}`);

    return res.status(201).json({
      success: true,
      message: `Delivery target registered.`,
      target:  record,
    });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/delivery-targets
   List all registered targets.
   Query: ?type=webhook|email  &active=true|false
───────────────────────────────────────────────────────────────────────── */
router.get('/', (req, res) => {
  const { type, active } = req.query;
  const targets = targetStore.findAll({ type, active });
  return res.json({ success: true, targets, total: targets.length });
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/delivery-targets/:id
   Retrieve a single target.
───────────────────────────────────────────────────────────────────────── */
router.get('/:id', (req, res, next) => {
  const target = targetStore.findById(req.params.id);
  if (!target) {
    return next(Object.assign(
      new Error(`Delivery target "${req.params.id}" not found`),
      { statusCode: 404 }
    ));
  }
  return res.json({ success: true, target });
});

/* ─────────────────────────────────────────────────────────────────────────
   PATCH /api/delivery-targets/:id
   Update mutable fields: events, active, label.

   Body (any subset):
     { active: false }
     { events: ['ESCALATION', 'DEADLINE_APPROACHING'] }
     { label: 'Ops Team Slack Hook' }
───────────────────────────────────────────────────────────────────────── */
router.patch('/:id', (req, res, next) => {
  try {
    const existing = targetStore.findById(req.params.id);
    if (!existing) {
      return next(Object.assign(
        new Error(`Delivery target "${req.params.id}" not found`),
        { statusCode: 404 }
      ));
    }

    const updated = targetStore.update(req.params.id, req.body || {});
    return res.json({
      success: true,
      message: 'Delivery target updated.',
      target:  updated,
    });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   DELETE /api/delivery-targets/:id
   Remove a delivery target permanently.
───────────────────────────────────────────────────────────────────────── */
router.delete('/:id', (req, res, next) => {
  const existing = targetStore.findById(req.params.id);
  if (!existing) {
    return next(Object.assign(
      new Error(`Delivery target "${req.params.id}" not found`),
      { statusCode: 404 }
    ));
  }

  targetStore.remove(req.params.id);
  console.log(`[DELIVERY TARGET] Removed ${existing.type} → ${existing.target}`);

  return res.json({
    success: true,
    message: `Delivery target removed.`,
  });
});

module.exports = router;
