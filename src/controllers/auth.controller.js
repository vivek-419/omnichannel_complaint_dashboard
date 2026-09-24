const authService = require('../services/auth.service');

async function register(req, res) {
  try {
    const result = await authService.registerUser(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

async function login(req, res) {
  try {
    const result = await authService.loginUser(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
}

function getAgents(req, res) {
  res.json({ success: true, agents: authService.getAgents() });
}

function getMe(req, res) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  const user = authService.getUserProfile(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  res.json({ success: true, user });
}

async function setupMFA(req, res) {
  try {
    const userId = req.body.userId || (req.user && req.user.id);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    const result = await authService.setupMFA(userId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

function verifyMFA(req, res) {
  try {
    const userId = req.body.userId || (req.user && req.user.id);
    const { code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ success: false, message: 'User ID and verification code are required' });
    }
    const result = authService.verifyAndEnableMFA(userId, code);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

function getAllUsers(req, res) {
  res.json({ success: true, users: authService.getAllUsers() });
}

module.exports = {
  register,
  login,
  getAgents,
  getAllUsers,
  getMe,
  setupMFA,
  verifyMFA
};
