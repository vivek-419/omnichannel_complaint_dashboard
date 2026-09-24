const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../../');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const CONFIG_DIR = path.resolve(ROOT_DIR, 'config');
const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

// Resolve data file path with fallback to root if exists in root
function getDataPath(filename) {
  const inData = path.join(DATA_DIR, filename);
  if (fs.existsSync(inData)) return inData;
  const inRoot = path.join(ROOT_DIR, filename);
  if (fs.existsSync(inRoot)) return inRoot;
  return inData; // Default to data/ directory for new file creations
}

// Resolve config file path with fallback to root if exists in root
function getConfigPath(filename) {
  const inConfig = path.join(CONFIG_DIR, filename);
  if (fs.existsSync(inConfig)) return inConfig;
  const inRoot = path.join(ROOT_DIR, filename);
  if (fs.existsSync(inRoot)) return inRoot;
  return inConfig;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  CONFIG_DIR,
  PUBLIC_DIR,
  getDataPath,
  getConfigPath
};
