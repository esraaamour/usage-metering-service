import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/db.js';
import { authenticate } from '../db/auth.js';
import { HttpError } from '../db/errors.js';

export default async function usersRoutes(app: FastifyInstance) {
  // POST /api/users : register a user under the calling account.
  app.post('/', async (req, reply) => {
    const { accountId } = await authenticate(req);
    const body = z
      .object({ externalId: z.string().min(1), planId: z.string().uuid().optional() })
      .parse(req.body);

    // Default plan is Basic. A given plan must be a predefined user plan
    // or one of this account's own user plans.
    const plan = body.planId
      ? await pool.query(
          `SELECT id FROM plans WHERE id = $1 AND scope = 'user'
             AND (account_id IS NULL OR account_id = $2)`,
          [body.planId, accountId],
        )
      : await pool.query(
          `SELECT id FROM plans WHERE scope = 'user' AND name = 'Basic' AND account_id IS NULL`,
        );
    if (plan.rows.length === 0) {
      throw new HttpError(400, 'unknown_plan', 'Plan not found or not usable by this account');
    }

    try {
      const { rows } = await pool.query(
        'INSERT INTO users (account_id, external_id, plan_id) VALUES ($1, $2, $3) RETURNING id',
        [accountId, body.externalId, plan.rows[0].id],
      );
      return reply
        .status(201)
        .send({ id: rows[0].id, externalId: body.externalId, planId: plan.rows[0].id });
    } catch (e: any) {
      if (e.code === '23505') throw new HttpError(409, 'user_exists', 'User already exists');
      throw e;
    }
  });
}
