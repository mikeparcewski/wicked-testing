// Phrases that count as an unverified "done / it passes" claim.
// Deliberately conservative: future-tense ("will run") must NOT match.
export const CLAIM_RE =
  /\b(tests?\s+pass(ed|ing)?|all\s+green|it\s+works(\s+now)?|shipped|done\b[^.]{0,40}\b(verified|passing|works)|verified\s+(it\s+)?(works|passes))\b/i;

/**
 * @param {{enabled:boolean, lastAssistantText:string, hasAcceptanceVerdict:boolean}} ctx
 * @returns {boolean} whether to surface the one-line nudge
 */
export function shouldNudge(ctx) {
  if (!ctx || ctx.enabled !== true) return false;
  if (ctx.hasAcceptanceVerdict === true) return false;
  return CLAIM_RE.test(ctx.lastAssistantText || '');
}
