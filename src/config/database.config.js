const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { getDataPath, ROOT_DIR } = require('./paths.config');

// Load .env variables
require('dotenv').config({ path: path.resolve(ROOT_DIR, '.env') });

const connectionString = process.env.DATABASE_URL || 
  `postgresql://${process.env.PGUSER || 'postgres'}:${process.env.PGPASSWORD || ''}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'ccmrs_db'}`;

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

let isConnected = false;
let lastDbError = null;

// Pool error handling
pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected pool error on idle client:', err.message);
  isConnected = false;
  lastDbError = err.message;
});

// Helper for executing parameterized queries
async function query(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.DEBUG_SQL === 'true') {
      console.log(`[PostgreSQL Query] (${duration}ms):`, text.substring(0, 100));
    }
    return res;
  } catch (err) {
    console.error(`[PostgreSQL Query Error]: ${err.message} | SQL: ${text.substring(0, 150)}`);
    throw err;
  }
}

// Check database connection and initialize tables
async function initDatabase() {
  try {
    const client = await pool.connect();
    isConnected = true;
    lastDbError = null;
    console.log(`[PostgreSQL] Connected successfully to database: ${process.env.PGDATABASE || 'ccmrs_db'}`);
    client.release();

    // Execute schema.sql if tables are not yet created
    try {
      const schemaPath = path.resolve(ROOT_DIR, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schemaSql);
        console.log('[PostgreSQL] Database schema verified & applied.');
      }
    } catch (schemaErr) {
      console.log(`[PostgreSQL] Schema verification note: ${schemaErr.message}`);
    }

    // Auto-seed data from JSON stores into PostgreSQL if tables are empty
    try {
      await seedDatabaseFromJSON();
    } catch (seedErr) {
      console.log(`[PostgreSQL] Seed verification note: ${seedErr.message}`);
    }

    return { connected: true, database: process.env.PGDATABASE || 'ccmrs_db' };
  } catch (err) {
    isConnected = false;
    lastDbError = err.message;
    console.warn(`[PostgreSQL] Connection note: ${err.message}. System will continue with fallback sync.`);
    return { connected: false, error: err.message };
  }
}

// Seed existing data from JSON stores into PostgreSQL
async function seedDatabaseFromJSON() {
  if (!isConnected) return;

  try {
    // 1. Seed Users
    const usersFile = getDataPath('users.json');
    if (fs.existsSync(usersFile)) {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      for (const u of users) {
        await pool.query(`
          INSERT INTO users (user_id, email, password_hash, name, role, totp_enabled, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (user_id) DO UPDATE SET
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            role = EXCLUDED.role,
            password_hash = EXCLUDED.password_hash;
        `, [
          u.id || u.user_id,
          u.email,
          u.passwordHash || u.password_hash || '$2b$10$w0uR/xKqZl7r7rFeq04uNuQO4.eW9L5mH9FvG8f.8oO12g4O9Yhfe',
          u.name,
          u.role,
          !!(u.mfaEnabled || u.totp_enabled),
          true,
          u.createdAt || new Date()
        ]).catch(e => {
          // If email conflict occurs on different user_id, update by email
          return pool.query(`
            UPDATE users SET name = $1, role = $2, password_hash = $3 WHERE email = $4;
          `, [u.name, u.role, u.passwordHash || u.password_hash, u.email]);
        });
      }
      console.log(`[PostgreSQL] Synced ${users.length} users into 'users' table.`);
    }

    // 2. Seed Tickets & Messages
    const ticketsFile = getDataPath('tickets.json');
    if (fs.existsSync(ticketsFile)) {
      const tickets = JSON.parse(fs.readFileSync(ticketsFile, 'utf8'));
      let ticketCount = 0;
      for (const t of tickets) {
        await pool.query(`
          INSERT INTO tickets (
            ticket_id, channel, channel_message_id, sender, sender_id, chat_id, channel_id,
            subject, message, category, priority, sentiment, status, assigned_agent_id,
            assigned_agent_name, sla_deadline, is_escalated, agent_reply, created_at, resolved_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
          ON CONFLICT (ticket_id) DO UPDATE SET
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            assigned_agent_id = EXCLUDED.assigned_agent_id,
            assigned_agent_name = EXCLUDED.assigned_agent_name,
            is_escalated = EXCLUDED.is_escalated,
            agent_reply = EXCLUDED.agent_reply,
            resolved_at = EXCLUDED.resolved_at;
        `, [
          t.ticketId,
          (t.channel || 'web').toLowerCase(),
          t.channelMessageId || null,
          t.sender || 'Unknown',
          t.senderId || null,
          t.chatId || null,
          t.channelId || null,
          t.subject || 'Support Ticket',
          t.message || '',
          t.category || 'General Inquiry',
          t.priority || 'Medium',
          t.sentiment || 'Neutral',
          t.status || 'New',
          t.assignedAgentId || null,
          t.assignedAgentName || null,
          t.slaDeadline ? new Date(t.slaDeadline) : new Date(Date.now() + 60 * 60 * 1000),
          !!t.isEscalated,
          t.agentReply || null,
          t.timestamp ? new Date(t.timestamp) : new Date(),
          t.resolvedAt ? new Date(t.resolvedAt) : null
        ]);
        ticketCount++;

        // Sync messages for this ticket
        if (Array.isArray(t.messages)) {
          for (const m of t.messages) {
            await pool.query(`
              INSERT INTO ticket_messages (message_id, ticket_id, sender_type, sender_name, text, timestamp)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (message_id) DO NOTHING;
            `, [
              m.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              t.ticketId,
              m.senderType || 'customer',
              m.senderName || 'Sender',
              m.text || '',
              m.timestamp ? new Date(m.timestamp) : new Date()
            ]);
          }
        }
      }
      console.log(`[PostgreSQL] Synced ${ticketCount} tickets into 'tickets' table.`);
    }

    // 3. Seed Wallets & Vouchers
    const walletsFile = getDataPath('wallets.json');
    if (fs.existsSync(walletsFile)) {
      const wallets = JSON.parse(fs.readFileSync(walletsFile, 'utf8'));
      const walletList = Object.values(wallets);
      for (const w of walletList) {
        await pool.query(`
          INSERT INTO customer_wallets (customer_id, customer_name, points_balance, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (customer_id) DO UPDATE SET
            points_balance = EXCLUDED.points_balance,
            updated_at = EXCLUDED.updated_at;
        `, [
          w.customerId,
          w.customerName || 'Valued Customer',
          w.pointsBalance || 0,
          w.createdAt ? new Date(w.createdAt) : new Date(),
          w.updatedAt ? new Date(w.updatedAt) : new Date()
        ]);

        if (Array.isArray(w.vouchers)) {
          for (const v of w.vouchers) {
            await pool.query(`
              INSERT INTO vouchers (voucher_id, customer_id, code, points, discount, reason, ticket_id, status, issued_at, expires_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (code) DO NOTHING;
            `, [
              v.voucherId || `vch_${Math.random().toString(36).substring(2, 8)}`,
              w.customerId,
              v.code,
              v.points || 0,
              v.discount || '10%',
              v.reason || 'Service Apology',
              v.ticketId || null,
              v.status || 'ACTIVE',
              v.issuedAt ? new Date(v.issuedAt) : new Date(),
              v.expiresAt ? new Date(v.expiresAt) : new Date(Date.now() + 30 * 86400000)
            ]);
          }
        }
      }
      console.log(`[PostgreSQL] Synced ${walletList.length} customer wallets into 'customer_wallets' table.`);
    }
  } catch (err) {
    console.error('[PostgreSQL] Seed migration error:', err.message);
  }
}

// Get comprehensive status of PostgreSQL for Admin Dashboard & API
async function getDbStatus() {
  if (!isConnected) {
    return {
      connected: false,
      type: 'PostgreSQL',
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      database: process.env.PGDATABASE || 'ccmrs_db',
      error: lastDbError || 'Not connected'
    };
  }

  try {
    const tableStats = await pool.query(`
      SELECT 
        relname AS table_name,
        n_live_tup AS row_count
      FROM pg_stat_user_tables
      ORDER BY relname;
    `);

    const dbVersion = await pool.query('SELECT version();');

    return {
      connected: true,
      type: 'PostgreSQL (AWS RDS Ready)',
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      database: process.env.PGDATABASE || 'ccmrs_db',
      user: process.env.PGUSER || 'postgres',
      version: dbVersion.rows[0]?.version?.split(' ')[0] + ' ' + dbVersion.rows[0]?.version?.split(' ')[1],
      tables: tableStats.rows,
      lastChecked: new Date().toISOString()
    };
  } catch (err) {
    return {
      connected: isConnected,
      type: 'PostgreSQL',
      error: err.message
    };
  }
}

module.exports = {
  pool,
  query,
  initDatabase,
  getDbStatus,
  isPostgresConnected: () => isConnected
};
