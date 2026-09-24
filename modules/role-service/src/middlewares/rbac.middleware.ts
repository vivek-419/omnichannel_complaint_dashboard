import { Request, Response, NextFunction } from 'express';

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const userRoles = req.user.roles.map((ur: any) => ur.role.name);
    const hasRole = userRoles.some((role: string) => allowedRoles.includes(role));

    if (!hasRole) {
      res.status(403).json({ message: 'Access forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};
