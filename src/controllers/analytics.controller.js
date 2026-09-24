const ticketStore = require('../stores/ticket.store');
const walletStore = require('../stores/wallet.store');

// GET /api/analytics/dashboard
function getDashboard(req, res) {
  const summary = ticketStore.getAnalyticsSummary();
  const walletSummary = walletStore.getWalletSummary();
  res.json({
    success: true,
    data: {
      ...summary,
      walletSummary
    }
  });
}

module.exports = {
  getDashboard
};
