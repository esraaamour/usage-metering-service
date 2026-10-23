const BASE = process.env.API_URL || 'http://localhost:3000';

async function call(method, path, apiKey, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function show(title, out) {
  const d = out.decision;
  const rej = d.rejection ? `REJECTED by ${d.rejection.level} (${d.rejection.rule})` : 'ACCEPTED';
  console.log(`\n== ${title}`);
  console.log(`   ${rej} | units=${d.units} | replayed=${out.replayed}`);
  console.log(`   account: used ${d.account.used}, remaining ${d.account.remaining}, max/request ${d.account.maxPerRequest}`);
  console.log(`   user:    used ${d.user.used}, remaining ${d.user.remaining}, max/request ${d.user.maxPerRequest}`);
}

async function main() {
  const run = Date.now();

  const account = await call('POST', '/api/accounts', null, { name: `demo-${run}` });
  const key = account.apiKey;
  console.log(`Account created: ${account.id}`);

  const { plans } = await call('GET', '/api/plans', key);
  const basic = plans.find((p) => p.name === 'Basic' && p.scope === 'user');
  const premium = plans.find((p) => p.name === 'Premium' && p.scope === 'user');
  console.log(`Basic:   ${basic.monthlyAllowance}/month, ${basic.maxPerRequest} per request`);
  console.log(`Premium: ${premium.monthlyAllowance}/month, ${premium.maxPerRequest} per request`);

  await call('POST', '/api/users', key, { externalId: 'alice', planId: basic.id });
  await call('POST', '/api/users', key, { externalId: 'bob', planId: premium.id });
  console.log('Users created: alice (Basic), bob (Premium)');

  const consume = (user, units, id) =>
    call('POST', '/api/usage/consume', key, { userExternalId: user, units, requestId: `${id}-${run}` });

  show('alice consumes 10 units (within Basic limits)', await consume('alice', 10, 'r1'));
  show('alice retries r1 (same requestId, no second deduction)', await consume('alice', 10, 'r1'));
  show('alice consumes 21 units (over her per-request limit)', await consume('alice', 21, 'r2'));
  show('bob consumes 150 units (over the account per-request limit)', await consume('bob', 150, 'r3'));

  await call('PUT', '/api/assignments/users/alice/plan', key, { planId: premium.id });
  console.log('\n>> alice switched from Basic to Premium');
  show('alice consumes 21 units again (now allowed)', await consume('alice', 21, 'r4'));

  console.log('\nDemo finished.');
}

main().catch((e) => {
  console.error('Client failed:', e.message);
  process.exit(1);
});
