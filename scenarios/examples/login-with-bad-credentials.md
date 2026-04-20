---
name: login-with-bad-credentials
description: Verify that invalid login credentials are rejected with HTTP 401
category: api
tools:
  required: [curl]
difficulty: basic
timeout: 30
---

# Login with Bad Credentials

Validates that an authentication endpoint rejects invalid credentials with
the correct HTTP status code. A positive negative-test — the expected outcome
is rejection.

## Setup

```bash
# Using httpbin.org's basic-auth endpoint as a stable public test target
export AUTH_URL="https://httpbin.org/basic-auth/alice/correcthorse"
```

## Steps

### Step 1: Attempt login with wrong credentials (curl)

```bash
STATUS=$(curl -sfL --max-time 10 -o /dev/null -w '%{http_code}' \
  -u "alice:definitelywrong" \
  "${AUTH_URL}" || echo "$?")
echo "Status: ${STATUS}"
test "${STATUS}" = "401"
```

**Expect**: HTTP 401 (exit code 0 means assertion held)

### Step 2: Verify no bypass via empty password (curl)

```bash
STATUS=$(curl -sfL --max-time 10 -o /dev/null -w '%{http_code}' \
  -u "alice:" \
  "${AUTH_URL}" || echo "$?")
echo "Status (empty pw): ${STATUS}"
test "${STATUS}" = "401"
```

**Expect**: HTTP 401

### Step 3: Confirm correct credentials still work (curl)

```bash
STATUS=$(curl -sfL --max-time 10 -o /dev/null -w '%{http_code}' \
  -u "alice:correcthorse" \
  "${AUTH_URL}")
echo "Status (good pw): ${STATUS}"
test "${STATUS}" = "200"
```

**Expect**: HTTP 200 — proves the endpoint works when creds are right

## Cleanup

No artifacts to clean up.
