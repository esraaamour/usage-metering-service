import { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db/db.js';
import { authenticate } from '../db/auth.js';

const toNum = (val: any): number => Number(val) || 0;

export default async function usageRoutes(app: FastifyInstance) {
  app.get('/usage', async (req: FastifyRequest) => {
    const { accountId } = await authenticate(req);

    const monthResult = await pool.query(
      `SELECT monthly_allowance, used FROM accounts WHERE id = $1`,
      [accountId]
    );

    const accountResult = await pool.query(
      `SELECT monthly_allowance, used FROM accounts WHERE id = $1`,
      [accountId]
    );

    const usersResult = await pool.query(
      `SELECT id, monthly_allowance, used FROM users WHERE account_id = $1`,
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
}
