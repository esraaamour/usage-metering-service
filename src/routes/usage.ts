import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/db.js';
import { authenticate } from '../db/auth.js';
import { consume, ConsumeInput } from '../db/consume.js';
import { HttpError } from '../db/errors.js';

const toNum = (val: any): number => Number(val) || 0;

export default async function usageRoutes(app: FastifyInstance) {
  // 1. GET /api/usage - Fetch account and user usage statistics
  app.get('/', async (req: FastifyRequest) => {
    const { accountId } = await authenticate(req);

    const accountResult = await pool.query(
      `SELECT ap.monthly_allowance, COALESCE(au.used, 0) as used
       FROM accounts a
       JOIN plans ap ON ap.id = a.plan_id
       LEFT JOIN account_usage au ON au.account_id = a.id AND au.month = to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM')
       WHERE a.id = $1`,
      [accountId]
    );

    const usersResult = await pool.query(
      `SELECT u.id, up.monthly_allowance, COALESCE(uu.used, 0) as used
       FROM users u
       JOIN plans up ON up.id = u.plan_id
       LEFT JOIN user_usage uu ON uu.user_id = u.id AND uu.month = to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM')
       WHERE u.account_id = $1`,
      [accountId]
    );

    const acc = accountResult.rows[0] || { monthly_allowance: 0, used: 0 };

    return {
      monthlyAllowance: toNum(acc.monthly_allowance),
      currentPeriodConsumed: toNum(acc.used),
      users: usersResult.rows.map((u: any) => ({
        id: u.id,
        monthlyAllowance: toNum(u.monthly_allowance),
        currentPeriodConsumed: toNum(u.used),
      })),
    };
  });

  // 2. POST /api/usage/consume - Consume units for a specific user under the authenticated account
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

      const input: ConsumeInput = {
        accountId,
        userExternalId,
        units,
        requestId,
      };

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
