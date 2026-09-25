const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');

router.get('/', walletController.getAllWallets);
router.get('/:customerId', walletController.getWallet);
router.post('/issue-reward', walletController.issueDirectReward);

module.exports = router;
