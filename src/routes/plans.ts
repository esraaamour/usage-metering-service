/**
 * @file plans.ts
 * @description Plan Management Routes.
 * Fastify plugin that lets an authenticated account create, list, and update its own custom plans.
 * Predefined (global) plans are visible to everyone but read-only. Plans belonging to other
 * accounts are never exposed (account isolation).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/db.js';
import { authenticate } from '../db/auth.js';
import { HttpError } from '../db/errors.js';

// Columns returned by every plan query
const COLS = 'id, scope, name, monthly_allowance, max_per_request, is_predefined';

// bigint columns arrive as strings from pg; responses use camelCase like the rest of the API.
const toPlan = (r: any) => ({
  id: r.id,
  scope: r.scope,
  name: r.name,
  monthlyAllowance: Number(r.monthly_allowance),
  maxPerRequest: Number(r.max_per_request),
  predefined: r.is_predefined,
});

// Maps a PostgreSQL unique-violation (23505) to a 409 error; rethrows any other error unchanged
const duplicateName = (e: any) => {
  if (e?.code === '23505') {
    throw new HttpError(409, 'plan_name_exists', 'A plan with this name already exists');
  }
  throw e;
};

export default async function plansRoutes(app: FastifyInstance) {
  // POST /api/plans : create a custom plan for the calling account.
  app.post('/', async (req, reply) => {
    // Identify the calling account from the x-api-key header
    const { accountId } = await authenticate(req);

    // Validate the request body
    const body = z
      .object({
        name: z.string().min(1),
        scope: z.enum(['account', 'user']),
        monthlyAllowance: z.number().int().nonnegative(), // 0 is allowed (blocks the level)
        maxPerRequest: z.number().int().positive(),
      })
      .parse(req.body);

    try {
      // The plan is owned by the caller (account_id), so it is private to this account
      const { rows } = await pool.query(
        `INSERT INTO plans (account_id, scope, name, monthly_allowance, max_per_request)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`,
        [accountId, body.scope, body.name, body.monthlyAllowance, body.maxPerRequest],
      );
      return reply.status(201).send(toPlan(rows[0]));
    } catch (e) {
      // Duplicate (account, scope, name) becomes a 409 instead of a generic 500
      duplicateName(e);
    }
  });

  // GET /api/plans : list predefined plans + this account's own plans.
  app.get('/', async (req) => {
    const { accountId } = await authenticate(req);

    // Predefined plans first, then ordered by scope and name
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM plans
        WHERE account_id IS NULL OR account_id = $1
        ORDER BY is_predefined DESC, scope, name`,
      [accountId],
    );
    return { plans: rows.map(toPlan) };
  });

  // PATCH /api/plans/:id : update a custom plan. Predefined = read-only.
  // Other accounts' plans look non-existent.
  app.patch('/:id', async (req) => {
    const { accountId } = await authenticate(req);

    // Validate the plan id from the URL
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Validate the body: every field is optional, but at least one must be provided
    const body = z
      .object({
        name: z.string().min(1).optional(),
        monthlyAllowance: z.number().int().nonnegative().optional(),
        maxPerRequest: z.number().int().positive().optional(),
      })
      .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' })
      .parse(req.body);

    let rows;
    try {
      // Ownership check and update in ONE statement: no race between check and write.
      // COALESCE keeps the existing value for any field that was not provided.
      ({ rows } = await pool.query(
        `UPDATE plans
            SET name = COALESCE($1, name),
                monthly_allowance = COALESCE($2, monthly_allowance),
                max_per_request = COALESCE($3, max_per_request),
                updated_at = now()
          WHERE id = $4 AND account_id = $5
          RETURNING ${COLS}`,
        [body.name ?? null, body.monthlyAllowance ?? null, body.maxPerRequest ?? null, id, accountId],
      ));
    } catch (e) {
      duplicateName(e);
    }

    // No row updated: figure out why, to return the most accurate error
    if (rows!.length === 0) {
      const p = await pool.query('SELECT account_id FROM plans WHERE id = $1', [id]);
      // account_id NULL means a predefined plan: it exists but cannot be modified
      if (p.rows.length > 0 && p.rows[0].account_id === null) {
        throw new HttpError(403, 'read_only_plan', 'Predefined plans are read-only');
      }
      // Otherwise the plan is missing or belongs to another account
      throw new HttpError(404, 'plan_not_found', 'Plan not found');
    }
    return toPlan(rows![0]);
  });
}
