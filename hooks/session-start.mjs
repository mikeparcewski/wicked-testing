#!/usr/bin/env node
// SessionStart hook (non-blocking). Shows QE project status at session start.
// Contract:
//   - stdin: JSON { cwd?, workspace_roots?, input? }
//   - output: brief status line to stderr, nothing to stdout
//   - always exits 0 — never blocks the session
// Cross-platform: Node.js built-ins only, no external deps.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// --- stdin ---

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8'); // fd 0 = stdin; portable (native Windows lacks /dev/stdin)
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// --- latestVerdict ---
// Finds the most recent non-deleted verdict in the verdicts dir.
// Sorts by created_at ISO field first, falls back to file mtime.

function latestVerdict(verdictDir) {
  if (!existsSync(verdictDir)) return null;
  try {
    const files = readdirSync(verdictDir).filter(f => f.endsWith('.json') && !f.includes('.tmp.'));
    if (!files.length) return null;
    let best = null;
    let bestTime = 0;
    for (const file of files) {
      try {
        const filePath = join(verdictDir, file);
        const v = JSON.parse(readFileSync(filePath, 'utf8'));
        if (v.deleted) continue;
        const t = v.created_at
          ? new Date(v.created_at).getTime()
          : statSync(filePath).mtimeMs;
        if (t > bestTime) { bestTime = t; best = v; }
      } catch { /* skip corrupt or unreadable files */ }
    }
    return best;
  } catch {
    return null;
  }
}

// --- countScenarios ---

function countScenarios(cwd) {
  try {
    const dir = join(cwd, '.wicked-testing', 'scenarios');
    if (!existsSync(dir)) return null;
    return readdirSync(dir).filter(f => f.endsWith('.md')).length;
  } catch {
    return null;
  }
}

// --- main ---

const input = readStdin();
// Normalize cwd across CLIs: same pattern as claim-nudge.mjs.
const cwd = input.cwd || (Array.isArray(input.workspace_roots) && input.workspace_roots[0]) || process.cwd();

try {
  const configPath = join(cwd, '.wicked-testing', 'config.json');
  if (!existsSync(configPath)) process.exit(0);

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const projectName = config.name || config.project_name || config.project || basename(cwd);

  const verdict = latestVerdict(join(cwd, '.wicked-testing', 'verdicts'));
  let verdictPart;
  if (verdict) {
    const dateStr = verdict.created_at
      ? verdict.created_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const label = String(verdict.verdict || verdict.result || '?').toUpperCase();
    const scenario = verdict.scenario_id || verdict.scenario || '';
    verdictPart = scenario
      ? `last verdict: ${label} (${scenario}, ${dateStr})`
      : `last verdict: ${label} (${dateStr})`;
  } else {
    verdictPart = 'last verdict: none';
  }

  const parts = [`[wicked-testing] project: ${projectName}`, verdictPart];

  const scenarioCount = countScenarios(cwd);
  if (scenarioCount !== null) parts.push(`scenarios: ${scenarioCount}`);

  process.stderr.write(parts.join(' | ') + '\n');
} catch {
  // Graceful degradation — never block the session
}

process.exit(0);
