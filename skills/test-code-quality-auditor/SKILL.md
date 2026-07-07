---
name: wicked-testing-test-code-quality-auditor
context: fork
description: |
  Audits the TEST code itself — not the SUT. Detects assertion-free tests,
  tautological assertions, try/catch swallowing, shared-state bleed,
  hardcoded sleeps, nondeterministic seeds, duplicated beforeEach sprawl,
  slow-per-assertion ratios, and dead tests. Writes a ranked finding list
  and records a CONDITIONAL or FAIL verdict keyed to severity. This is the
  "who watches the watchmen" agent — complements flaky-test-hunter, which
  focuses on runtime behavior rather than static smells.

  Use when: test code review, "our tests are green but they don't catch
  anything", assertion-coverage audit, test-suite decay triage.

  <example>
  Context: Suite is 4000 tests, all green, but a prod regression slipped
  through. Reviewer wants to know whether the tests are actually asserting.
  user: "Audit tests/ for smells — assertion-free, tautological, sleep-
  based, nondeterministic seeds."
  <commentary>Use test-code-quality-auditor — it scans the test dirs for
  each detector, writes test-quality-audit.md with a ranked top-N, and
  records a verdict. Severe findings (P0 assertion-free) push the verdict
  to FAIL.</commentary>
  </example>
---

# Test Code Quality Auditor

Audits test code for smells that make a suite lie about its effectiveness.
Coverage and kill-rate miss these — a test with zero assertions still
executes every line it touches without catching anything.

## When to engage

- "Our tests are green but a prod regression slipped through"
- Assertion-coverage audit or test-suite decay triage
- Verifying a test suite before onboarding it into CI gates

## Process

1. **Configure** — read `target_dirs:` (default `tests/ __tests__ spec/`),
   `language:`, `severity_floor:` (P0 | P1 | P2, default P2), and
   `top_n:` (default 30) from scenario frontmatter. This skill is
   read-only — it never mutates test code.
2. **Detect** — run all nine detectors in parallel; each writes to
   `detectors/<name>.json` with `file`, `line`, `snippet`, `severity`,
   `rule`:
   - **P0**: assertion-free tests, tautological assertions (`expect(x).toBe(x)`)
   - **P1**: try/catch swallowing, shared-state bleed, hardcoded sleeps,
     nondeterministic seeds
   - **P2**: duplicated beforeEach, slow-per-assertion ratio, dead tests
3. **Skip gracefully** — on missing JUnit report (slow-ratio detector) or
   empty DomainStore history (dead-tests), skip that detector and note
   the partial coverage in the audit narrative; continue with the rest.
4. **Roll up** — apply `severity_floor`; exclude findings below it. One
   task per P0 finding (individual). P1/P2 clustered by rule and file.

`expect.assertions(N)` and `assert_called` patterns are not flagged as
assertion-free — each detector applies language-specific allowlists.

## Verdict

- Any P0 finding → **FAIL** (tests that cannot fail are coverage theatre)
- P1-only findings → **CONDITIONAL**
- P2-only findings → **CONDITIONAL**

## Output

Evidence dir `.wicked-testing/evidence/<run_id>/`: `detectors/*.json`,
`test-quality-audit.md` (findings grouped P0→P1→P2 with file, line,
snippet, and rule), `test-quality-top-n.csv` (columns:
`file,line,rule,severity,snippet,fix_hint`).

Final stdout line:
```
VERDICT={CONDITIONAL|FAIL} REVIEWER=wicked-testing:test-code-quality-auditor RUN_ID={RUN_ID}
```
