import { verifyToken, isRenterRole } from './verifyToken.js';

/**
 * Renter guard — renter-only actions (reading and saving favourites).
 *
 * better-auth stores the role as "customer"; "renter" is accepted as an alias.
 * Built directly on `verifyToken` so the alias can be matched.
 */
export function verifyRenter(req, res, next) {
   verifyToken(req, res, (err) => {
      if (err) return next(err);
      if (!isRenterRole(req.user?.role)) {
         return res.status(403).json({
            error: 'Access denied: this action is only available to renters.',
            code: 'INSUFFICIENT_ROLE',
            requiredRoles: ['renter'],
            role: req.user?.role ?? null,
         });
      }
      next();
   });
}

export default verifyRenter;
