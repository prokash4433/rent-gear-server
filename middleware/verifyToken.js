import { ObjectId } from 'mongodb';
import { importJWK, jwtVerify } from 'jose';
import { jwks, users } from '../db.js';

/**
 * JWT verification for every protected API route.
 *
 * Tokens are issued by better-auth's JWT plugin (EdDSA / Ed25519, signed with
 * a key pair stored in the `jwks` collection of the same `rent-gear` database).
 * The public key is looked up by the token's `kid` header and verified locally,
 * so no request to the Next.js server is needed at runtime.
 *
 * Claims checked: signature, `exp`, `iss` and `aud`.
 * The caller's fresh role is then re-read from the `user` collection so a
 * demoted/deleted account loses access immediately instead of when the token
 * expires.
 */

/** Must match `jwt.issuer` / `jwt.audience` in the better-auth config (lib/auth.ts). */
export const JWT_ISSUER = 'rent-gear';
export const JWT_AUDIENCE = 'rent-gear-api';

/** Machine readable error so callers can distinguish 401 reasons. */
export class AuthError extends Error {
   constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
   }
}

/** Accepts both ObjectId and string ids (better-auth stores ObjectId `_id`s). */
async function findById(collection, id) {
   if (typeof id === 'string' && ObjectId.isValid(id)) {
      const byObjectId = await collection.findOne({ _id: new ObjectId(id) });
      if (byObjectId) return byObjectId;
   }
   return collection.findOne({ _id: id });
}

/** Reads `Authorization: Bearer <jwt>` (also accepts a raw token). */
function extractBearerToken(req) {
   const header = req.headers.authorization;
   if (typeof header !== 'string' || !header.trim()) return null;
   const match = /^bearer\s+(.+)$/i.exec(header.trim());
   return match ? match[1].trim() : null;
}

/** Decodes (without verifying) the token header to find the signing key id. */
function readKid(token) {
   const [headerPart] = token.split('.');
   if (!headerPart) return null;
   try {
      const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
      return typeof header.kid === 'string' ? header.kid : null;
   } catch {
      return null;
   }
}

/** Roles are written as "customer" by better-auth; the API calls them renters. */
export function isRenterRole(role) {
   return role === 'customer' || role === 'renter';
}

/**
 * Verifies a raw JWT string and returns its payload.
 * Throws AuthError (401) when the token cannot be trusted.
 */
export async function verifyJwtToken(token) {
   const kid = readKid(token);
   if (!kid) {
      throw new AuthError(401, 'INVALID_TOKEN', 'Token is missing its signing key id.');
   }

   const keyDoc = await findById(jwks, kid);
   if (!keyDoc?.publicKey) {
      throw new AuthError(401, 'UNKNOWN_SIGNING_KEY', 'Token was signed with an unknown key.');
   }

   const alg = keyDoc.alg || 'EdDSA';
   let signingKey;
   try {
      signingKey = await importJWK(JSON.parse(keyDoc.publicKey), alg);
   } catch (error) {
      console.error('Could not import JWKS public key:', error);
      throw new AuthError(500, 'KEY_IMPORT_FAILED', 'Could not verify the token.');
   }

   try {
      const { payload } = await jwtVerify(token, signingKey, {
         algorithms: [alg],
         issuer: JWT_ISSUER,
         audience: JWT_AUDIENCE,
      });
      if (!payload.sub) {
         throw new AuthError(401, 'INVALID_TOKEN', 'Token has no subject (user id).');
      }
      return payload;
   } catch (error) {
      if (error instanceof AuthError) throw error;
      const reason =
         error?.code === 'ERR_JWT_EXPIRED' ? 'Token has expired.' : 'Token verification failed.';
      throw new AuthError(401, error?.code === 'ERR_JWT_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', reason);
   }
}

/**
 * Express middleware: requires a valid JWT and attaches `req.user`
 * ({ id, email, name, role }). Responds 401 when the request is not trusted.
 */
export async function verifyToken(req, res, next) {
   try {
      const token = extractBearerToken(req);
      if (!token) {
         throw new AuthError(
            401,
            'MISSING_TOKEN',
            'Authentication required: send the JWT as "Authorization: Bearer <token>".'
         );
      }

      const payload = await verifyJwtToken(token);

      const user = await findById(users, payload.sub);
      if (!user) {
         throw new AuthError(401, 'USER_NOT_FOUND', 'The account behind this token no longer exists.');
      }

      // Role comes from the database (authoritative), never from the token alone.
      const dbRole = typeof user.role === 'string' ? user.role : '';
      const role = ['customer', 'owner', 'admin'].includes(dbRole)
         ? dbRole
         : ['customer', 'owner', 'admin'].includes(payload.role)
           ? payload.role
           : 'customer';

      req.user = {
         id: String(user._id),
         email: String(user.email ?? payload.email ?? ''),
         name: String(user.name ?? payload.name ?? ''),
         role,
      };
      next();
   } catch (error) {
      if (error instanceof AuthError) {
         return res.status(error.status).json({ error: error.message, code: error.code });
      }
      console.error('verifyToken failed:', error);
      res.status(500).json({ error: 'Could not verify the token.', code: 'TOKEN_CHECK_FAILED' });
   }
}
