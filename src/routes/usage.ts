import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/db.js';
import { authenticate } from '../db/auth.js';
import { consume, ConsumeInput } from '../db/consume.js';
import { HttpError } from '../db/errors.js';

const toNum = (val: any): number => Number(val) || 0;

// Resolve the requested month (?month=YYYY-MM) to the stored format YYYY-MM-DD (UTC).
// Defaults to the current UTC month, computed the same way consume() does.
async function resolveMonth(q: unknown): Promise<string> {
  const { month } = z
    .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
    .parse(q);
  if (month) return `${month}-01`;
  const m = await pool.query(
    `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS month`,
  );
  return m.rows[0].month;
}

const level = (name: string, planId: string, allow: any, max: any, used: any) => ({
  planId,
  planName: name,
  monthlyAllowance: toNum(allow),
  maxPerRequest: toNum(max),
  used: toNum(used),
  remaining: Math.max(0, toNum(allow) - toNum(used)),
});

export default async function usageRoutes(app: FastifyInstance) {
  // GET /api/usage?month=YYYY-MM : account + per-user usage, remaining and current plans
  app.get('/', async (req: FastifyRequest) => {
    const { accountId } = await authenticate(req);
    const month = await resolveMonth(req.query);

    const acc = await pool.query(
      `SELECT p.id AS plan_id, p.name, p.monthly_allowance, p.max_per_request,
              COALESCE(au.used, 0) AS used
         FROM accounts a
         JOIN plans p ON p.id = a.plan_id
         LEFT JOIN account_usage au ON au.account_id = a.id AND au.month = $2
        WHERE a.id = $1`,
      [accountId, month],
    );
    const users = await pool.query(
      `SELECT u.external_id, p.id AS plan_id, p.name, p.monthly_allowance, p.max_per_request,
              COALESCE(uu.used, 0) AS used
         FROM users u
         JOIN plans p ON p.id = u.plan_id
         LEFT JOIN user_usage uu ON uu.user_id = u.id AND uu.month = $2
        WHERE u.account_id = $1
        ORDER BY u.external_id`,
      [accountId, month],
    );
    const a = acc.rows[0];
    return {
      month,
      account: level(a.name, a.plan_id, a.monthly_allowance, a.max_per_request, a.used),
      users: users.rows.map((u: any) => ({
        userId: u.external_id,
        ...level(u.name, u.plan_id, u.monthly_allowance, u.max_per_request, u.used),
      })),
    };
  });

  // GET /api/usage/history?month=YYYY-MM&userId=...&limit=20&offset=0 : request outcomes, paginated
  app.get('/history', async (req: FastifyRequest) => {
    const { accountId } = await authenticate(req);
    const q = z
      .object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
        userId: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);

    const params: any[] = [accountId];
    let where = 'r.account_id = $1';
    if (q.month) {
      params.push(`${q.month}-01`);
      where += ` AND r.month = $${params.length}`;
    }
    if (q.userId) {
      params.push(q.userId);
      where += ` AND u.external_id = $${params.length}`;
    }

    const total = await pool.query(
      `SELECT count(*) AS n FROM requests r JOIN users u ON u.id = r.user_id WHERE ${where}`,
      params,
    );
    params.push(q.limit, q.offset);
    const rows = await pool.query(
      `SELECT r.request_id, u.external_id, r.units, r.month, r.accepted,
              r.reject_level, r.reject_rule, r.created_at
         FROM requests r JOIN users u ON u.id = r.user_id
        WHERE ${where}
        ORDER BY r.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      total: toNum(total.rows[0].n),
      limit: q.limit,
      offset: q.offset,
      items: rows.rows.map((r: any) => ({
        requestId: r.request_id,
        userId: r.external_id,
        units: toNum(r.units),
        month: r.month,
        accepted: r.accepted,
        rejection: r.accepted ? null : { level: r.reject_level, rule: r.reject_rule },
        createdAt: r.created_at,
      })),
    };
  });

  // POST /api/usage/consume
  app.post('/consume', async (req: FastifyRequest, reply) => {
    try {
      const { accountId } = await authenticate(req);

      const { userExternalId, units, requestId } = z
        .object({
          userExternalId: z.string().min(1),
          units: z.number().int().positive(),
          requestId: z.string().min(1),
        })
        .parse(req.body);

      const input: ConsumeInput = { accountId, userExternalId, units, requestId };
      const result = await consume(input);
      return reply.send(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          statusCode: 400,
          code: 'bad_request',
          error: 'Bad Request',
          message: 'userExternalId and requestId are required, and units must be a positive whole number',
        });
      }
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({
          statusCode: err.statusCode,
          code: err.code,
          error: err.name,
          message: err.message,
        });
      }
      throw err;
    }
  });
}
