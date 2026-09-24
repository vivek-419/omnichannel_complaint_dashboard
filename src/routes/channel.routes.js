const express = require('express');
const router = express.Router();
const channelController = require('../controllers/channel.controller');

router.get('/status', channelController.getStatus);
router.post('/config', channelController.updateConfig);

module.exports = router;
