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
