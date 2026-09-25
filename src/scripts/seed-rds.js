const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const RDS_URL = 'postgresql://postgres:ResolvIQ2026Secure!@resolviq-db.c7c6y6kq8tsy.ap-south-1.rds.amazonaws.com:5432/resolviq';

async function seedData() {
  const pool = new Pool({
    connectionString: RDS_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('1. Connecting to AWS RDS...');
  const client = await pool.connect();
  console.log('Connected!');

  // Apply schema
  const schemaPath = path.resolve(__dirname, '../../schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    console.log('Schema verified.');
  }

  // 1. Seed Tickets & Messages FIRST (so foreign keys resolve)
  const ticketsPath = path.resolve(__dirname, '../../tickets.json');
  if (fs.existsSync(ticketsPath)) {
    const rawTickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));
    const ticketList = Array.isArray(rawTickets) ? rawTickets : Object.values(rawTickets);
    let count = 0;
    for (const t of ticketList) {
      if (!t.ticketId) continue;
      const channel = (t.channel || 'web').toLowerCase();
      const validChannels = ['gmail', 'telegram', 'discord', 'web'];
      const finalChannel = validChannels.includes(channel) ? channel : 'web';

      const priority = t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1).toLowerCase() : 'Medium';
      const validPriorities = ['Critical', 'High', 'Medium', 'Low'];
      const finalPriority = validPriorities.includes(priority) ? priority : 'Medium';

      const sentiment = t.sentiment ? t.sentiment.charAt(0).toUpperCase() + t.sentiment.slice(1).toLowerCase() : 'Neutral';
      const validSentiments = ['Positive', 'Neutral', 'Negative'];
      const finalSentiment = validSentiments.includes(sentiment) ? sentiment : 'Neutral';

      const statusMap = { 'open': 'New', 'new': 'New', 'in progress': 'In Progress', 'in_progress': 'In Progress', 'resolved': 'Resolved', 'escalated': 'Escalated' };
      const rawStatus = (t.status || 'New').toLowerCase();
      const finalStatus = statusMap[rawStatus] || 'New';

      const subject = t.subject || 'Complaint Report';
      const message = t.message || (t.messages && t.messages[0] ? t.messages[0].text : '') || subject;
      const slaDeadline = t.slaDeadline ? new Date(t.slaDeadline) : new Date(Date.now() + 4 * 3600000);

      await pool.query(
        'INSERT INTO tickets (ticket_id, channel, channel_message_id, sender, sender_id, chat_id, channel_id, subject, message, category, priority, sentiment, status, assigned_agent_id, assigned_agent_name, sla_deadline, is_escalated, agent_reply, created_at, resolved_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) ON CONFLICT (ticket_id) DO NOTHING',
        [
          t.ticketId, finalChannel, t.channelMessageId || null, t.sender || 'Customer', t.senderId || null,
          t.chatId ? String(t.chatId) : null, t.channelId || null, subject, message,
          t.category || 'General Inquiry', finalPriority, finalSentiment, finalStatus,
          t.assignedAgentId || null, t.assignedAgentName || null, slaDeadline,
          Boolean(t.isEscalated), t.agentReply || t.draftReply || null,
          t.createdAt ? new Date(t.createdAt) : new Date(), t.resolvedAt ? new Date(t.resolvedAt) : null
        ]
      );
      count++;

      if (t.messages && Array.isArray(t.messages)) {
        let msgIndex = 0;
        for (const m of t.messages) {
          msgIndex++;
          const senderType = (m.senderType || (m.sender === 'agent' ? 'agent' : 'customer')).toLowerCase();
          const finalSenderType = ['customer', 'agent', 'system'].includes(senderType) ? senderType : 'customer';
          const msgId = m.id || m.messageId || (t.ticketId + '-msg-' + msgIndex);
          await pool.query(
            'INSERT INTO ticket_messages (message_id, ticket_id, sender_type, sender_name, text, timestamp) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (message_id) DO NOTHING',
            [msgId, t.ticketId, finalSenderType, m.sender || 'Customer', m.text || '', m.timestamp ? new Date(m.timestamp) : new Date()]
          );
        }
      }
    }
    console.log('Tickets & Messages seeded:', count);
  }

  // 2. Wallets & Vouchers
  const walletsPath = path.resolve(__dirname, '../../wallets.json');
  if (fs.existsSync(walletsPath)) {
    const rawWallets = JSON.parse(fs.readFileSync(walletsPath, 'utf8'));
    const walletList = Array.isArray(rawWallets) ? rawWallets : Object.values(rawWallets);
    for (const w of walletList) {
      if (!w.customerId) continue;
      await pool.query(
        'INSERT INTO customer_wallets (customer_id, customer_name, points_balance) VALUES ($1, $2, $3) ON CONFLICT (customer_id) DO UPDATE SET points_balance = $3',
        [w.customerId, w.customerName || 'Customer', w.pointsBalance || 0]
      );

      if (w.vouchers && Array.isArray(w.vouchers)) {
        for (const v of w.vouchers) {
          await pool.query(
            'INSERT INTO vouchers (voucher_id, customer_id, code, points, discount, reason, ticket_id, status, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (code) DO NOTHING',
            [
              v.voucherId, w.customerId, v.code, v.points || 0, v.discount || '10%',
              v.reason || 'Service Apology', v.ticketId || null, v.status || 'ACTIVE',
              v.issuedAt ? new Date(v.issuedAt) : new Date(), v.expiresAt ? new Date(v.expiresAt) : new Date(Date.now() + 30 * 86400000)
            ]
          );
        }
      }
    }
    console.log('Wallets & Vouchers seeded:', walletList.length);
  }

  const res = await pool.query('SELECT (SELECT count(*) FROM tickets) as tickets, (SELECT count(*) FROM users) as users, (SELECT count(*) FROM customer_wallets) as wallets, (SELECT count(*) FROM vouchers) as vouchers, (SELECT count(*) FROM ticket_messages) as messages;');
  console.log('AWS RDS Live Row Counts:', res.rows[0]);

  client.release();
  await pool.end();
  console.log('Migration to AWS RDS finished successfully!');
}

seedData().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
