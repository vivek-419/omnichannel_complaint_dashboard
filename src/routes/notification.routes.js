const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');

router.get('/', notificationController.getNotifications);
router.patch('/:id/read', notificationController.markNotificationRead);
router.post('/read-all', notificationController.markAllNotificationsRead);

module.exports = router;
