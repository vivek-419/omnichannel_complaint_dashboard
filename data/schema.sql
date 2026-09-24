-- ==============================================================================
-- CCMRS Enterprise Database Schema (AWS RDS PostgreSQL)
-- Omnichannel Customer Complaint Management & Resolution System
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. USERS & RBAC AUTHENTICATION TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('agent', 'Delivery Head', 'admin')),
    totp_secret VARCHAR(255),
    totp_enabled BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed Default Demo Accounts
INSERT INTO users (user_id, email, password_hash, name, role, totp_enabled)
VALUES 
('usr-agent-1', 'agent@ccmrs.com', '$2b$10$w0uR/xKqZl7r7rFeq04uNuQO4.eW9L5mH9FvG8f.8oO12g4O9Yhfe', 'Rahul Sharma', 'agent', FALSE),
('usr-agent-2', 'agent2@ccmrs.com', '$2b$10$w0uR/xKqZl7r7rFeq04uNuQO4.eW9L5mH9FvG8f.8oO12g4O9Yhfe', 'Priya Patel', 'agent', FALSE),
('usr-head-1', 'head@ccmrs.com', '$2b$10$w0uR/xKqZl7r7rFeq04uNuQO4.eW9L5mH9FvG8f.8oO12g4O9Yhfe', 'Vivek Addagatla', 'Delivery Head', FALSE),
('usr-admin-1', 'admin@ccmrs.com', '$2b$10$w0uR/xKqZl7r7rFeq04uNuQO4.eW9L5mH9FvG8f.8oO12g4O9Yhfe', 'Platform Admin', 'admin', FALSE)
ON CONFLICT (email) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. UNIFIED OMNICHANNEL TICKETS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id VARCHAR(32) PRIMARY KEY,
    channel VARCHAR(32) NOT NULL CHECK (channel IN ('gmail', 'telegram', 'discord', 'web')),
    channel_message_id VARCHAR(255),
    sender VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255),
    chat_id VARCHAR(255),
    channel_id VARCHAR(255),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(64) DEFAULT 'General Inquiry',
    priority VARCHAR(32) DEFAULT 'Medium' CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
    sentiment VARCHAR(32) DEFAULT 'Neutral' CHECK (sentiment IN ('Positive', 'Neutral', 'Negative')),
    status VARCHAR(32) DEFAULT 'New' CHECK (status IN ('New', 'In Progress', 'Resolved', 'Escalated')),
    assigned_agent_id VARCHAR(64) REFERENCES users(user_id) ON DELETE SET NULL,
    assigned_agent_name VARCHAR(255),
    sla_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    is_escalated BOOLEAN DEFAULT FALSE,
    agent_reply TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_sla_deadline ON tickets(sla_deadline);
CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(assigned_agent_id);

-- ------------------------------------------------------------------------------
-- 3. CONVERSATION MESSAGES & AUDIT TRAIL TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
    message_id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(32) NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
    sender_type VARCHAR(32) NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system')),
    sender_name VARCHAR(255) NOT NULL,
    text TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id);

-- ------------------------------------------------------------------------------
-- 4. CUSTOMER DIGITAL WALLETS TABLE (SRS 3.2.7)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_wallets (
    customer_id VARCHAR(255) PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    points_balance INT DEFAULT 0 CHECK (points_balance >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 5. LOYALTY COMPENSATION VOUCHERS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vouchers (
    voucher_id VARCHAR(64) PRIMARY KEY,
    customer_id VARCHAR(255) NOT NULL REFERENCES customer_wallets(customer_id) ON DELETE CASCADE,
    code VARCHAR(64) UNIQUE NOT NULL,
    points INT DEFAULT 0,
    discount VARCHAR(32) DEFAULT '10%',
    reason TEXT DEFAULT 'Service Apology',
    ticket_id VARCHAR(32) REFERENCES tickets(ticket_id) ON DELETE SET NULL,
    status VARCHAR(32) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REDEEMED', 'EXPIRED')),
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vouchers_customer ON vouchers(customer_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);

-- ------------------------------------------------------------------------------
-- 6. WALLET LEDGER TRANSACTIONS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY,
    customer_id VARCHAR(255) NOT NULL REFERENCES customer_wallets(customer_id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
    points INT NOT NULL,
    voucher_code VARCHAR(64),
    description TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_customer ON wallet_transactions(customer_id);

-- ------------------------------------------------------------------------------
-- 7. SLA NOTIFICATIONS & ESCALATIONS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    notification_id VARCHAR(64) PRIMARY KEY,
    type VARCHAR(64) NOT NULL CHECK (type IN ('DEADLINE_APPROACHING', 'ESCALATION', 'NEW_COMPLAINT', 'REASSIGNED', 'CLASSIFICATION_UPDATED')),
    ticket_id VARCHAR(32) REFERENCES tickets(ticket_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(32) DEFAULT 'Medium',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_ticket ON notifications(ticket_id);
