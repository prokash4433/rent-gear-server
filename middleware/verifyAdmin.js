import { requireRole } from './requireRole.js';

/** Admin guard — user management and moderation endpoints. */
export const verifyAdmin = requireRole('admin');

export default verifyAdmin;
