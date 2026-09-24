const authService = require('../services/auth.service');

// Express Middleware: Authenticate JWT
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. Bearer token missing.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = authService.verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session token.' });
  }
}

// Optional Auth (attaches req.user if present, but doesn't block)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      req.user = authService.verifyToken(token);
    } catch (e) {
      // Ignore invalid token in optional auth
    }
  }
  next();
}

// Express Middleware: Role-Based Authorization
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: `Forbidden: User role '${req.user.role}' is not authorized for this resource.`
      });
    }

    next();
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  authorizeRoles
};
