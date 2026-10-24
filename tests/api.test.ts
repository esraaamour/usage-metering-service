/**
 * @file api.test.ts
 * @description End-to-end API Tests (Vitest).
 * Runs against a live server (API_URL, default http://localhost:3000) using real HTTP calls.
 * Covers the critical guarantees of the metering service:
 *   - API key validation (missing / invalid keys)
 *   - Account isolation (one account cannot see another account's users)
 *   - Quota limits (per-request limits at user and account level)
 *   - Idempotency (retrying the same requestId never double-counts)
 *   - Concurrency (parallel requests never exceed the monthly allowance)
 *   - Plan changes (switching a plan keeps already consumed units)
 *
 * Requirements: the server and database must be running before the tests start.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Base URL of the API under test (override with the API_URL environment variable)
const BASE = process.env.API_URL || 'http://localhost:3000';

// Generic HTTP helper: sends a JSON request (optionally with an API key) and returns status + parsed body
async function call(method: string, path: string, key: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// Generates a unique id (timestamp + random suffix) to avoid collisions between test runs
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Creates a fresh account and returns its API key, so each test group can run in isolation
async function newAccount() {
  const r = await call('POST', '/api/accounts', null, { name: `t-${uid()}` });
  return r.body.apiKey as string;
}

// Shortcut for POST /api/usage/consume; generates a unique requestId unless one is provided
const consume = (k: string | null, user: string, units: number, id = uid()) =>
  call('POST', '/api/usage/consume', k, { userExternalId: user, units, requestId: id });

// Shared API key used by most tests below
let key: string;

// Setup: create one account and register user 'u1' (default Basic plan) before all tests
beforeAll(async () => {
  key = await newAccount();
  await call('POST', '/api/users', key, { externalId: 'u1' });
});

describe('API key validation', () => {
  // No x-api-key header at all
  it('rejects a missing key with 401', async () => {
    expect((await consume(null, 'u1', 1)).status).toBe(401);
  });

  // A key that was never issued (its hash does not exist in the database)
  it('rejects an invalid key with 401', async () => {
    expect((await consume('mk_invalid', 'u1', 1)).status).toBe(401);
  });
});

describe('Account isolation', () => {
  // A second account asks for 'u1', which only exists under the first account => 404
  it('does not let another account see my users', async () => {
    const other = await newAccount();
    expect((await consume(other, 'u1', 1)).status).toBe(404);
  });
});

describe('Limits', () => {
  // Basic plan allows max 20 units per request, so 21 must be rejected and must not change usage
  it('rejects by user per-request limit and consumes nothing', async () => {
    const before = await consume(key, 'u1', 1);
    const r = await consume(key, 'u1', 21);
    expect(r.body.decision.accepted).toBe(false);
    expect(r.body.decision.rejection).toEqual({ level: 'user', rule: 'max_per_request' });
    expect(r.body.decision.user.used).toBe(before.body.decision.user.used);
  });

  // Premium user allows 200 per request, but the account's Starter plan allows only 100 => account limit hits first
  it('rejects by account per-request limit', async () => {
    const plans = (await call('GET', '/api/plans', key)).body.plans;
    const premium = plans.find((p: any) => p.name === 'Premium');
    await call('POST', '/api/users', key, { externalId: 'u2', planId: premium.id });
    const r = await consume(key, 'u2', 150);
    expect(r.body.decision.rejection).toEqual({ level: 'account', rule: 'max_per_request' });
  });
});

describe('Idempotency', () => {
  // Same requestId sent twice: the second call is a replay and returns the stored decision without consuming again
  it('does not count a retry with the same requestId twice', async () => {
    const id = uid();
    const a = await consume(key, 'u1', 5, id);
    const b = await consume(key, 'u1', 5, id);
    expect(a.body.replayed).toBe(false);
    expect(b.body.replayed).toBe(true);
    expect(b.body.decision.user.used).toBe(a.body.decision.user.used);
  });
});

describe('Concurrency', () => {
  // Verifies the row locking in consume.ts: no over-consumption even with simultaneous requests
  it('stays correct under parallel requests', async () => {
    const k = await newAccount();
    await call('POST', '/api/users', k, { externalId: 'c1' });
    // Basic allows 500/month: 60 parallel requests of 10 units, only 50 can fit.
    const results = await Promise.all(
      Array.from({ length: 60 }, () => consume(k, 'c1', 10)),
    );
    const accepted = results.filter((r) => r.body.decision.accepted).length;
    expect(accepted).toBe(50);
  });
});

describe('Plan changes', () => {
  // Changing the user's plan only changes future limits; usage counters must stay untouched
  it('keeps consumed units when the plan changes', async () => {
    const k = await newAccount();
    await call('POST', '/api/users', k, { externalId: 'p1' });
    const first = await consume(k, 'p1', 10);
    const plans = (await call('GET', '/api/plans', k)).body.plans;
    const premium = plans.find((p: any) => p.name === 'Premium');
    await call('PUT', '/api/assignments/users/p1/plan', k, { planId: premium.id });
    const second = await consume(k, 'p1', 1);
    expect(second.body.decision.user.used).toBe(first.body.decision.user.used + 1);
  });
});
