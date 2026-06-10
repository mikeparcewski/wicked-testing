import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNudge, CLAIM_RE } from './claim-nudge.decision.mjs';

test('nudges when a pass-claim has no acceptance verdict', () => {
  assert.equal(shouldNudge({ enabled: true, lastAssistantText: 'All tests pass, we are done.', hasAcceptanceVerdict: false }), true);
});

test('silent when disabled, even on a claim with no verdict', () => {
  assert.equal(shouldNudge({ enabled: false, lastAssistantText: 'tests pass', hasAcceptanceVerdict: false }), false);
});

test('silent when an acceptance verdict is on record', () => {
  assert.equal(shouldNudge({ enabled: true, lastAssistantText: 'tests pass', hasAcceptanceVerdict: true }), false);
});

test('silent when no claim was made', () => {
  assert.equal(shouldNudge({ enabled: true, lastAssistantText: 'I refactored the parser.', hasAcceptanceVerdict: false }), false);
});

test('claim regex matches the documented phrases', () => {
  for (const s of ['tests pass', 'all green', 'it works now', 'shipped', 'done — verified']) {
    assert.match(s, CLAIM_RE);
  }
  assert.doesNotMatch('I will run the tests next', CLAIM_RE);
});
