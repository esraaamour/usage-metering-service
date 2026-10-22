/**
 * @file plans.ts
 * @description Fastify plugin for plan management (create, list, update custom plans).
 */
import { z } from 'zod';
import { pool } from '../db/db.js';
import { authenticate } from '../db/auth.js';
import { HttpError } from '../db/errors.js';
const COLS = 'id, scope, name, monthly_allowance, max_per_request, is_predefined';
// bigint columns arrive as strings from pg; responses use camelCase like the rest of the API.
const toPlan = (r) => ({
    id: r.id,
    scope: r.scope,
    name: r.name,
    monthlyAllowance: Number(r.monthly_allowance),
    maxPerRequest: Number(r.max_per_request),
    predefined: r.is_predefined,
});
const duplicateName = (e) => {
    if (e?.code === '23505') {
        throw new HttpError(409, 'plan_name_exists', 'A plan with this name already exists');
    }
    throw e;
};
export default async function plansRoutes(app) {
    // Create a custom plan for the calling account.
    app.post('/plans', async (req, reply) => {
        const { accountId } = await authenticate(req);
        const body = z
            .object({
            name: z.string().min(1),
            scope: z.enum(['account', 'user']),
            monthlyAllowance: z.number().int().nonnegative(), // 0 is allowed (blocks the level)
            maxPerRequest: z.number().int().positive(),
        })
            .parse(req.body);
        try {
            const { rows } = await pool.query(`INSERT INTO plans (account_id, scope, name, monthly_allowance, max_per_request)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`, [accountId, body.scope, body.name, body.monthlyAllowance, body.maxPerRequest]);
            return reply.status(201).send(toPlan(rows[0]));
        }
        catch (e) {
            duplicateName(e);
        }
    });
    // List predefined plans + this account's own plans.
    app.get('/plans', async (req) => {
        const { accountId } = await authenticate(req);
        const { rows } = await pool.query(`SELECT ${COLS} FROM plans
        WHERE account_id IS NULL OR account_id = $1
        ORDER BY is_predefined DESC, scope, name`, [accountId]);
        return { plans: rows.map(toPlan) };
    });
    // Update a custom plan. Predefined = read-only. Other accounts' plans look non-existent.
    app.patch('/plans/:id', async (req) => {
        const { accountId } = await authenticate(req);
        const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
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
            ({ rows } = await pool.query(`UPDATE plans
            SET name = COALESCE($1, name),
                monthly_allowance = COALESCE($2, monthly_allowance),
                max_per_request = COALESCE($3, max_per_request),
                updated_at = now()
          WHERE id = $4 AND account_id = $5
          RETURNING ${COLS}`, [body.name ?? null, body.monthlyAllowance ?? null, body.maxPerRequest ?? null, id, accountId]));
        }
        catch (e) {
            duplicateName(e);
        }
        if (rows.length === 0) {
            const p = await pool.query('SELECT account_id FROM plans WHERE id = $1', [id]);
            if (p.rows.length > 0 && p.rows[0].account_id === null) {
                throw new HttpError(403, 'read_only_plan', 'Predefined plans are read-only');
            }
            throw new HttpError(404, 'plan_not_found', 'Plan not found');
        }
        return toPlan(rows[0]);
    });
}
//# sourceMappingURL=plans.js.map