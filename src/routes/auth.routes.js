const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/agents', authController.getAgents);
router.get('/users', authController.getAllUsers);
router.get('/me', authenticate, authController.getMe);
router.post('/mfa/setup', authController.setupMFA);
router.post('/mfa/verify', authController.verifyMFA);

module.exports = router;
