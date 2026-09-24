'use strict';

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');

const complaintsRouter               = require('./routes/complaints');
const ticketsRouter                  = require('./routes/tickets');
const notificationsRouter            = require('./routes/notifications');
const deliveryTargetsRouter          = require('./routes/deliveryTargets');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { startEscalationEngine }      = require('./services/escalationEngine');
const notificationService            = require('./services/notificationService');
const ticketStore                    = require('./store/ticketStore');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS (future website integration: set CORS_ORIGIN in .env) ─────────
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Security & Utility Middleware ──────────────────────────────────────
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ──────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max:      parseInt(process.env.RATE_LIMIT_MAX)        || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    error: { code: 429, message: 'Too many requests. Please try again later.' },
  },
});
app.use(limiter);

// ── Health Check ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    service: 'ticket-auto-creation-service',
    time:    new Date().toISOString(),
    env:     process.env.NODE_ENV || 'development',
    escalationInterval: `${(parseInt(process.env.ESCALATION_CHECK_INTERVAL_MS) || 60_000) / 1000}s`,
  });
});

// ── API Routes ─────────────────────────────────────────────────────────
app.use('/api/complaints',       complaintsRouter);
app.use('/api/tickets',          ticketsRouter);         // website-friendly alias
app.use('/api/notifications',    notificationsRouter);
app.use('/api/delivery-targets', deliveryTargetsRouter);

// ── 404 & Error Handling ───────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start Server ───────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│       🎫  Ticket Status Workflow Service              │');
  console.log('├──────────────────────────────────────────────────────┤');
  console.log(`│  Listening on  → http://localhost:${PORT}                │`);
  console.log(`│  Environment   → ${(process.env.NODE_ENV || 'development').padEnd(35)}│`);
  console.log(`│  CORS Origin   → ${String(corsOrigin).padEnd(35)}│`);
  console.log('│  Workflow      → new→in_progress→resolved→closed     │');
  console.log('├──────────────────────────────────────────────────────┤');
  console.log('│  🔔 Notifications  → /api/notifications              │');
  console.log('│  📬 Delivery       → /api/delivery-targets           │');
  console.log('│  🔍 Search/Filter  → GET /api/complaints?q=...       │');
  console.log('└──────────────────────────────────────────────────────┘');
  console.log('');

  // ── Start Escalation Engine (after server is ready) ───────────────────
  const intervalMs = parseInt(process.env.ESCALATION_CHECK_INTERVAL_MS) || 60_000;
  const stopEngine = startEscalationEngine(ticketStore, intervalMs);

  // ── Start SLA Deadline Poller ──────────────────────────────────────
  notificationService.startDeadlinePoller();

  // Graceful shutdown: stop engines when the server closes
  server.on('close', () => {
    stopEngine();
    notificationService.stopDeadlinePoller();
  });
});

module.exports = app; // export for testing
