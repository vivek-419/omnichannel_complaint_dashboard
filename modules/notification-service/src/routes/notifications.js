'use strict';

/**
 * Notifications Router
 *
 * GET    /api/notifications              List notifications (filters + pagination)
 * GET    /api/notifications/unread-count Quick badge counter
 * PATCH  /api/notifications/read         Mark notifications as read
 * DELETE /api/notifications              Clear all notifications (dev/admin)
 */

const express = require('express');
const router  = express.Router();

const notificationService = require('../services/notificationService');

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/notifications
   Query params:
     type      – NEW_COMPLAINT | DEADLINE_APPROACHING | ESCALATION
     ticketId  – filter to a specific ticket
     read      – 'true' | 'false'
     page      – 1-based (default 1)
     limit     – items per page (default 20, max 100)
───────────────────────────────────────────────────────────────────────── */
router.get('/', (req, res) => {
  const { type, ticketId, read, page, limit } = req.query;
  const result = notificationService.getAll({ type, ticketId, read, page, limit });

  return res.json({
    success: true,
    ...result,
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/notifications/unread-count
   Returns { count: number } — lightweight endpoint for badge polling.
───────────────────────────────────────────────────────────────────────── */
router.get('/unread-count', (_req, res) => {
  return res.json({
    success: true,
    count: notificationService.getUnreadCount(),
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   PATCH /api/notifications/read
   Body (one of):
     { all: true }          → mark every notification as read
     { ids: ["id1","id2"] } → mark specific notifications as read
───────────────────────────────────────────────────────────────────────── */
router.patch('/read', (req, res) => {
  const { all, ids } = req.body || {};

  let updated = 0;

  if (all === true) {
    updated = notificationService.markAllRead();
    return res.json({
      success: true,
      message: `All notifications marked as read.`,
      updated,
    });
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: 400, message: 'Provide either { all: true } or { ids: ["id1", ...] }' },
    });
  }

  updated = notificationService.markRead(ids);
  return res.json({
    success: true,
    message: `${updated} notification(s) marked as read.`,
    updated,
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   DELETE /api/notifications
   Clears all stored notifications and resets the deadline-alert dedup set.
   Intended for development resets / admin tooling.
───────────────────────────────────────────────────────────────────────── */
router.delete('/', (_req, res) => {
  notificationService.clearAll();
  return res.json({
    success: true,
    message: 'All notifications cleared.',
  });
});

module.exports = router;
