/**
 * tests/unit/context-md-validator.test.mjs
 *
 * The anti-self-grading guarantee, proven in code.
 *
 * lib/context-md-validator.mjs is the code-enforced reviewer-isolation leak
 * guard: it must REJECT any prejudicial content (prior verdicts, run ids,
 * pass/fail counts, historical outcomes, executor reasoning) before it can be
 * written into a reviewer's context.md, and it must ACCEPT clean cold-knowledge
 * (domain rules, tool quirks) so legitimate context still flows.
 *
 * Each PREJUDICIAL_PATTERNS entry in the module is exercised by at least one
 * rejection case below — if a future edit weakens a pattern, a test goes red.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validateContextMd,
  writeContextMd,
  buildReviewerContext,
  ContextContaminationError,
} from "../../lib/context-md-validator.mjs";

// --- REJECTION cases: one per prejudicial pattern (the ~12 leak shapes) ---

const PREJUDICIAL_SAMPLES = [
  { pattern: "verdict_assignment",        text: "The reviewer verdict: PASS was recorded." },
  { pattern: "verdict_assignment(FAIL)",  text: 'verdict = "FAIL" on the prior attempt.' },
  { pattern: "standalone_verdict_line",   text: "status: INCONCLUSIVE" },
  { pattern: "run_id_reference",          text: "run_id: 8ea1a56f-1b6a-4c9b-9a2f-2b8b3c3e5d7a" },
  { pattern: "historical_reference",      text: "On the previous run the assertion held." },
  { pattern: "historical_reference(prior)", text: "The prior verdict was favorable." },
  { pattern: "historical_verb",           text: "Historical pass behavior suggests this is fine." },
  { pattern: "pass_fail_rate",            text: "This scenario has a 92% pass rate." },
  { pattern: "pass_fail_count",           text: "Look at the fail count for context." },
  { pattern: "scenario_cross_reference",  text: "scenario login-bad-creds passed earlier today." },
  { pattern: "executor_reasoning_leak",   text: "The executor expected the row to be stored." },
  { pattern: "this_run_outcome",          text: "Note that this run passed cleanly." },
  { pattern: "counted_history",           text: "It has passed 7 times in a row." },
  { pattern: "consecutive_history",       text: "There were 3 consecutive pass runs." },
];

for (const sample of PREJUDICIAL_SAMPLES) {
  test(`REJECTS prejudicial content — ${sample.pattern}`, () => {
    const { ok, reasons } = validateContextMd(sample.text);
    assert.equal(ok, false, `expected rejection for: ${sample.text}`);
    assert.ok(reasons.length >= 1, "must report at least one reason");
    assert.ok(reasons[0].pattern, "reason must name the matched pattern");
    assert.ok(reasons[0].match, "reason must include the offending match");
  });
}

// --- ACCEPTANCE: clean cold knowledge must pass ---

test("ACCEPTS clean cold domain knowledge", () => {
  const clean = [
    "# Domain knowledge",
    "",
    "WCAG 2.1 AA requires a contrast ratio of at least 4.5:1 for body text.",
    "The payments sandbox returns HTTP 402 for the test card 4000000000000002.",
    "Timestamps in this API are RFC3339 with millisecond precision.",
    "The login endpoint rate-limits at 5 attempts per minute per IP.",
  ].join("\n");
  const { ok, reasons } = validateContextMd(clean);
  assert.equal(ok, true, `clean content must be accepted; got reasons: ${JSON.stringify(reasons)}`);
  assert.equal(reasons.length, 0);
});

test("ACCEPTS the word 'pass' in legitimate non-prejudicial context (no false positive)", () => {
  // The module docstring calls out this exact false-positive risk.
  const clean = "The WCAG AA pass criterion is a contrast ratio of 4.5:1.";
  const { ok } = validateContextMd(clean);
  assert.equal(ok, true, "'pass criterion' must NOT trip a verdict pattern");
});

test("empty / non-string content is trivially non-prejudicial", () => {
  assert.equal(validateContextMd("").ok, true);
  assert.equal(validateContextMd(null).ok, true);
  assert.equal(validateContextMd(undefined).ok, true);
});

// --- extraForbidden: catch the current run UUID injected dynamically ---

test("REJECTS the current run_id when supplied via extraForbidden", () => {
  const runId = "11111111-2222-3333-4444-555555555555";
  const body = `Cold knowledge only.\nReference token ${runId} smuggled in.`;
  const { ok, reasons } = validateContextMd(body, { extraForbidden: [runId] });
  assert.equal(ok, false);
  assert.ok(reasons.some((r) => r.pattern === "extra_forbidden" && r.match === runId));
});

// --- writeContextMd: refuses to write on contamination, writes when clean ---

test("writeContextMd throws ContextContaminationError and writes nothing on dirty input", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-ctx-"));
  try {
    const path = join(dir, "context.md");
    assert.throws(
      () => writeContextMd(path, "verdict: PASS recorded last time"),
      (err) => {
        assert.ok(err instanceof ContextContaminationError);
        assert.equal(err.code, "ERR_CONTEXT_CONTAMINATION");
        return true;
      }
    );
    assert.equal(existsSync(path), false, "no file may be written on contamination");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeContextMd writes clean content to disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-ctx-"));
  try {
    const path = join(dir, "context.md");
    const clean = "The API returns ISO-8601 timestamps in UTC.";
    writeContextMd(path, clean);
    assert.equal(readFileSync(path, "utf8"), clean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- buildReviewerContext: the sanctioned assembly path ---

test("buildReviewerContext refuses contaminated brain knowledge (rejected, not written)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-ctx-"));
  try {
    const res = buildReviewerContext({
      evidenceDir: dir,
      brainKnowledge: "Heads up: this scenario passed 4 times already.",
    });
    assert.equal(res.written, false);
    assert.equal(res.rejected, true);
    assert.ok(Array.isArray(res.reasons) && res.reasons.length >= 1);
    assert.equal(existsSync(join(dir, "context.md")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReviewerContext writes clean knowledge and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-ctx-"));
  try {
    const knowledge = "Contrast threshold for AA large text is 3:1.";
    const res = buildReviewerContext({ evidenceDir: dir, brainKnowledge: knowledge });
    assert.equal(res.written, true);
    assert.ok(res.path.endsWith("context.md"));
    assert.equal(readFileSync(res.path, "utf8"), knowledge);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReviewerContext is a no-op when brain knowledge is empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-ctx-"));
  try {
    assert.equal(buildReviewerContext({ evidenceDir: dir, brainKnowledge: "" }).written, false);
    assert.equal(buildReviewerContext({ evidenceDir: dir, brainKnowledge: "   " }).written, false);
    assert.equal(existsSync(join(dir, "context.md")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
