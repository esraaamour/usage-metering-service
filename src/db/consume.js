import { pool } from './db.js';
import { HttpError } from './errors.js';
/**
 * Rejection precedence when several rules fail (documented in README):
 *   per-request limits first (account, then user), then monthly allowances (account, then user).
 */
function decide(units, a, u) {
    if (units > a.maxPerRequest)
        return { level: 'account', rule: 'max_per_request' };
    if (units > u.maxPerRequest)
        return { level: 'user', rule: 'max_per_request' };
    if (units > a.remaining)
        return { level: 'account', rule: 'monthly_allowance' };
    if (units > u.remaining)
        return { level: 'user', rule: 'monthly_allowance' };
    return null;
}
/**
 * Executes a quota consumption transaction with proper ACID compliance and error rollback.
 */
export async function consume(input) {
    const client = await pool.connect();
    try {
        // Start database transaction
        await client.query('BEGIN');
        const result = await consumeTx(client, input);
        // Commit transaction if successful
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        // Rollback transaction on any error to ensure data consistency
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        // Always release the client back to the pool
        client.release();
    }
}
/**
 * Core transaction logic handling idempotency, row locking, limits validation, and usage updates.
 */
async function consumeTx(c, i) {
    const { accountId, userExternalId, units, requestId } = i;
    // 1. Verify that the user exists under the specified account
    const u = await c.query('SELECT id FROM users WHERE account_id = $1 AND external_id = $2', [
        accountId,
        userExternalId,
    ]);
    if (u.rows.length === 0) {
        throw new HttpError(404, 'user_not_found', 'User not found under this account');
    }
    const userId = u.rows[0].id;
    // 2. Determine the current month in UTC format using the database clock
    const m = await c.query(`SELECT to_char(date_trunc('month', now() AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS month`);
    const month = m.rows[0].month;
    // 3. Ensure usage tracking rows exist for the current month (initialize if missing)
    await c.query('INSERT INTO account_usage (account_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING', [accountId, month]);
    await c.query('INSERT INTO user_usage (user_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        userId,
        month,
    ]);
    // 4. Acquire row-level locks (FOR UPDATE) to prevent race conditions and deadlocks.
    // Lock order: Account row first, then User row.
    const au = await c.query('SELECT used FROM account_usage WHERE account_id = $1 AND month = $2 FOR UPDATE', [accountId, month]);
    const uu = await c.query('SELECT used FROM user_usage WHERE user_id = $1 AND month = $2 FOR UPDATE', [userId, month]);
    // 5. Idempotency Check: Return the exact stored decision if the requestId was already processed
    const prev = await c.query('SELECT user_id, units, decision FROM requests WHERE account_id = $1 AND request_id = $2', [accountId, requestId]);
    if (prev.rows.length > 0) {
        const p = prev.rows[0];
        if (p.user_id !== userId || Number(p.units) !== units) {
            throw new HttpError(409, 'request_id_conflict', 'request_id was already used with a different user or amount');
        }
        return { decision: p.decision, replayed: true };
    }
    // 6. Fetch current active plans and limits for both account and user at decision time
    const p = await c.query(`SELECT ap.id AS a_id, ap.monthly_allowance AS a_allow, ap.max_per_request AS a_max,
            up.id AS u_id, up.monthly_allowance AS u_allow, up.max_per_request AS u_max
       FROM accounts a
       JOIN plans ap ON ap.id = a.plan_id
       JOIN users us ON us.id = $2
       JOIN plans up ON up.id = us.plan_id
      WHERE a.id = $1`, [accountId, userId]);
    const r = p.rows[0];
    const level = (planId, allow, max, used) => ({
        planId,
        monthlyAllowance: Number(allow),
        maxPerRequest: Number(max),
        used: Number(used),
        remaining: Math.max(0, Number(allow) - Number(used)),
    });
    const account = level(r.a_id, r.a_allow, r.a_max, au.rows[0].used);
    const user = level(r.u_id, r.u_allow, r.u_max, uu.rows[0].used);
    // 7. Evaluate consumption against quotas and limits
    const rejection = decide(units, account, user);
    // 8. If accepted, update the usage counters for both account and user
    if (!rejection) {
        await c.query('UPDATE account_usage SET used = used + $3 WHERE account_id = $1 AND month = $2', [
            accountId,
            month,
            units,
        ]);
        await c.query('UPDATE user_usage SET used = used + $3 WHERE user_id = $1 AND month = $2', [
            userId,
            month,
            units,
        ]);
        for (const s of [account, user]) {
            s.used += units;
            s.remaining = Math.max(0, s.monthlyAllowance - s.used);
        }
    }
    const decision = {
        accepted: !rejection,
        requestId,
        userId,
        units,
        month,
        rejection,
        account,
        user,
    };
    // 9. Persist the request decision history for audit and idempotency replays
    await c.query(`INSERT INTO requests
       (account_id, user_id, request_id, units, month, accepted, reject_level, reject_rule, decision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        accountId,
        userId,
        requestId,
        units,
        month,
        decision.accepted,
        rejection?.level ?? null,
        rejection?.rule ?? null,
        JSON.stringify(decision),
    ]);
    return { decision, replayed: false };
}
//# sourceMappingURL=consume.js.map