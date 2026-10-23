# Usage Metering and Quota Service

A backend service that other applications call to track usage and decide whether a user may perform an action. Every request is checked against **two plans at once**: the account plan (shared by all users of the account) and the user plan (individual).

**Core rules**

- Monthly allowance per plan (UTC calendar month)
- Maximum units per request
- A rejected request consumes nothing
- Retries with the same `requestId` never count twice

**Stack:** TypeScript, Node.js, Fastify, PostgreSQL (`pg`), Zod, Docker Compose.

## Run with Docker

```bash
docker compose up --build -d
docker compose logs -f app
```

The service listens on `http://localhost:3000`. The database schema and the predefined plans are created automatically on startup. To reset everything: `docker compose down -v`.

## Predefined plans

| Scope   | Name    | Monthly allowance | Max per request |
|---------|---------|-------------------|-----------------|
| account | Starter | 10,000            | 100             |
| account | Pro     | 1,000,000         | 1,000           |
| user    | Basic   | 500               | 20              |
| user    | Premium | 5,000             | 200             |

New accounts start on Starter, new users on Basic. Predefined plans are read-only.

## API

All routes except `POST /api/accounts` require the header `x-api-key`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/accounts` | Create an account (returns the API key, shown once) |
| POST | `/api/users` | Register a user under the calling account |
| GET | `/api/plans` | List predefined and custom plans |
| POST | `/api/plans` | Create a custom plan |
| PATCH | `/api/plans/:id` | Update a custom plan |
| PUT | `/api/assignments/account/plan` | Assign a plan to the account |
| PUT | `/api/assignments/users/:userId/plan` | Assign a plan to a user |
| POST | `/api/usage/consume` | Check and consume units |

### Example

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app"}'

curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"externalId": "user_1"}'

curl -X POST http://localhost:3000/api/usage/consume \
  -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"userExternalId": "user_1", "units": 10,

## Tests

```bash
docker compose up -d
npm test
```

The suite covers API key validation, account isolation, user and account limits, idempotent retries, concurrent requests, and plan changes keeping consumed units. Month rollover is not covered by automated tests (it needs a controllable clock).

## Load test

```bash
docker compose up -d
./loadtest/run.sh
```

The script creates an account on the Pro plan with 10 Premium users, then sends POST `/api/usage/consume` with a unique `requestId` per request (20 connections, 10 seconds, autocannon). Requires `jq`.

**Result (local machine, Docker on WSL2):** about 71 requests/second, median latency 270 ms, 99th percentile 885 ms, no errors.

**Bottleneck:** every consume locks the account usage row inside a transaction, so requests for the same account are serialized. The test sends all load to one account, which is the worst case. Correctness is preserved (the concurrency test confirms exactly the allowed number of requests are accepted). Different accounts do not block each other, so throughput scales with the number of accounts.

**Possible improvements:** shorten the transaction, batch usage updates, or shard the counter per account (at the cost of more complex limit checks).
## Usage and history

bash
# Consumed and remaining units, plus current plans, for the account and each user
curl "http://localhost:3000/api/usage?month=2026-10" -H "x-api-key: $KEY"

# Request outcomes, newest first, with pagination and optional filters
curl "http://localhost:3000/api/usage/history?month=2026-10&userId=user_1&limit=20&offset=0" -H "x-api-key: $KEY"


month is optional (defaults to the current UTC month) and lets callers view previous months. History returns total, limit, offset and items (each with accepted and, for rejections, the level and rule).

## Example client

docker compose up --build starts PostgreSQL, the service, and the example client. The client waits for the service healthcheck, runs the scenario, prints the decisions and remaining allowances, and exits. To see its output:

bash
docker compose logs client


To run it again against the running service: docker compose run --rm client, or node client.js locally.

The scenario: one account with two users on different plans (alice on Basic, bob on Premium), an accepted request, an idempotent retry, a rejection by the user limit, a rejection by the account limit, and a plan switch that changes what alice can do without changing the client code.

## Product assumptions

- Units are positive whole numbers, and there is a single resource.
- A new account starts on Starter and a new user on Basic.
- Each month is the UTC calendar month; usage rows start at zero for each new month and past months stay queryable.
- Plan changes apply to the next request. Switching plans keeps consumed units and does not grant a fresh allowance.
- If a plan's allowance drops below existing usage, remaining shows 0 and further consumption is rejected at that level.
- When several rules fail, the reported rejection follows a fixed order: per-request limits first (account, then user), then monthly allowances (account, then user).
- Reusing a requestId with the same user and units returns the stored decision (replayed: true). Reusing it with a different user or amount returns 409 request_id_conflict.
- Rejected requests are recorded in history but consume nothing.

## Tests

bash
docker compose up -d
npm test


Covers API key validation, account isolation, user and account limits, idempotent retries, concurrent requests, and plan changes keeping consumed units. Month rollover is not covered by automated tests because it needs a controllable clock.

## Load test

bash
docker compose up -d
./loadtest/run.sh


Requires jq and Node.js (autocannon runs via npx). The script creates an account on the Pro plan with 10 Premium users, then sends POST /api/usage/consume with a unique requestId per request (20 connections, 10 seconds).

*Result (local machine, Docker on WSL2):* about 71 requests/second, median latency 270 ms, 99th percentile 885 ms, no errors.

*Bottleneck:* every consume locks the account usage row inside a transaction, so requests for the same account are serialized. The test sends all load to one account, which is the worst case. Correctness is preserved (the concurrency test confirms exactly the allowed number of requests are accepted). Different accounts do not block each other.

*Possible improvements:* shorten the transaction, or shard the account counter (at the cost of more complex limit checks). Not implemented, to keep the accounting simple and correct.
