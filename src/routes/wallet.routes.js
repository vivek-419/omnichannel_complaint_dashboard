const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');

router.get('/', walletController.getAllWallets);
router.get('/:customerId', walletController.getWallet);

module.exports = router;
