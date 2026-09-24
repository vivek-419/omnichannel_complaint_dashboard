import { Request, Response } from 'express';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/encryption.util';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production';

export const generateMfaSecret = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    // Generate a secret
    const secret = speakeasy.generateSecret({ length: 20, name: `MyApp (${user.email})` });
    
    // Encrypt the secret to store in the database
    const encryptedSecret = encrypt(secret.base32);
    
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: encryptedSecret }
    });

    // Generate QR Code URL
    QRCode.toDataURL(secret.otpauth_url!, (err, data_url) => {
      if (err) {
        res.status(500).json({ message: 'Error generating QR Code' });
        return;
      }
      res.json({ secret: secret.base32, qrCode: data_url });
    });
  } catch (error) {
    console.error('MFA setup error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const verifyMfaSetup = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const { token } = req.body; // Token from the user's authenticator app

    if (!user || !user.mfaSecret) {
      res.status(400).json({ message: 'MFA setup not initiated' });
      return;
    }

    const decryptedSecret = decrypt(user.mfaSecret);

    const verified = speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token
    });

    if (verified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true }
      });
      res.json({ message: 'MFA enabled successfully' });
    } else {
      res.status(400).json({ message: 'Invalid token' });
    }
  } catch (error) {
    console.error('MFA verify setup error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const verifyMfaLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const { token } = req.body;

    if (!user || !user.mfaSecret) {
      res.status(400).json({ message: 'MFA not enabled' });
      return;
    }

    const decryptedSecret = decrypt(user.mfaSecret);

    const verified = speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token
    });

    if (verified) {
      // Issue a full token (not temporary)
      const userRoles = user.roles.map((ur: any) => ur.role.name);
      const fullToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1d' });
      res.json({ token: fullToken, roles: userRoles });
    } else {
      res.status(401).json({ message: 'Invalid MFA token' });
    }
  } catch (error) {
    console.error('MFA login verify error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
