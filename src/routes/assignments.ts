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
  if (plan.scope !== scope) {
    throw new HttpError(400, 'invalid_plan_scope', `Plan scope must be ${scope}`);
  }
}

export default async function assignmentsRoutes(app: FastifyInstance) {
  // Assign a plan to the calling account.
  app.put('/account/plan', async (req) => {
    const { accountId } = await authenticate(req);
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.body);
    await assertUsablePlan(planId, 'account', accountId);
    // Usage tables are untouched: switching plans keeps consumed units.
    await pool.query('UPDATE accounts SET plan_id = $1 WHERE id = $2', [planId, accountId]);
    return { planId };
  });

  // Assign a plan to one user (identified by the caller's own user id).
  app.put('/users/:userId/plan', async (req) => {
    const { accountId } = await authenticate(req);
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.params);
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.body);
    await assertUsablePlan(planId, 'user', accountId);
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
