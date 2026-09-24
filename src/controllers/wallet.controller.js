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

module.exports = {
  getWallet,
  getAllWallets
};
