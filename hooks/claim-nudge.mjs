#!/usr/bin/env node
// Stop hook (opt-in). Contract confirmed from wicked-garden stop.py and Claude
// Code hooks behavior:
//   - stdin: JSON { transcript_path, session_id, cwd }
//   - non-blocking nudge = write to stderr and exit 0
//   - NEVER emit {"decision":"block"} — that forces continuation
// If stdin is missing cwd, we default to process.cwd().

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { shouldNudge } from './claim-nudge.decision.mjs';

// --- stdin ---

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8'); // fd 0 = stdin; portable (native Windows lacks /dev/stdin)
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// --- isEnabled ---

function isEnabled(cwd) {
  try {
    const configPath = join(cwd, '.wicked-testing', 'config.json');
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    return cfg.claim_nudge === true;
  } catch {
    return false;
  }
}

// --- lastAssistantText ---
// Reads a JSONL transcript, finds the last assistant message, returns its text.
// Handles both {role,content} and {message:{role,content}} shapes.
// content may be a string or an array of content blocks.

function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n');
    let lastText = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try { entry = JSON.parse(trimmed); } catch { continue; }

      // Unwrap {message:{role,content}} shape
      const msg = (entry.message && entry.message.role) ? entry.message : entry;
      if (msg.role !== 'assistant') continue;

      const content = msg.content;
      if (typeof content === 'string') {
        lastText = content;
      } else if (Array.isArray(content)) {
        // Array of content blocks — concatenate text blocks
        lastText = content
          .map(b => (b && b.type === 'text' && typeof b.text === 'string') ? b.text : '')
          .join(' ')
          .trim();
      }
    }
    return lastText;
  } catch {
    return '';
  }
}

// --- hasRecentAcceptanceVerdict ---
// Reads the JSON canonical ledger at <cwd>/.wicked-testing/verdicts/*.json.
// An acceptance-pipeline verdict is identified by reviewer === 'acceptance-test-reviewer'
// (confirmed from skills/acceptance-testing/SKILL.md, line: reviewer: 'acceptance-test-reviewer').
// The timestamp field is created_at (ISO8601).
// "Recent" = within the last 30 minutes.

const THIRTY_MIN_MS = 30 * 60 * 1000;

function hasRecentAcceptanceVerdict(cwd) {
  const verdictDir = join(cwd, '.wicked-testing', 'verdicts');
  if (!existsSync(verdictDir)) return false;
  try {
    const cutoff = new Date(Date.now() - THIRTY_MIN_MS).toISOString();
    const files = readdirSync(verdictDir).filter(f => f.endsWith('.json') && !f.includes('.tmp.'));
    for (const file of files) {
      try {
        const v = JSON.parse(readFileSync(join(verdictDir, file), 'utf8'));
        // Skip soft-deleted records
        if (v.deleted) continue;
        // Acceptance-origin signal: reviewer field set by the acceptance pipeline
        if (v.reviewer !== 'acceptance-test-reviewer') continue;
        // Recency check using created_at
        if (v.created_at && v.created_at >= cutoff) return true;
      } catch {
        // Unreadable/corrupt JSON — skip this file
      }
    }
  } catch {
    // readdirSync failure (permissions, etc.) — fail open
  }
  return false;
}

// --- main ---

const input = readStdin();
const cwd = input.cwd || process.cwd();

const enabled = isEnabled(cwd);
if (!enabled) process.exit(0);

const text = lastAssistantText(input.transcript_path || '');
const hasAcceptanceVerdict = hasRecentAcceptanceVerdict(cwd);

if (shouldNudge({ enabled, lastAssistantText: text, hasAcceptanceVerdict })) {
  process.stderr.write(
    'wicked-testing: you claimed the tests pass, but nothing re-derived it. ' +
    'Run `/wicked-testing:acceptance-testing <scenario>` for an independent verdict.\n'
  );
}

process.exit(0);
