#!/bin/bash
# =============================================================================
# @file load-test.sh
# @description Load Test for the /api/usage/consume endpoint.
# Simulates the worst-case contention scenario: many concurrent requests hitting ONE account,
# so every request competes for the same account_usage row lock (FOR UPDATE in consume.ts).
# Steps: create a fresh account -> upgrade it to the Pro plan -> register 10 users on the
# Premium plan -> fire concurrent consume requests with autocannon and print the results.
#
# Requirements: curl, jq, npx (autocannon is downloaded on demand), a running server.
# Usage:        ./load-test.sh                       (defaults to http://localhost:3000)
#               API_URL=http://host:3000 ./load-test.sh
# =============================================================================

# Base URL of the API (override with the API_URL environment variable)
BASE=${API_URL:-http://localhost:3000}

# 1. Create a new account (unique name via timestamp) and capture its API key from the response
KEY=$(curl -s -X POST $BASE/api/accounts -H "Content-Type: application/json" \
  -d "{\"name\":\"load-$(date +%s)\"}" | jq -r .apiKey)

# 2. Find the predefined Pro plan and assign it to the account,
# so the monthly allowance is not exhausted during the test.
PRO=$(curl -s $BASE/api/plans -H "x-api-key: $KEY" | jq -r '.plans[] | select(.name=="Pro") | .id')
curl -s -X PUT $BASE/api/assignments/account/plan -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" -d "{\"planId\":\"$PRO\"}" > /dev/null

# 3. Find the predefined Premium user plan (highest user limits)
PREMIUM=$(curl -s $BASE/api/plans -H "x-api-key: $KEY" | jq -r '.plans[] | select(.name=="Premium") | .id')

# 4. Register 10 users (load_1 ... load_10) under the account, all on the Premium plan
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -X POST $BASE/api/users -H "Content-Type: application/json" -H "x-api-key: $KEY" \
    -d "{\"externalId\":\"load_$i\",\"planId\":\"$PREMIUM\"}" > /dev/null
done

# 5. Run the load test: 20 concurrent connections for 10 seconds, POSTing to /consume.
# Unique requestId per request via autocannon's [<id>] placeholder (avoids idempotency replays).
npx autocannon -c 20 -d 10 -m POST \
  -H "Content-Type=application/json" -H "x-api-key=$KEY" \
  -b '{"userExternalId":"load_1","units":1,"requestId":"[<id>]"}' \
  $BASE/api/usage/consume
