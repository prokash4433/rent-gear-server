import { requireRole } from './requireRole.js';

/** Equipment-owner guard — listing and managing their own equipment. */
export const verifyOwner = requireRole('owner');

export default verifyOwner;
