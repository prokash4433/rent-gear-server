import { verifyToken } from './verifyToken.js';

/**
 * Builds a role guard on top of `verifyToken`.
 *
 * The token is verified first (401 when missing/invalid), then `req.user.role`
 * must be one of the allowed roles, otherwise a 403 is returned without ever
 * reaching the route handler.
 */
export function requireRole(...allowedRoles) {
   return function roleGuard(req, res, next) {
      verifyToken(req, res, (err) => {
         if (err) return next(err);

         if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
               error: `Access denied: this action requires the ${allowedRoles.join(' or ')} role.`,
               code: 'INSUFFICIENT_ROLE',
               requiredRoles: allowedRoles,
               role: req.user?.role ?? null,
            });
         }
         next();
      });
   };
}
