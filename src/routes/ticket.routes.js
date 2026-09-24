const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { optionalAuth } = require('../middlewares/auth.middleware');

// Ticket CRUD & Actions
router.get('/', ticketController.getTickets);
router.get('/:id', ticketController.getTicketById);
router.post('/:id/reply', optionalAuth, ticketController.replyTicket);
router.post('/:id/classify', optionalAuth, ticketController.classifyTicket);
router.post('/:id/reassign', optionalAuth, ticketController.reassignTicket);
router.patch('/:id/status', ticketController.updateStatus);
router.delete('/:id', ticketController.deleteTicket);
router.post('/:id/issue-reward', ticketController.issueReward);

module.exports = router;
