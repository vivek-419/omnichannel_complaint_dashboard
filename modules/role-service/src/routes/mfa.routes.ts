import { Router } from 'express';
import { generateMfaSecret, verifyMfaSetup, verifyMfaLogin } from '../controllers/mfa.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Setup MFA (requires normal auth token or temporary setup token if enforced)
router.post('/setup', authenticate, generateMfaSecret);

// Verify initial setup (requires normal auth token or temporary setup token)
router.post('/verify-setup', authenticate, verifyMfaSetup);

// Verify MFA during login (requires temporary MFA token from login step)
router.post('/verify', authenticate, verifyMfaLogin);

export default router;
