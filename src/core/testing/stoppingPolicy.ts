/**
 * The vocabulary a default Answer must never contain (#203, ADR 0038),
 * in one place so the tests that enforce the outcome-first stopping
 * policy cannot quietly disagree about what it forbids. Three copies of
 * this had already drifted apart — one omitted provider errors, another
 * only caught a numbered round — and a policy whose checks disagree is
 * not a policy.
 *
 * Test-only, and deliberately not exported from the pipeline: the
 * production wording is asserted against these, never generated from
 * them.
 */

/**
 * Resource accounting: the internal limits and provider failures a
 * Spoken Rendering or Card may never announce by default (#203/AC1).
 * `blocker` help text is the deliberate exception the policy allows —
 * it names a wall and a host, none of which appears here.
 */
export const RESOURCE_ACCOUNTING =
  /budget|deadline|time limit|ran out|work limit|tool.?round|round \d|timed? out|timeout|provider|retry|retries|exhaust|error/i

/**
 * Endings the policy rules out however the Answer was worded
 * (#203/AC3): an implied exhaustive search, work implied to continue
 * after the Run ended, and the routine hand-back of the assistant's own
 * work to the user.
 */
export const FORBIDDEN_ENDINGS =
  /keep looking|exhaustive|searched everywhere|in the background|still (?:working|searching|running)|check back|let me know if you want me to/i
