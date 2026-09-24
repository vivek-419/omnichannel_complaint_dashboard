const notificationService = require('../services/notification.service');

// GET /api/notifications
function getNotifications(req, res) {
  const { type, unreadOnly } = req.query;
  const result = notificationService.getNotifications({ type, unreadOnly });
  res.json({ success: true, ...result });
}

// PATCH /api/notifications/:id/read
function markNotificationRead(req, res) {
  const item = notificationService.markNotificationRead(req.params.id);
  res.json({ success: true, notification: item });
}

// POST /api/notifications/read-all
function markAllNotificationsRead(req, res) {
  const result = notificationService.markAllNotificationsRead();
  res.json({ success: true, ...result });
}

module.exports = {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead
};
