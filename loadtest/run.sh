#!/bin/bash
# Load test: many users under ONE account (worst case: account row lock).
BASE=${API_URL:-http://localhost:3000}
KEY=$(curl -s -X POST $BASE/api/accounts -H "Content-Type: application/json" \
  -d "{\"name\":\"load-$(date +%s)\"}" | jq -r .apiKey)
# Pro plan so the monthly allowance is not exhausted during the test.
PRO=$(curl -s $BASE/api/plans -H "x-api-key: $KEY" | jq -r '.plans[] | select(.name=="Pro") | .id')
curl -s -X PUT $BASE/api/assignments/account/plan -H "Content-Type: application/json" \
  -H "x-api-key: $KEY" -d "{\"planId\":\"$PRO\"}" > /dev/null
PREMIUM=$(curl -s $BASE/api/plans -H "x-api-key: $KEY" | jq -r '.plans[] | select(.name=="Premium") | .id')
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -X POST $BASE/api/users -H "Content-Type: application/json" -H "x-api-key: $KEY" \
    -d "{\"externalId\":\"load_$i\",\"planId\":\"$PREMIUM\"}" > /dev/null
done
# Unique requestId per request via autocannon's [<id>] placeholder.
npx autocannon -c 20 -d 10 -m POST \
  -H "Content-Type=application/json" -H "x-api-key=$KEY" \
  -b '{"userExternalId":"load_1","units":1,"requestId":"[<id>]"}' \
  $BASE/api/usage/consume
