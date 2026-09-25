const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const ticketRoutes = require('./ticket.routes');
const aiRoutes = require('./ai.routes');
const notificationRoutes = require('./notification.routes');
const walletRoutes = require('./wallet.routes');
const channelRoutes = require('./channel.routes');
const analyticsRoutes = require('./analytics.routes');
const webhookRoutes = require('./webhook.routes');

const { syncGmail } = require('../controllers/channel.controller');
const { simulateMessage } = require('../controllers/ticket.controller');

// Mount sub-routers under /api
router.use('/auth', authRoutes);
router.use('/tickets', ticketRoutes);
router.use('/ai', aiRoutes);
router.use('/notifications', notificationRoutes);
router.use('/wallets', walletRoutes);
router.use('/channels', channelRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/webhooks', webhookRoutes);

// Top-level /api endpoints for direct backward compatibility with existing frontend
router.post('/sync', syncGmail);
router.post('/simulate-message', simulateMessage);

const { getDbStatus, query, isPostgresConnected } = require('../config/database.config');

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CCMRS Backend',
    database: isPostgresConnected() ? 'PostgreSQL (Connected)' : 'Fallback Store',
    timestamp: new Date().toISOString()
  });
});

// Real-time Database Status & Table Stats for Admin Dashboard & Verification
router.get('/system/database-status', async (req, res) => {
  try {
    const status = await getDbStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Database direct inspection endpoint (returns top rows for any allowed table)
router.get('/system/db-inspect/:table', async (req, res) => {
  const allowedTables = ['users', 'tickets', 'ticket_messages', 'customer_wallets', 'vouchers', 'notifications'];
  const table = req.params.table;
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ success: false, error: `Invalid table name. Allowed: ${allowedTables.join(', ')}` });
  }
  if (!isPostgresConnected()) {
    return res.status(503).json({ success: false, error: 'PostgreSQL is not connected.' });
  }
  try {
    const result = await query(`SELECT * FROM ${table} ORDER BY 1 DESC LIMIT 50;`);
    res.json({
      success: true,
      table,
      rowCount: result.rowCount,
      rows: result.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AWS S3 Cloud Storage Status Endpoint
const s3Service = require('../services/s3.service');
router.get('/system/s3-status', (req, res) => {
  res.json({
    success: true,
    s3: s3Service.getStatus(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
