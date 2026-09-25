const walletStore = require('../stores/wallet.store');

// GET /api/wallets/:customerId
function getWallet(req, res) {
  const { customerId } = req.params;
  const wallet = walletStore.getWallet(customerId);
  res.json({ success: true, wallet });
}

// GET /api/wallets
function getAllWallets(req, res) {
  const wallets = walletStore.getAllWallets();
  res.json({ success: true, total: wallets.length, wallets });
}

// POST /api/wallets/issue-reward
function issueDirectReward(req, res) {
  try {
    const { customerId, customerName, points, discount, reason, ticketId } = req.body;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'customerId is required' });
    }
    const result = walletStore.issueReward(customerId, customerName || 'Valued Customer', {
      points: parseInt(points) || 50,
      discount: discount || '15%',
      reason: reason || 'Service Apology Compensation',
      ticketId: ticketId || null
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getWallet,
  getAllWallets,
  issueDirectReward
};
