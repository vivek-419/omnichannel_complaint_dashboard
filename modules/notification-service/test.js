'use strict';

/**
 * Unit tests for the Ticket Auto-Creation Service.
 *
 * Run: npm test
 *
 * Tests cover:
 *  1. Ticket factory — ID format, shape, required fields
 *  2. Priority computation — channel defaults, keyword escalation, overrides
 *  3. Channel validation
 *  4. Notification engine — emit, getAll, markRead, unread count, clear
 *  5. Ticket store search & filter — agent, date range, free-text, sortBy
 */

const assert = require('assert');
const http   = require('http');

// ────────────────────────────────────────────────────────────
// 1. ticketService unit tests
// ────────────────────────────────────────────────────────────

const {
  createTicket,
  computePriority,
  generateTicketId,
  resolveChannel,
} = require('./src/services/ticketService');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌  ${name}`);
    console.log(`       → ${e.message}`);
    failed++;
  }
}

// ── generateTicketId ─────────────────────────────────────────
console.log('\n📋  generateTicketId');

test('returns string matching TKT-YYYYMMDD-XXXXXXXX', () => {
  const id = generateTicketId();
  assert.match(id, /^TKT-\d{8}-[A-Z0-9]{8}$/);
});

test('each call returns a unique ID', () => {
  const ids = new Set(Array.from({ length: 1000 }, generateTicketId));
  assert.strictEqual(ids.size, 1000);
});

// ── resolveChannel ───────────────────────────────────────────
console.log('\n📡  resolveChannel');

test('accepts valid channel (case-insensitive)', () => {
  assert.strictEqual(resolveChannel('email'), 'EMAIL');
  assert.strictEqual(resolveChannel('CHAT'), 'CHAT');
  assert.strictEqual(resolveChannel('whatsApp'), 'WHATSAPP');
});

test('throws 400 for invalid channel', () => {
  assert.throws(
    () => resolveChannel('PIGEON'),
    err => err.statusCode === 400
  );
});

test('throws 400 for empty channel', () => {
  assert.throws(
    () => resolveChannel(''),
    err => err.statusCode === 400
  );
});

// ── computePriority ──────────────────────────────────────────
console.log('\n⚡  computePriority');

test('respects caller override if valid', () => {
  assert.strictEqual(computePriority('EMAIL', 'hello', 'urgent'), 'urgent');
});

test('ignores invalid override and falls back to computed', () => {
  const p = computePriority('EMAIL', 'slow delivery', 'banana');
  assert.ok(['low','medium','high','urgent'].includes(p));
});

test('PHONE channel has high base priority', () => {
  const p = computePriority('PHONE', 'I have a question', null);
  assert.ok(p === 'high' || p === 'urgent'); // high base, no escalation keywords
});

test('escalates to urgent on critical keyword', () => {
  assert.strictEqual(
    computePriority('EMAIL', 'URGENT server is down and data breach detected', null),
    'urgent'
  );
});

test('escalates on "broken" keyword from low channel', () => {
  const p = computePriority('SOCIAL', 'The app is broken and not working at all', null);
  assert.ok(p === 'high' || p === 'urgent');
});

test('no escalation for neutral text on low channel', () => {
  const p = computePriority('SOCIAL', 'Just checking in', null);
  assert.strictEqual(p, 'low');
});

// ── createTicket ─────────────────────────────────────────────
console.log('\n🎫  createTicket');

test('creates ticket with all required top-level fields', () => {
  const t = createTicket({ channel: 'EMAIL', subject: 'Test', body: 'Body text' });
  for (const field of ['id','uuid','channel','status','priority','subject','body','timestamps','history']) {
    assert.ok(field in t, `Missing field: ${field}`);
  }
});

test('ticket ID matches expected format', () => {
  const t = createTicket({ channel: 'WEB', subject: 'Hi', body: 'Issue here' });
  assert.match(t.id, /^TKT-\d{8}-[A-Z0-9]{8}$/);
});

test('timestamps.createdAt is a valid ISO string', () => {
  const t = createTicket({ channel: 'SMS', subject: 'Hi', body: 'Problem' });
  assert.ok(!isNaN(new Date(t.timestamps.createdAt)));
});

test('slaDeadline is after createdAt', () => {
  const t = createTicket({ channel: 'CHAT', subject: 'Rush', body: 'Need help fast' });
  assert.ok(new Date(t.timestamps.slaDeadline) > new Date(t.timestamps.createdAt));
});

test('status defaults to "new"', () => {
  const t = createTicket({ channel: 'API', subject: 'X', body: 'Y' });
  assert.strictEqual(t.status, 'new');
});

test('throws 400 when channel is missing', () => {
  assert.throws(
    () => createTicket({ subject: 'X', body: 'Y' }),
    err => err.statusCode === 400
  );
});

test('throws 400 when subject is missing', () => {
  assert.throws(
    () => createTicket({ channel: 'EMAIL', body: 'Y' }),
    err => err.statusCode === 400
  );
});

test('throws 400 when body is missing', () => {
  assert.throws(
    () => createTicket({ channel: 'EMAIL', subject: 'X' }),
    err => err.statusCode === 400
  );
});

test('customer info is sanitised', () => {
  const t = createTicket({
    channel: 'EMAIL', subject: 'X', body: 'Y',
    customer: { name: 'Alice', email: 'alice@example.com', phone: '555-1234', unknown: 'drop' },
  });
  assert.strictEqual(t.customer.name, 'Alice');
  assert.strictEqual(t.customer.unknown, undefined);
});

// ────────────────────────────────────────────────────────────
// 4. notificationService unit tests
// ────────────────────────────────────────────────────────────

const notificationService = require('./src/services/notificationService');
const { NOTIFICATION_TYPES } = require('./src/config/constants');

// Stop the poller so it doesn't interfere with unit tests
notificationService.stopDeadlinePoller();
notificationService.clearAll(); // clean slate

// Helper: make a minimal fake ticket
function fakeTicket(overrides = {}) {
  return {
    id:          'TKT-TEST-0001',
    channel:     'EMAIL',
    channelLabel:'Email',
    priority:    'medium',
    subject:     'Test complaint',
    assignee:    undefined,
    timestamps:  { createdAt: new Date().toISOString(), slaDeadline: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() },
    status:      'open',
    ...overrides,
  };
}

console.log('\n🔔  notificationService');

test('emit() creates a NEW_COMPLAINT notification', () => {
  notificationService.clearAll();
  const ticket = fakeTicket();
  const n = notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT, ticket);
  assert.strictEqual(n.type, 'NEW_COMPLAINT');
  assert.strictEqual(n.ticketId, ticket.id);
  assert.strictEqual(n.read, false);
  assert.ok(n.id && n.createdAt);
});

test('emit() creates a DEADLINE_APPROACHING notification', () => {
  notificationService.clearAll();
  const ticket = fakeTicket({ id: 'TKT-TEST-0002' });
  const n = notificationService.emit(NOTIFICATION_TYPES.DEADLINE_APPROACHING, ticket, 'SLA in 10 mins');
  assert.strictEqual(n.type, 'DEADLINE_APPROACHING');
  assert.strictEqual(n.detail, 'SLA in 10 mins');
});

test('emit() creates an ESCALATION notification', () => {
  notificationService.clearAll();
  const ticket = fakeTicket({ id: 'TKT-TEST-0003', priority: 'urgent' });
  const n = notificationService.emit(NOTIFICATION_TYPES.ESCALATION, ticket);
  assert.strictEqual(n.type, 'ESCALATION');
});

test('emit() throws for unknown notification type', () => {
  assert.throws(
    () => notificationService.emit('UNKNOWN_TYPE', fakeTicket()),
    /Unknown notification type/
  );
});

test('getAll() returns all notifications, newest first', () => {
  notificationService.clearAll();
  notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT,        fakeTicket({ id: 'A' }));
  notificationService.emit(NOTIFICATION_TYPES.DEADLINE_APPROACHING, fakeTicket({ id: 'B' }));
  notificationService.emit(NOTIFICATION_TYPES.ESCALATION,           fakeTicket({ id: 'C' }));
  const { notifications, total } = notificationService.getAll();
  assert.strictEqual(total, 3);
  // newest first — last emitted is C
  assert.strictEqual(notifications[0].type, 'ESCALATION');
});

test('getAll() filters by type', () => {
  notificationService.clearAll();
  notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT,        fakeTicket({ id: 'X1' }));
  notificationService.emit(NOTIFICATION_TYPES.ESCALATION,           fakeTicket({ id: 'X2' }));
  notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT,        fakeTicket({ id: 'X3' }));
  const { notifications } = notificationService.getAll({ type: 'NEW_COMPLAINT' });
  assert.ok(notifications.every(n => n.type === 'NEW_COMPLAINT'));
  assert.strictEqual(notifications.length, 2);
});

test('getAll() filters by read=false', () => {
  notificationService.clearAll();
  const t1 = fakeTicket({ id: 'R1' });
  const t2 = fakeTicket({ id: 'R2' });
  const n1 = notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT, t1);
  notificationService.emit(NOTIFICATION_TYPES.ESCALATION, t2);
  notificationService.markRead([n1.id]);
  const { notifications } = notificationService.getAll({ read: 'false' });
  assert.ok(notifications.every(n => !n.read));
});

test('getUnreadCount() returns correct count', () => {
  notificationService.clearAll();
  notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT,        fakeTicket({ id: 'U1' }));
  notificationService.emit(NOTIFICATION_TYPES.DEADLINE_APPROACHING, fakeTicket({ id: 'U2' }));
  notificationService.emit(NOTIFICATION_TYPES.ESCALATION,           fakeTicket({ id: 'U3' }));
  assert.strictEqual(notificationService.getUnreadCount(), 3);
});

test('markRead() marks specific notifications read', () => {
  notificationService.clearAll();
  const n1 = notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT, fakeTicket({ id: 'M1' }));
  const n2 = notificationService.emit(NOTIFICATION_TYPES.ESCALATION,    fakeTicket({ id: 'M2' }));
  const updated = notificationService.markRead([n1.id]);
  assert.strictEqual(updated, 1);
  const { notifications } = notificationService.getAll();
  const found1 = notifications.find(n => n.id === n1.id);
  const found2 = notifications.find(n => n.id === n2.id);
  assert.strictEqual(found1.read, true);
  assert.strictEqual(found2.read, false);
});

test('markAllRead() marks every notification read', () => {
  notificationService.clearAll();
  notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT,        fakeTicket({ id: 'A1' }));
  notificationService.emit(NOTIFICATION_TYPES.DEADLINE_APPROACHING, fakeTicket({ id: 'A2' }));
  const updated = notificationService.markAllRead();
  assert.strictEqual(updated, 2);
  assert.strictEqual(notificationService.getUnreadCount(), 0);
});

test('clearAll() resets the notification store', () => {
  notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT, fakeTicket({ id: 'CL1' }));
  notificationService.clearAll();
  assert.strictEqual(notificationService.getAll().total, 0);
  assert.strictEqual(notificationService.getUnreadCount(), 0);
});

test('getAll() paginates correctly', () => {
  notificationService.clearAll();
  for (let i = 0; i < 5; i++) {
    notificationService.emit(NOTIFICATION_TYPES.NEW_COMPLAINT, fakeTicket({ id: `P${i}` }));
  }
  const page1 = notificationService.getAll({ limit: 2, page: 1 });
  const page2 = notificationService.getAll({ limit: 2, page: 2 });
  assert.strictEqual(page1.notifications.length, 2);
  assert.strictEqual(page2.notifications.length, 2);
  assert.strictEqual(page1.total, 5);
});

// ────────────────────────────────────────────────────────────
// 5. ticketStore search & filter unit tests
// ────────────────────────────────────────────────────────────

const ticketStore = require('./src/store/ticketStore');

// Seed some tickets for filter tests
const _seedTickets = [
  createTicket({ channel: 'EMAIL',    subject: 'Broken login', body: 'Cannot sign in', customer: { name: 'Alice Smith' } }),
  createTicket({ channel: 'CHAT',     subject: 'Refund request', body: 'I want a refund immediately' }),
  createTicket({ channel: 'PHONE',    subject: 'Urgent outage', body: 'Server is down critical emergency' }),
  createTicket({ channel: 'WEB',      subject: 'Slow page load', body: 'The dashboard is very slow' }),
  createTicket({ channel: 'SOCIAL',   subject: 'General query', body: 'Just a question' }),
];

// Assign agent to first two tickets and save
_seedTickets[0].assignee = 'agent-alice';
_seedTickets[1].assignee = 'agent-bob';
_seedTickets.forEach(t => ticketStore.save(t));

console.log('\n🔍  ticketStore search & filter');

test('findAll() filters by channel', () => {
  const { tickets } = ticketStore.findAll({ channel: 'EMAIL' });
  assert.ok(tickets.every(t => t.channel === 'EMAIL'));
});

test('findAll() filters by status', () => {
  const { tickets } = ticketStore.findAll({ status: 'new' });
  assert.ok(tickets.every(t => t.status === 'new'));
  assert.ok(tickets.length >= 5);
});

test('findAll() filters by priority', () => {
  const { tickets } = ticketStore.findAll({ priority: 'urgent' });
  assert.ok(tickets.every(t => t.priority === 'urgent'));
});

test('findAll() filters by agent (case-insensitive substring)', () => {
  const { tickets } = ticketStore.findAll({ agent: 'alice' });
  assert.ok(tickets.length >= 1);
  assert.ok(tickets.every(t => t.assignee && t.assignee.toLowerCase().includes('alice')));
});

test('findAll() filters by dateFrom (includes today)', () => {
  const today = new Date().toISOString().slice(0, 10);
  const { tickets } = ticketStore.findAll({ dateFrom: today });
  assert.ok(tickets.length >= 5);
});

test('findAll() filters by dateTo (future date includes all)', () => {
  const future = '2099-12-31';
  const { tickets } = ticketStore.findAll({ dateTo: future });
  assert.ok(tickets.length >= 5);
});

test('findAll() date range with past dateTo returns no results', () => {
  const { tickets } = ticketStore.findAll({ dateTo: '2000-01-01' });
  assert.strictEqual(tickets.length, 0);
});

test('findAll() free-text search on subject', () => {
  const { tickets } = ticketStore.findAll({ q: 'broken login' });
  assert.ok(tickets.length >= 1);
  assert.ok(tickets.some(t => t.subject.toLowerCase().includes('broken')));
});

test('findAll() free-text search on customer name', () => {
  const { tickets } = ticketStore.findAll({ q: 'alice smith' });
  assert.ok(tickets.length >= 1);
  assert.ok(tickets.some(t => t.customer?.name === 'Alice Smith'));
});

test('findAll() free-text search returns empty for no match', () => {
  const { tickets } = ticketStore.findAll({ q: 'xyzzy_no_match_guaranteed' });
  assert.strictEqual(tickets.length, 0);
});

test('findAll() sortBy=priority order=desc puts urgent first', () => {
  const { tickets } = ticketStore.findAll({ sortBy: 'priority', order: 'desc' });
  if (tickets.length >= 2) {
    const weights = { urgent: 4, high: 3, medium: 2, low: 1 };
    for (let i = 1; i < tickets.length; i++) {
      assert.ok(
        (weights[tickets[i - 1].priority] || 0) >= (weights[tickets[i].priority] || 0),
        `Sort order broken at index ${i}: ${tickets[i-1].priority} should be >= ${tickets[i].priority}`
      );
    }
  }
});

test('findAll() sortBy=slaDeadline order=asc puts nearest deadline first', () => {
  const { tickets } = ticketStore.findAll({ sortBy: 'slaDeadline', order: 'asc' });
  for (let i = 1; i < tickets.length; i++) {
    const a = new Date(tickets[i - 1].timestamps.slaDeadline);
    const b = new Date(tickets[i].timestamps.slaDeadline);
    assert.ok(a <= b, `slaDeadline sort broken at index ${i}`);
  }
});

test('findAll() pagination limits results correctly', () => {
  const p1 = ticketStore.findAll({ limit: 2, page: 1 });
  assert.strictEqual(p1.tickets.length, 2);
  assert.ok(p1.total >= 5);
});

// ────────────────────────────────────────────────────────────
// 6. deliveryTargetStore unit tests
// ────────────────────────────────────────────────────────────

const deliveryTargetStore = require('./src/store/deliveryTargetStore');

console.log('\n📬  deliveryTargetStore');

test('add() registers a webhook target', () => {
  const t = deliveryTargetStore.add({
    type: 'webhook', target: 'https://example.com/hook', events: ['*'],
  });
  assert.strictEqual(t.type, 'webhook');
  assert.strictEqual(t.target, 'https://example.com/hook');
  assert.deepStrictEqual(t.events, ['*']);
  assert.strictEqual(t.active, true);
  assert.ok(t.id && t.createdAt);
});

test('add() registers an email target', () => {
  const t = deliveryTargetStore.add({
    type: 'email', target: 'ops@example.com', events: ['NEW_COMPLAINT', 'ESCALATION'],
  });
  assert.strictEqual(t.type, 'email');
  assert.strictEqual(t.target, 'ops@example.com');
  assert.deepStrictEqual(t.events, ['NEW_COMPLAINT', 'ESCALATION']);
});

test('add() uppercases event names (except wildcard)', () => {
  const t = deliveryTargetStore.add({
    type: 'webhook', target: 'https://example.com/h2', events: ['new_complaint', '*'],
  });
  assert.ok(t.events.includes('NEW_COMPLAINT'));
  assert.ok(t.events.includes('*'));
});

test('add() throws 400 for invalid type', () => {
  assert.throws(
    () => deliveryTargetStore.add({ type: 'sms', target: 'x', events: ['*'] }),
    err => err.statusCode === 400
  );
});

test('add() throws 400 for bad email', () => {
  assert.throws(
    () => deliveryTargetStore.add({ type: 'email', target: 'not-an-email', events: ['*'] }),
    err => err.statusCode === 400
  );
});

test('add() throws 400 for bad webhook URL', () => {
  assert.throws(
    () => deliveryTargetStore.add({ type: 'webhook', target: 'ftp://bad.url', events: ['*'] }),
    err => err.statusCode === 400
  );
});

test('add() throws 400 for empty events array', () => {
  assert.throws(
    () => deliveryTargetStore.add({ type: 'email', target: 'x@y.com', events: [] }),
    err => err.statusCode === 400
  );
});

test('findAll() returns all targets', () => {
  // We already added 3 above; just ensure findAll works
  const targets = deliveryTargetStore.findAll();
  assert.ok(targets.length >= 3);
});

test('findAll() filters by type', () => {
  const webhooks = deliveryTargetStore.findAll({ type: 'webhook' });
  assert.ok(webhooks.every(t => t.type === 'webhook'));
  const emails = deliveryTargetStore.findAll({ type: 'email' });
  assert.ok(emails.every(t => t.type === 'email'));
});

test('findById() returns correct target', () => {
  const t = deliveryTargetStore.add({ type: 'webhook', target: 'https://find.me/hook', events: ['*'] });
  const found = deliveryTargetStore.findById(t.id);
  assert.strictEqual(found.id, t.id);
  assert.strictEqual(found.target, 'https://find.me/hook');
});

test('findById() returns undefined for missing id', () => {
  assert.strictEqual(deliveryTargetStore.findById('nonexistent-id'), undefined);
});

test('update() toggles active flag', () => {
  const t = deliveryTargetStore.add({ type: 'email', target: 'toggle@test.com', events: ['*'] });
  const updated = deliveryTargetStore.update(t.id, { active: false });
  assert.strictEqual(updated.active, false);
  const reactivated = deliveryTargetStore.update(t.id, { active: true });
  assert.strictEqual(reactivated.active, true);
});

test('update() changes events list', () => {
  const t = deliveryTargetStore.add({ type: 'email', target: 'events@test.com', events: ['*'] });
  const updated = deliveryTargetStore.update(t.id, { events: ['ESCALATION'] });
  assert.deepStrictEqual(updated.events, ['ESCALATION']);
});

test('update() returns null for missing id', () => {
  assert.strictEqual(deliveryTargetStore.update('bad-id', { active: false }), null);
});

test('remove() deletes a target', () => {
  const t = deliveryTargetStore.add({ type: 'webhook', target: 'https://del.me/hook', events: ['*'] });
  assert.strictEqual(deliveryTargetStore.remove(t.id), true);
  assert.strictEqual(deliveryTargetStore.findById(t.id), undefined);
});

test('remove() returns false for missing id', () => {
  assert.strictEqual(deliveryTargetStore.remove('ghost-id'), false);
});

test('findForEvent() returns wildcard targets for any event', () => {
  // Add a wildcard target
  const wc = deliveryTargetStore.add({ type: 'webhook', target: 'https://wc.example.com/hook', events: ['*'] });
  const matches = deliveryTargetStore.findForEvent('ESCALATION');
  assert.ok(matches.some(t => t.id === wc.id));
  deliveryTargetStore.remove(wc.id);
});

test('findForEvent() returns specific-event targets only for matching type', () => {
  const specific = deliveryTargetStore.add({ type: 'email', target: 'specific@test.com', events: ['NEW_COMPLAINT'] });
  const matchNew  = deliveryTargetStore.findForEvent('NEW_COMPLAINT');
  const matchEsc  = deliveryTargetStore.findForEvent('ESCALATION');
  assert.ok(matchNew.some(t => t.id === specific.id));
  assert.ok(!matchEsc.some(t => t.id === specific.id));
  deliveryTargetStore.remove(specific.id);
});

test('findForEvent() excludes inactive targets', () => {
  const t = deliveryTargetStore.add({ type: 'webhook', target: 'https://inactive.test/hook', events: ['*'] });
  deliveryTargetStore.update(t.id, { active: false });
  const matches = deliveryTargetStore.findForEvent('NEW_COMPLAINT');
  assert.ok(!matches.some(m => m.id === t.id));
  deliveryTargetStore.remove(t.id);
});

// ────────────────────────────────────────────────────────────
// 7. deliveryService dispatch tests (mock transport)
// ────────────────────────────────────────────────────────────

const deliveryService = require('./src/services/deliveryService');

// ── Mock nodemailer transport ──────────────────────────────────────────────
const deliveredEmails = [];
deliveryService._setTransporter({
  sendMail: async (opts) => {
    deliveredEmails.push(opts);
    return { messageId: 'mock-id' };
  },
});

// ── Tiny local HTTP echo server for webhook tests ──────────────────────────
const receivedWebhooks = [];
const echoServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try { receivedWebhooks.push(JSON.parse(body)); } catch { /* ignore */ }
    res.writeHead(200);
    res.end('ok');
  });
});

// Start the echo server on an available port
echoServer.listen(0); // port 0 = OS picks a free port
const ECHO_PORT = echoServer.address().port;

// Helper: run async test with a small delay for fire-and-forget dispatch to settle
function asyncTest(name, fn) {
  test(name, () => {
    // We use a sync wrapper — tests run after the event loop drains in _runAsync below
    asyncTests.push({ name, fn });
  });
}
const asyncTests = [];

async function _runAsync() {
  console.log('\n📤  deliveryService');

  // ── Webhook dispatch ───────────────────────────────────────────────────

  // Register a webhook pointing at our local echo server
  const whTarget = deliveryTargetStore.add({
    type: 'webhook',
    target: `http://localhost:${ECHO_PORT}`,
    events: ['*'],
    label: 'Test Echo Server',
  });

  const whNotif = {
    id: 'notif-wh-1', type: 'NEW_COMPLAINT', ticketId: 'TKT-WH-001',
    channel: 'EMAIL', priority: 'high', subject: 'Webhook test',
    detail: 'Dispatched to webhook', createdAt: new Date().toISOString(),
  };

  deliveryService.dispatch(whNotif);
  // Give the async HTTP call 300ms to complete
  await new Promise(r => setTimeout(r, 300));

  // Test: webhook received
  const whReceived = receivedWebhooks.some(p => p.ticketId === 'TKT-WH-001');
  if (whReceived) {
    console.log('  ✅  dispatch() sends webhook to registered target');
    passed++;
  } else {
    console.log('  ❌  dispatch() sends webhook to registered target');
    console.log('       → Webhook payload not received by echo server');
    failed++;
  }

  // Test: delivery recorded on notification object
  const whDelivered = Array.isArray(whNotif.deliveries) && whNotif.deliveries.length > 0;
  if (whDelivered) {
    console.log('  ✅  dispatch() records delivery attempt on notification.deliveries[]');
    passed++;
  } else {
    console.log('  ❌  dispatch() records delivery attempt on notification.deliveries[]');
    console.log('       → notification.deliveries[] is empty');
    failed++;
  }

  deliveryTargetStore.remove(whTarget.id);

  // ── Email dispatch ─────────────────────────────────────────────────────

  const emTarget = deliveryTargetStore.add({
    type: 'email',
    target: 'test@example.com',
    events: ['ESCALATION'],
    label: 'Test Email',
  });

  const emNotif = {
    id: 'notif-em-1', type: 'ESCALATION', ticketId: 'TKT-EM-001',
    channel: 'PHONE', priority: 'urgent', subject: 'Email dispatch test',
    detail: 'Escalated to urgent', createdAt: new Date().toISOString(),
  };

  deliveryService.dispatch(emNotif);
  await new Promise(r => setTimeout(r, 100));

  // Test: email sent
  const emSent = deliveredEmails.some(m => m.to === 'test@example.com');
  if (emSent) {
    console.log('  ✅  dispatch() sends email to registered target');
    passed++;
  } else {
    console.log('  ❌  dispatch() sends email to registered target');
    console.log('       → Email not found in mock transport');
    failed++;
  }

  // Test: event filter — NEW_COMPLAINT should NOT go to ESCALATION-only target
  const filteredNotif = {
    id: 'notif-em-2', type: 'NEW_COMPLAINT', ticketId: 'TKT-EM-002',
    channel: 'WEB', priority: 'low', subject: 'Should be filtered',
    detail: 'Should not reach ESCALATION-only target', createdAt: new Date().toISOString(),
  };
  deliveryService.dispatch(filteredNotif);
  await new Promise(r => setTimeout(r, 100));

  // Count emails delivered specifically to emTarget (ESCALATION-only)
  const countToTarget = deliveredEmails.filter(m => m.to === 'test@example.com').length;
  // Should still be 1 (only the ESCALATION one above)
  if (countToTarget === 1) {
    console.log('  ✅  dispatch() respects event filter (no delivery for non-matching type)');
    passed++;
  } else {
    console.log('  ❌  dispatch() respects event filter (no delivery for non-matching type)');
    console.log(`       → Expected 1 email to test@example.com (ESCALATION only), got ${countToTarget}`);
    failed++;
  }

  // Test: inactive target receives no delivery
  deliveryTargetStore.update(emTarget.id, { active: false });
  const inactiveBefore = deliveredEmails.filter(m => m.to === 'test@example.com').length;
  deliveryService.dispatch({ ...emNotif, id: 'notif-em-3' });
  await new Promise(r => setTimeout(r, 100));
  const inactiveAfter = deliveredEmails.filter(m => m.to === 'test@example.com').length;
  if (inactiveAfter === inactiveBefore) {
    console.log('  ✅  dispatch() skips inactive targets');
    passed++;
  } else {
    console.log('  ❌  dispatch() skips inactive targets');
    console.log('       → Delivery was sent despite target being inactive');
    failed++;
  }

  deliveryTargetStore.remove(emTarget.id);

  // Shut down the echo server
  echoServer.close();
}

// ── Results ──────────────────────────────────────────────────
// Run sync tests first, then async delivery tests, then print results
_runAsync().then(() => {
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(52)}\n`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error('Async test runner error:', err);
  process.exit(1);
});
