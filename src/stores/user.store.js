const fs = require('fs');
const bcrypt = require('bcrypt');
const { getDataPath } = require('../config/paths.config');
const { dbSaveUser } = require('../services/db.service');

const USERS_FILE = getDataPath('users.json');

let users = [];

function initUserStore() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      users = JSON.parse(data);
      console.log(`[UserStore] Loaded ${users.length} user(s) (in-memory + JSON backup)`);
    } else {
      const salt = bcrypt.genSaltSync(10);
      users = [
        {
          id: 'usr-agent-1',
          email: 'agent@ccmrs.com',
          name: 'Rahul Sharma',
          passwordHash: bcrypt.hashSync('agent123', salt),
          role: 'agent',
          mfaEnabled: false,
          mfaSecret: null,
          createdAt: new Date().toISOString()
        },
        {
          id: 'usr-agent-2',
          email: 'priya@ccmrs.com',
          name: 'Priya Patel',
          passwordHash: bcrypt.hashSync('agent123', salt),
          role: 'agent',
          mfaEnabled: false,
          mfaSecret: null,
          createdAt: new Date().toISOString()
        },
        {
          id: 'usr-head-1',
          email: 'head@ccmrs.com',
          name: 'Vivek Addagatla',
          passwordHash: bcrypt.hashSync('head123', salt),
          role: 'Delivery Head',
          mfaEnabled: false,
          mfaSecret: null,
          createdAt: new Date().toISOString()
        },
        {
          id: 'usr-admin-1',
          email: 'admin@ccmrs.com',
          name: 'Administrator',
          passwordHash: bcrypt.hashSync('admin123', salt),
          role: 'admin',
          mfaEnabled: false,
          mfaSecret: null,
          createdAt: new Date().toISOString()
        }
      ];
      saveUsers();
      console.log('[UserStore] Initialized default demo users (Agent, Delivery Head, Admin)');
    }
  } catch (err) {
    console.error('[UserStore] Error loading users.json:', err.message);
    users = [];
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    for (const u of users) {
      dbSaveUser(u).catch(() => {});
    }
  } catch (err) {
    console.error('[UserStore] Error saving users:', err.message);
  }
}

function findByEmail(email) {
  if (!email) return null;
  return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

function findById(id) {
  if (!id) return null;
  return users.find(u => u.id === id) || null;
}

function getAllUsers() {
  return [...users];
}

function addUser(user) {
  users.push(user);
  saveUsers();
  return user;
}

function updateUser(id, updates) {
  const user = findById(id);
  if (!user) return null;
  Object.assign(user, updates);
  saveUsers();
  return user;
}

initUserStore();

module.exports = {
  findByEmail,
  findById,
  getAllUsers,
  addUser,
  updateUser,
  saveUsers
};
