/**
 * @file routes/accounts.ts
 * @description Accounts Routes.
 * Exposes the endpoint used to onboard a new client account (tenant). It validates the request,
 * links the account to one of the predefined account plans, generates an API key, and stores
 * only the SHA-256 hash of that key. The raw key is returned once and never stored.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/db.js';
import { hashKey, newApiKey } from '../db/auth.js';
import { HttpError } from '../db/errors.js';

export default async function accountsRoutes(app: FastifyInstance) {
  // POST /api/accounts : create an account and return its API key (shown only once).
  // If ADMIN_TOKEN is set, the x-admin-token header must match it.
  app.post('/', async (req, reply) => {
    // Admin protection: enforced only when the ADMIN_TOKEN environment variable is configured
    if (process.env.ADMIN_TOKEN && req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
      throw new HttpError(401, 'invalid_admin_token', 'Admin token required');
    }

    // Validate the request body; planName defaults to the 'Starter' plan
    const body = z
      .object({ name: z.string().min(1), planName: z.string().default('Starter') })
      .parse(req.body);

    // Look up the requested plan among the global predefined account plans (account_id IS NULL)
    const plan = await pool.query(
      `SELECT id FROM plans WHERE scope = 'account' AND name = $1 AND account_id IS NULL`,
      [body.planName],
    );
    if (plan.rows.length === 0) {
      throw new HttpError(400, 'unknown_plan', 'Unknown predefined account plan');
    }

    // Generate a new API key and store only its hash in the database
    const apiKey = newApiKey();
    const { rows } = await pool.query(
      'INSERT INTO accounts (name, api_key_hash, plan_id) VALUES ($1, $2, $3) RETURNING id',
      [body.name, hashKey(apiKey), plan.rows[0].id],
    );

    // Return the raw API key to the client; this is the only time it is ever visible
    return reply.status(201).send({ id: rows[0].id, name: body.name, apiKey });
  });
}
