/**
 * @file routes/assignments.ts
 * @description Plan Assignment Routes.
 * Exposes authenticated endpoints that let a client account switch its own plan or change the plan
 * of one of its users. Every assignment is validated: the plan must exist, match the expected scope
 * (account or user), and be either a global predefined plan or a custom plan owned by the caller.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/db.js';
import { authenticate } from '../db/auth.js';
import { HttpError } from '../db/errors.js';

/** Plan must exist, have the right scope, and be predefined or owned by this account. */
async function assertUsablePlan(planId: string, scope: 'account' | 'user', accountId: string) {
  const { rows } = await pool.query('SELECT scope, account_id FROM plans WHERE id = $1', [planId]);
  const plan = rows[0];
  // Other accounts' custom plans look non-existent (account isolation).
  if (!plan || (plan.account_id !== null && plan.account_id !== accountId)) {
    throw new HttpError(404, 'plan_not_found', 'Plan not found');
  }
  // Reject plans of the wrong type (e.g. a user plan assigned to an account)
  if (plan.scope !== scope) {
    throw new HttpError(400, 'invalid_plan_scope', `Plan scope must be ${scope}`);
  }
}

export default async function assignmentsRoutes(app: FastifyInstance) {
  // PUT /api/assignments/account/plan : assign a plan to the calling account.
  app.put('/account/plan', async (req) => {
    // Identify the calling account from the x-api-key header
    const { accountId } = await authenticate(req);

    // Validate that the body contains a well-formed plan UUID
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.body);

    // Make sure the plan exists, has scope 'account', and is accessible to this account
    await assertUsablePlan(planId, 'account', accountId);

    // Usage tables are untouched: switching plans keeps consumed units.
    await pool.query('UPDATE accounts SET plan_id = $1 WHERE id = $2', [planId, accountId]);
    return { planId };
  });

  // PUT /api/assignments/users/:userId/plan : assign a plan to one user
  // (identified by the caller's own user id, i.e. external_id).
  app.put('/users/:userId/plan', async (req) => {
    const { accountId } = await authenticate(req);

    // userId comes from the URL; planId comes from the request body
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.params);
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.body);

    // Make sure the plan exists, has scope 'user', and is accessible to this account
    await assertUsablePlan(planId, 'user', accountId);

    // Update only if the user belongs to the calling account (prevents cross-account changes)
    const { rows } = await pool.query(
      `UPDATE users SET plan_id = $1
        WHERE external_id = $2 AND account_id = $3
        RETURNING id, external_id, plan_id`,
      [planId, userId, accountId],
    );
    if (rows.length === 0) {
      throw new HttpError(404, 'user_not_found', 'User not found under this account');
    }
    return { id: rows[0].id, userId: rows[0].external_id, planId: rows[0].plan_id };
  });
}
