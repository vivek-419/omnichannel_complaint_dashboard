// 404 Handler for undefined API routes
function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      success: false,
      message: `API endpoint not found: ${req.method} ${req.originalUrl}`
    });
  }
  next();
}

// Global Error Handler
function errorHandler(err, req, res, next) {
  console.error('[Unhandled Error]:', err);

  const statusCode = err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};
