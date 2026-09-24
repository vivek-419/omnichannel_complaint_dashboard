import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { authorizeRoles } from '../middlewares/rbac.middleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);

// Example of a protected route for different roles
router.get('/agent-data', authenticate, authorizeRoles('agent', 'Delivery Head', 'admin'), (req, res) => {
  res.json({ message: 'This data is visible to agents, delivery heads, and admins' });
});

router.get('/delivery-head-data', authenticate, authorizeRoles('Delivery Head', 'admin'), (req, res) => {
  res.json({ message: 'This data is visible only to delivery heads and admins' });
});

router.get('/backend-data', authenticate, authorizeRoles('backend', 'admin'), (req, res) => {
  res.json({ message: 'This data is visible only to backend team and admins' });
});

export default router;
