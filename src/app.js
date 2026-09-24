const express = require('express');
const cors = require('cors');
const { PUBLIC_DIR } = require('./config/paths.config');
const { requestLogger } = require('./middlewares/logger.middleware');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');
const apiRoutes = require('./routes/index');

const app = express();

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Static Web Portal Hosting
app.use(express.static(PUBLIC_DIR));

// Mount Unified API Routes
app.use('/api', apiRoutes);

// Error Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
