import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production';

// Helper to assign a role to a user
const assignRole = async (userId: string, roleName: string) => {
  let role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    role = await prisma.role.create({ data: { name: roleName } });
  }
  await prisma.userRole.create({
    data: {
      userId,
      roleId: role.id
    }
  });
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, role } = req.body;
    
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ message: 'User already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      }
    });

    // Assign the requested role or default to 'agent'
    const assignedRole = role || 'agent';
    await assignRole(user.id, assignedRole);

    res.status(201).json({ message: 'User registered successfully', userId: user.id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } }
    });

    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const userRoles = user.roles.map(ur => ur.role.name);
    const needsMfa = userRoles.includes('admin') || userRoles.includes('Delivery Head');

    if (needsMfa && user.mfaEnabled) {
      // Issue a temporary token only valid for MFA verification
      const tempToken = jwt.sign({ id: user.id, requireMfa: true }, JWT_SECRET, { expiresIn: '5m' });
      res.json({ message: 'MFA required', tempToken, requiresMfa: true });
      return;
    } else if (needsMfa && !user.mfaEnabled) {
        // Enforce MFA setup
        const tempToken = jwt.sign({ id: user.id, requireMfa: true }, JWT_SECRET, { expiresIn: '15m' });
        res.status(403).json({ message: 'MFA setup required for this role', tempToken, setupRequired: true });
        return;
    }

    // Standard login (e.g. for agent or backend without MFA requirement)
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, roles: userRoles });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
