#!/usr/bin/env node
// Aggregate all per-agent report.json files into a single summary.
// Usage: node scripts/dev/evals-summary.mjs iteration-<N>

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const WORKSPACE = join(REPO, ".claude", "skills", "wicked-testing-evals", "workspace");

const iter = process.argv[2] || "iteration-1";
const iterDir = join(WORKSPACE, iter);
if (!existsSync(iterDir)) { console.error(`No iteration: ${iterDir}`); process.exit(1); }

const agents = readdirSync(iterDir).filter(d => {
  try { return statSync(join(iterDir, d)).isDirectory(); } catch { return false; }
});

let totalPass = 0, totalFail = 0, totalSkip = 0;
const rows = [];

for (const agent of agents.sort()) {
  const report = join(iterDir, agent, "report.json");
  if (!existsSync(report)) { rows.push({ agent, status: "no-report" }); continue; }
  const data = JSON.parse(readFileSync(report, "utf8"));
  const pass = data.cases.filter(c => c.status === "pass").length;
  const fail = data.cases.filter(c => c.status === "fail").length;
  const skip = data.cases.filter(c => c.status === "not-run").length;
  totalPass += pass; totalFail += fail; totalSkip += skip;
  rows.push({ agent, pass, fail, skip, total: data.cases.length });
}

console.log(`wicked-testing eval summary — ${iter}\n`);
console.log("| Agent                              | Pass | Fail | Skip |");
console.log("|------------------------------------|------|------|------|");
for (const r of rows) {
  if (r.status === "no-report") {
    console.log(`| ${r.agent.padEnd(34)} |  -   |  -   |  -   |`);
  } else {
    console.log(`| ${r.agent.padEnd(34)} | ${String(r.pass).padStart(4)} | ${String(r.fail).padStart(4)} | ${String(r.skip).padStart(4)} |`);
  }
}
console.log(`\nTotals: ${totalPass} pass, ${totalFail} fail, ${totalSkip} skip`);
console.log(`Overall: ${totalFail === 0 ? "✓ all dispatched cases passed" : "✗ failures present"}`);
process.exit(totalFail > 0 ? 1 : 0);
