---
name: smoke-test-execution
description: |
  Zero-dependency smoke test — proves the execution pipeline fires real commands
  and captures real output. Uses only curl + python3 against httpbin.org.
  Run this first to confirm wicked-testing itself is working.
category: api
tools:
  required: [curl, python3]
  optional: []
difficulty: basic
timeout: 30
---

# Smoke Test — Execution Pipeline

Validates that the wicked-testing execution pipeline actually runs commands,
captures real output, and records accurate verdicts.
No test framework, no installed tools — just curl and Python.

## Setup

```bash
export SMOKE_URL="https://httpbin.org"
```

## Steps

### Step 1: Confirm curl fires and returns HTTP 200

```bash
STATUS=$(curl -sfL --max-time 10 -o /dev/null -w '%{http_code}' "${SMOKE_URL}/get")
echo "HTTP status: ${STATUS}"
test "${STATUS}" = "200"
```

**Expect**: Exit code 0, output contains `HTTP status: 200`

### Step 2: Confirm JSON response parsing works

```bash
curl -sfL --max-time 10 "${SMOKE_URL}/get" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'url' in d, 'Missing url field'
assert 'headers' in d, 'Missing headers field'
print('OK: url =', d['url'])
print('OK: headers present, count =', len(d['headers']))
"
```

**Expect**: Exit code 0, both `OK:` lines printed

### Step 3: Confirm POST with JSON body works

```bash
curl -sfL --max-time 10 -X POST "${SMOKE_URL}/post" \
  -H "Content-Type: application/json" \
  -d '{"wicked":"testing","version":"smoke"}' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
body = d.get('json') or {}
assert body.get('wicked') == 'testing', 'Missing wicked field'
assert body.get('version') == 'smoke', 'Missing version field'
print('OK: POST round-trip verified')
"
```

**Expect**: Exit code 0, `OK: POST round-trip verified` printed

### Step 4: Confirm negative path detection (expected 404)

```bash
STATUS=$(curl -sL --max-time 10 -o /dev/null -w '%{http_code}' "${SMOKE_URL}/status/404")
echo "Expected-404 status: ${STATUS}"
python3 -c "
import sys
s = '${STATUS}'
assert s == '404', f'Expected 404, got {s}'
print('OK: 404 correctly detected')
"
```

**Expect**: Exit code 0, `OK: 404 correctly detected`

## Cleanup

No cleanup required — httpbin.org is stateless.

## What a PASS means

Every step exited 0 and produced the expected output. The execution pipeline:
- Runs real shell commands (not simulated)
- Captures and parses real HTTP responses
- Correctly distinguishes pass (200/expected-404) from fail
- Records accurate evidence

If this scenario fails, check that curl and python3 are on PATH.
