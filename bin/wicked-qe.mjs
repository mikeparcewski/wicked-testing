#!/usr/bin/env node
/**
 * bin/wicked-qe.mjs — wicked-qe CLI entry point
 *
 * Parsed with Node.js built-in util.parseArgs (Node 18+) — no extra dependencies.
 * Subcommands: gate
 */

import { parseArgs } from "node:util";
import { runGate } from "../lib/gate.mjs";

const GATE_HELP = `\
wicked-qe gate — record a gate verdict for a test run

Usage:
  wicked-qe gate --project-id <id> --run-id <id> --verdict <verdict> \\
                 --verdict-summary "<text>" [options]

Required:
  --project-id <id>         Project identifier
  --run-id <id>             Test run identifier
  --verdict <verdict>       Gate verdict: PASS | FAIL | CONDITIONAL | SYSTEM_ERROR
  --verdict-summary <text>  Human-readable summary of the verdict

Optional:
  --rationale-ref <path>    Path to rationale document
  --council-run-id <id>     Council session ID (for CONDITIONAL verdicts)
  --mode <mode>             Trigger mode: gate | event | manual | crew_integration (default: gate)
  --dry-run                 Validate and print result without writing to store or emitting events
  -h, --help                Show this help

Exit codes:
  0  PASS
  1  FAIL
  2  CONDITIONAL
  3  SYSTEM_ERROR or invalid invocation
`;

const TOP_HELP = `\
wicked-qe — test quality engineering CLI

Usage:
  wicked-qe <command> [options]

Commands:
  gate    Record a gate verdict for a test run

Options:
  -h, --help     Show this help

Run \`wicked-qe gate --help\` for gate-specific options.
`;

// Parse all args, allowing positionals so the subcommand name lands there.
let positionals, values;
try {
  ({ positionals, values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "project-id":       { type: "string" },
      "run-id":           { type: "string" },
      "verdict":          { type: "string" },
      "verdict-summary":  { type: "string" },
      "rationale-ref":    { type: "string" },
      "council-run-id":   { type: "string" },
      "mode":             { type: "string" },
      "dry-run":          { type: "boolean" },
      "help":             { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  }));
} catch (err) {
  process.stderr.write(`wicked-qe: ${err.message}\n`);
  process.exit(3);
}

const subcommand = positionals[0];

// No subcommand — show top-level help regardless of --help flag
if (!subcommand) {
  process.stdout.write(TOP_HELP);
  process.exit(0);
}

if (subcommand === "gate") {
  // Gate-level --help takes precedence over required-option validation
  if (values["help"]) {
    process.stdout.write(GATE_HELP);
    process.exit(0);
  }

  const projectId      = values["project-id"];
  const runId          = values["run-id"];
  const verdict        = values["verdict"];
  const verdictSummary = values["verdict-summary"];

  const missing = [];
  if (!projectId)      missing.push("--project-id");
  if (!runId)          missing.push("--run-id");
  if (!verdict)        missing.push("--verdict");
  if (!verdictSummary) missing.push("--verdict-summary");

  if (missing.length > 0) {
    process.stderr.write(
      `wicked-qe gate: missing required option(s): ${missing.join(", ")}\n` +
      `Run \`wicked-qe gate --help\` for usage.\n`
    );
    process.exit(3);
  }

  runGate({
    projectId,
    runId,
    verdict,
    verdictSummary,
    rationaleRef:  values["rationale-ref"],
    councilRunId:  values["council-run-id"],
    mode:          values["mode"],
    dryRun:        values["dry-run"] ?? false,
  }).catch((err) => {
    process.stderr.write(`wicked-qe gate: fatal: ${err.message}\n`);
    process.exit(3);
  });

} else {
  process.stderr.write(
    `wicked-qe: unknown command '${subcommand}'\n` +
    `Run \`wicked-qe --help\` for usage.\n`
  );
  process.exit(1);
}
