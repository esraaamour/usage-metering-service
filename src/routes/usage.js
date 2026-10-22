app.get('/usage', async (req) => {
    const { accountId } = await authenticate(req);
    // Get current UTC month string (YYYY-MM-DD)
    const monthResult = await pool.query(`SELECT to_char(date_trunc('month', now() AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS month`);
    const month = monthResult.rows[0].month;
    // Fetch account usage details with its assigned plan and current month consumption
    const accountResult = await pool.query(`SELECT a.id, a.name, a.plan_id, p.monthly_allowance, COALESCE(au.used, 0) AS used
       FROM accounts a
       LEFT JOIN plans p ON a.plan_id = p.id
       LEFT JOIN account_usage au ON au.account_id = a.id AND au.month = $2
       WHERE a.id = $1`, [accountId, month]);
    const acc = accountResult.rows[0];
    // Fetch all users under this account along with their respective plans and usage
    const usersResult = await pool.query(`SELECT u.id, u.external_id, u.plan_id, p.monthly_allowance, COALESCE(uu.used, 0) AS used
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       LEFT JOIN user_usage uu ON uu.user_id = u.id AND uu.month = $2
       WHERE u.account_id = $1`, [accountId, month]);
    return {
        month,
        account: {
            id: acc.id,
            name: acc.name,
            planId: acc.plan_id,
            monthlyAllowance: toNum(acc.monthly_allowance),
            currentPeriodConsumed: toNum(acc.used),
        },
        users: usersResult.rows.map((u) => ({
            id: u.id,
            userId: u.external_id,
            planId: u.plan_id,
            monthlyAllowance: toNum(u.monthly_allowance),
            currentPeriodConsumed: toNum(u.used),
        })),
    };
});
export {};
//# sourceMappingURL=usage.js.map