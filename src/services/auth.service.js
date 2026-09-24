const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const userStore = require('../stores/user.store');
const { getConfig } = require('../config/env.config');

const JWT_SECRET = getConfig().jwtSecret || process.env.JWT_SECRET || 'ccmrs_super_secret_jwt_key_2026';

// Register a new user
async function registerUser({ email, password, name, role = 'agent' }) {
  if (!email || !password || !name) {
    throw new Error('Email, password, and name are required.');
  }

  const existing = userStore.findByEmail(email);
  if (existing) {
    throw new Error('User with this email already exists.');
  }

  const validRoles = ['agent', 'Delivery Head', 'admin', 'backend'];
  const userRole = validRoles.includes(role) ? role : 'agent';

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const newUser = {
    id: `usr-${uuidv4().substring(0, 8)}`,
    email: email.toLowerCase(),
    name: name.trim(),
    passwordHash: passwordHash,
    role: userRole,
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: new Date().toISOString()
  };

  userStore.addUser(newUser);

  const token = generateToken(newUser);
  return { user: sanitizeUser(newUser), token };
}

// Authenticate user login
async function loginUser({ email, password, mfaCode }) {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const user = userStore.findByEmail(email);
  if (!user) {
    throw new Error('Invalid email or password.');
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    throw new Error('Invalid email or password.');
  }

  // If 2FA enabled, verify TOTP code
  if (user.mfaEnabled && user.mfaSecret) {
    if (!mfaCode) {
      return { requiresMFA: true, userId: user.id, email: user.email };
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: mfaCode.trim(),
      window: 1
    });

    if (!verified) {
      throw new Error('Invalid 2FA authentication code.');
    }
  }

  const token = generateToken(user);
  return { user: sanitizeUser(user), token, requiresMFA: false };
}

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Verify JWT token
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Remove sensitive passwordHash/secret from user response
function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, mfaSecret, ...safe } = user;
  return safe;
}

// Setup MFA TOTP QR Code for Google Authenticator
async function setupMFA(userId) {
  const user = userStore.findById(userId);
  if (!user) throw new Error('User not found.');

  const secret = speakeasy.generateSecret({
    name: `CCMRS Support (${user.email})`
  });

  user.mfaSecret = secret.base32;
  userStore.saveUsers();

  const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  return {
    secret: secret.base32,
    qrCode: qrCodeDataUrl
  };
}

// Verify & Enable MFA
function verifyAndEnableMFA(userId, token) {
  const user = userStore.findById(userId);
  if (!user || !user.mfaSecret) throw new Error('MFA setup not initialized for this user.');

  const verified = speakeasy.totp.verify({
    secret: user.mfaSecret,
    encoding: 'base32',
    token: token.trim(),
    window: 1
  });

  if (!verified) {
    throw new Error('Invalid verification code.');
  }

  user.mfaEnabled = true;
  userStore.saveUsers();
  return { success: true, user: sanitizeUser(user) };
}

// Get all agents list (useful for ticket assignment)
function getAgents() {
  return userStore.getAllUsers()
    .filter(u => u.role === 'agent' || u.role === 'Delivery Head')
    .map(sanitizeUser);
}

// Get all users list (for admin)
function getAllUsers() {
  return userStore.getAllUsers().map(sanitizeUser);
}

// Get user by ID (safe)
function getUserProfile(userId) {
  const user = userStore.findById(userId);
  return sanitizeUser(user);
}

module.exports = {
  registerUser,
  loginUser,
  generateToken,
  verifyToken,
  setupMFA,
  verifyAndEnableMFA,
  getAgents,
  getAllUsers,
  getUserProfile,
  sanitizeUser
};
