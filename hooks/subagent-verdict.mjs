#!/usr/bin/env node
// SubagentStop hook (non-blocking). Detects a recent acceptance-test-reviewer
// verdict and surfaces it prominently so the user sees it without hunting.
// Contract:
//   - stdin: JSON (SubagentStop event payload)
//   - "recent" = manifest.json mtime within the last 60 seconds
//   - output: one verdict line to stderr, nothing to stdout
//   - always exits 0 — never blocks
// Cross-platform: Node.js built-ins only, no external deps.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// --- stdin ---

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8'); // fd 0 = stdin; portable (native Windows lacks /dev/stdin)
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// --- mostRecentEvidenceDir ---
// Returns the path to the most recently modified subdirectory of evidenceDir,
// or null if the directory is empty or inaccessible.

function mostRecentEvidenceDir(evidenceDir) {
  try {
    const entries = readdirSync(evidenceDir, { withFileTypes: true })
      .filter(e => e.isDirectory());
    if (!entries.length) return null;
    let best = null;
    let bestTime = 0;
    for (const e of entries) {
      try {
        const t = statSync(join(evidenceDir, e.name)).mtimeMs;
        if (t > bestTime) { bestTime = t; best = join(evidenceDir, e.name); }
      } catch { /* skip unreadable dirs */ }
    }
    return best;
  } catch {
    return null;
  }
}

// --- main ---

const SIXTY_SEC_MS = 60 * 1000;

const input = readStdin();
// Normalize cwd across CLIs: same pattern as claim-nudge.mjs.
const cwd = input.cwd || (Array.isArray(input.workspace_roots) && input.workspace_roots[0]) || process.cwd();

try {
  const evidenceDir = join(cwd, '.wicked-testing', 'evidence');
  if (!existsSync(evidenceDir)) process.exit(0);

  const runDir = mostRecentEvidenceDir(evidenceDir);
  if (!runDir) process.exit(0);

  const manifestPath = join(runDir, 'manifest.json');
  if (!existsSync(manifestPath)) process.exit(0);

  // Only surface verdicts that landed in the last 60 seconds — otherwise the
  // subagent that just stopped isn't the one that wrote this manifest.
  const manifestMtime = statSync(manifestPath).mtimeMs;
  if (Date.now() - manifestMtime > SIXTY_SEC_MS) process.exit(0);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const verdict = manifest.verdict || manifest.result;
  if (!verdict) process.exit(0);

  const runId = manifest.run_id || runDir.split('/').pop() || runDir.split('\\').pop() || 'unknown';
  process.stderr.write(`[wicked-testing] Reviewer verdict: ${String(verdict).toUpperCase()} — ${runId}\n`);
} catch {
  // Graceful degradation — never block
}

process.exit(0);
