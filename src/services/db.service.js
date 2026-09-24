const { query, isPostgresConnected } = require('../config/database.config');

/**
 * PostgreSQL Database Repository Service
 * Provides SQL persistence layer for CCMRS Enterprise System
 */

// ==========================================
// 1. TICKET OPERATIONS
// ==========================================

async function dbSaveTicket(ticket) {
  if (!isPostgresConnected() || !ticket) return null;
  try {
    const res = await query(`
      INSERT INTO tickets (
        ticket_id, channel, channel_message_id, sender, sender_id, chat_id, channel_id,
        subject, message, category, priority, sentiment, status, assigned_agent_id,
        assigned_agent_name, sla_deadline, is_escalated, agent_reply, created_at, resolved_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (ticket_id) DO UPDATE SET
        subject = EXCLUDED.subject,
        message = EXCLUDED.message,
        category = EXCLUDED.category,
        priority = EXCLUDED.priority,
        sentiment = EXCLUDED.sentiment,
        status = EXCLUDED.status,
        assigned_agent_id = EXCLUDED.assigned_agent_id,
        assigned_agent_name = EXCLUDED.assigned_agent_name,
        is_escalated = EXCLUDED.is_escalated,
        agent_reply = EXCLUDED.agent_reply,
        resolved_at = EXCLUDED.resolved_at
      RETURNING *;
    `, [
      ticket.ticketId,
      (ticket.channel || 'web').toLowerCase(),
      ticket.channelMessageId || null,
      ticket.sender || 'Unknown',
      ticket.senderId || null,
      ticket.chatId || null,
      ticket.channelId || null,
      ticket.subject || 'Support Ticket',
      ticket.message || '',
      ticket.category || 'General Inquiry',
      ticket.priority || 'Medium',
      ticket.sentiment || 'Neutral',
      ticket.status || 'New',
      ticket.assignedAgentId || null,
      ticket.assignedAgentName || null,
      ticket.slaDeadline ? new Date(ticket.slaDeadline) : new Date(Date.now() + 60 * 60 * 1000),
      !!ticket.isEscalated,
      ticket.agentReply || null,
      ticket.timestamp ? new Date(ticket.timestamp) : new Date(),
      ticket.resolvedAt ? new Date(ticket.resolvedAt) : null
    ]);
    return res.rows[0];
  } catch (err) {
    console.error(`[DB Service] Error saving ticket ${ticket.ticketId}:`, err.message);
    return null;
  }
}

async function dbAddTicketMessage(ticketId, message) {
  if (!isPostgresConnected() || !ticketId || !message) return null;
  try {
    const res = await query(`
      INSERT INTO ticket_messages (message_id, ticket_id, sender_type, sender_name, text, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (message_id) DO NOTHING
      RETURNING *;
    `, [
      message.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ticketId,
      message.senderType || 'customer',
      message.senderName || 'Sender',
      message.text || '',
      message.timestamp ? new Date(message.timestamp) : new Date()
    ]);
    return res.rows[0];
  } catch (err) {
    console.error(`[DB Service] Error adding message to ticket ${ticketId}:`, err.message);
    return null;
  }
}

async function dbFetchAllTickets() {
  if (!isPostgresConnected()) return null;
  try {
    const res = await query(`
      SELECT 
        t.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', m.message_id,
              'senderType', m.sender_type,
              'senderName', m.sender_name,
              'text', m.text,
              'timestamp', m.timestamp
            ) ORDER BY m.timestamp ASC
          ) FILTER (WHERE m.message_id IS NOT NULL),
          '[]'
        ) AS messages
      FROM tickets t
      LEFT JOIN ticket_messages m ON t.ticket_id = m.ticket_id
      GROUP BY t.ticket_id
      ORDER BY t.created_at DESC;
    `);

    // Normalize rows to camelCase to match frontend/API expectations
    return res.rows.map(r => ({
      ticketId: r.ticket_id,
      channel: r.channel,
      channelMessageId: r.channel_message_id,
      sender: r.sender,
      senderId: r.sender_id,
      chatId: r.chat_id,
      channelId: r.channel_id,
      subject: r.subject,
      message: r.message,
      category: r.category,
      priority: r.priority,
      sentiment: r.sentiment,
      status: r.status,
      assignedAgentId: r.assigned_agent_id,
      assignedAgentName: r.assigned_agent_name,
      slaDeadline: r.sla_deadline,
      isEscalated: r.is_escalated,
      agentReply: r.agent_reply,
      timestamp: r.created_at,
      resolvedAt: r.resolved_at,
      messages: r.messages || []
    }));
  } catch (err) {
    console.error('[DB Service] Error fetching all tickets:', err.message);
    return null;
  }
}

// ==========================================
// 2. USER & RBAC OPERATIONS
// ==========================================

async function dbFetchAllUsers() {
  if (!isPostgresConnected()) return null;
  try {
    const res = await query(`SELECT * FROM users WHERE is_active = TRUE ORDER BY created_at ASC;`);
    return res.rows.map(u => ({
      id: u.user_id,
      email: u.email,
      name: u.name,
      passwordHash: u.password_hash,
      role: u.role,
      mfaEnabled: u.totp_enabled,
      mfaSecret: u.totp_secret,
      createdAt: u.created_at
    }));
  } catch (err) {
    console.error('[DB Service] Error fetching users:', err.message);
    return null;
  }
}

async function dbSaveUser(user) {
  if (!isPostgresConnected() || !user) return null;
  try {
    const res = await query(`
      INSERT INTO users (user_id, email, password_hash, name, role, totp_secret, totp_enabled, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        password_hash = EXCLUDED.password_hash,
        totp_secret = EXCLUDED.totp_secret,
        totp_enabled = EXCLUDED.totp_enabled
      RETURNING *;
    `, [
      user.id || user.user_id,
      user.email,
      user.passwordHash || user.password_hash,
      user.name,
      user.role,
      user.mfaSecret || null,
      !!user.mfaEnabled,
      true
    ]);
    return res.rows[0];
  } catch (err) {
    console.error(`[DB Service] Error saving user ${user.email}:`, err.message);
    return null;
  }
}

// ==========================================
// 3. WALLET & LOYALTY OPERATIONS
// ==========================================

async function dbSaveWallet(wallet) {
  if (!isPostgresConnected() || !wallet) return null;
  try {
    await query(`
      INSERT INTO customer_wallets (customer_id, customer_name, points_balance, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (customer_id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        points_balance = EXCLUDED.points_balance,
        updated_at = CURRENT_TIMESTAMP;
    `, [
      wallet.customerId,
      wallet.customerName || 'Valued Customer',
      wallet.pointsBalance || 0
    ]);
  } catch (err) {
    console.error(`[DB Service] Error saving wallet ${wallet.customerId}:`, err.message);
  }
}

async function dbSaveVoucher(voucher, customerId) {
  if (!isPostgresConnected() || !voucher || !customerId) return null;
  try {
    await query(`
      INSERT INTO vouchers (voucher_id, customer_id, code, points, discount, reason, ticket_id, status, issued_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (code) DO NOTHING;
    `, [
      voucher.voucherId || `vch_${Math.random().toString(36).substring(2, 8)}`,
      customerId,
      voucher.code,
      voucher.points || 0,
      voucher.discount || '10%',
      voucher.reason || 'Service Apology',
      voucher.ticketId || null,
      voucher.status || 'ACTIVE',
      voucher.issuedAt ? new Date(voucher.issuedAt) : new Date(),
      voucher.expiresAt ? new Date(voucher.expiresAt) : new Date(Date.now() + 30 * 86400000)
    ]);
  } catch (err) {
    console.error(`[DB Service] Error saving voucher ${voucher.code}:`, err.message);
  }
}

// ==========================================
// 4. NOTIFICATION OPERATIONS
// ==========================================

async function dbSaveNotification(notif) {
  if (!isPostgresConnected() || !notif) return null;
  try {
    await query(`
      INSERT INTO notifications (notification_id, type, ticket_id, title, message, priority, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (notification_id) DO NOTHING;
    `, [
      notif.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      notif.type || 'NEW_COMPLAINT',
      notif.ticketId || null,
      notif.title || 'System Notification',
      notif.message || '',
      notif.priority || 'Medium',
      !!notif.isRead,
      notif.timestamp ? new Date(notif.timestamp) : new Date()
    ]);
  } catch (err) {
    // Non-critical, ignore foreign key error if ticket isn't saved yet
  }
}

module.exports = {
  dbSaveTicket,
  dbAddTicketMessage,
  dbFetchAllTickets,
  dbFetchAllUsers,
  dbSaveUser,
  dbSaveWallet,
  dbSaveVoucher,
  dbSaveNotification
};
