'use strict';

/**
 * Central error-handling middleware.
 * Must have exactly 4 parameters so Express treats it as an error handler.
 */
function errorHandler(err, req, res, _next) {
  const status  = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  if (status === 500) {
    console.error('[ERROR]', err);
  }

  res.status(status).json({
    success: false,
    error: {
      code:    status,
      message,
    },
  });
}

/**
 * 404 handler — catches routes not matched by any router.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code:    404,
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

module.exports = { errorHandler, notFoundHandler };
