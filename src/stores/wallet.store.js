const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDataPath } = require('../config/paths.config');
const { dbSaveWallet, dbSaveVoucher } = require('../services/db.service');

const WALLETS_FILE = getDataPath('wallets.json');

// In-memory store
let wallets = {};

// Load saved wallets from disk
function loadWallets() {
  try {
    if (fs.existsSync(WALLETS_FILE)) {
      const data = fs.readFileSync(WALLETS_FILE, 'utf8');
      wallets = JSON.parse(data);
      console.log(`[WalletStore] Loaded ${Object.keys(wallets).length} customer wallet(s) (in-memory + JSON backup)`);
    } else {
      wallets = {};
    }
  } catch (err) {
    console.error('[WalletStore] Error loading wallets.json:', err.message);
    wallets = {};
  }
}

// Save wallets to disk & sync to PostgreSQL
function saveWallets() {
  try {
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2), 'utf8');
    for (const w of Object.values(wallets)) {
      dbSaveWallet(w).catch(() => {});
      if (Array.isArray(w.vouchers)) {
        for (const v of w.vouchers) {
          dbSaveVoucher(v, w.customerId).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('[WalletStore] Error saving wallets:', err.message);
  }
}

// Helper to normalize customer ID across channels
function normalizeCustomerId(ticket) {
  if (!ticket) return 'cust_unknown';
  if (ticket.channel === 'telegram' && ticket.chatId) {
    return `tg_${ticket.chatId}`;
  }
  if (ticket.channel === 'discord' && (ticket.channelId || ticket.senderId)) {
    return `dc_${ticket.senderId || ticket.channelId}`;
  }
  if (ticket.channel === 'gmail') {
    const emailMatch = ticket.sender.match(/<([^>]+)>/) || [null, ticket.sender];
    return `gm_${(emailMatch[1] || ticket.sender).toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }
  return `cust_${(ticket.sender || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

// Get or auto-create a customer wallet
function getWallet(customerId, customerName = 'Valued Customer') {
  if (!wallets[customerId]) {
    wallets[customerId] = {
      customerId: customerId,
      customerName: customerName,
      pointsBalance: 0,
      vouchers: [],
      transactions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveWallets();
  }
  return wallets[customerId];
}

// Issue loyalty points and discount voucher to a customer
function issueReward(customerId, customerName, { points = 50, discount = '10%', reason = 'Service Apology', ticketId = null }) {
  const wallet = getWallet(customerId, customerName);

  // Check for duplicate reward on the same ticket
  if (ticketId && wallet.vouchers.some(v => v.ticketId === ticketId)) {
    throw new Error(`A loyalty compensation voucher has already been issued for ticket ${ticketId}.`);
  }

  const voucherCode = `CCMRS-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${points > 0 ? points + 'PTS' : '10PCT'}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days expiry

  const voucher = {
    voucherId: `vch_${uuidv4().substring(0, 8)}`,
    code: voucherCode,
    points: points,
    discount: discount,
    reason: reason,
    ticketId: ticketId,
    status: 'ACTIVE',
    issuedAt: now,
    expiresAt: expiresAt
  };

  // Update wallet points
  wallet.pointsBalance += points;
  wallet.vouchers.unshift(voucher);
  wallet.updatedAt = now;

  wallet.transactions.unshift({
    id: `tx_${uuidv4().substring(0, 8)}`,
    type: 'CREDIT',
    points: points,
    voucherCode: voucherCode,
    description: `${reason} (Ticket ${ticketId || 'N/A'})`,
    timestamp: now
  });

  saveWallets();
  console.log(`[WalletStore] 🎁 Issued ${points} pts & Voucher [${voucherCode}] to ${customerName} (${customerId})`);

  return {
    success: true,
    wallet,
    voucher,
    pointsAdded: points
  };
}

// Get all customer wallets
function getAllWallets() {
  return Object.values(wallets);
}

// Get high-level summary metrics for Delivery Head Dashboard
function getWalletSummary() {
  const all = Object.values(wallets);
  const totalWallets = all.length;
  let totalPointsIssued = 0;
  let totalVouchersActive = 0;

  for (const w of all) {
    totalPointsIssued += w.pointsBalance;
    totalVouchersActive += (w.vouchers || []).filter(v => v.status === 'ACTIVE').length;
  }

  return {
    totalWallets,
    totalPointsIssued,
    totalVouchersActive,
    recentRewards: all.flatMap(w => w.vouchers || []).sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt)).slice(0, 10)
  };
}

// Initialize on require
loadWallets();

module.exports = {
  getWallet,
  normalizeCustomerId,
  issueReward,
  getAllWallets,
  getWalletSummary
};
