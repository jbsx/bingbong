// The Endpoint's Settings bounds and defaults, on their own so the
// endpointer — and the replay scripts Node runs by type stripping — import
// them without settings.ts's extensionless graph. settings.ts re-exports them.

/**
 * Pause-cap slider bounds (#357, the endpoint-delay slider of #37): the
 * silence that ends an Utterance whatever the turn check says.
 */
export const PAUSE_CAP_MS_MIN = 200
export const PAUSE_CAP_MS_MAX = 4_000
/**
 * 2 s (#357, ADR 0076 amendment 2026-10-20): the turn check fires the
 * Endpoint at a short pause when the words read finished, so the cap only
 * bounds a thinking pause. It was a plain silence timer before: 300 ms
 * (#324) cut a sentence at every breath, 700 ms (847d039) still made the
 * owner pace themselves.
 */
export const PAUSE_CAP_MS_DEFAULT = 2_000
/**
 * Resumption-merge window bounds (#60/#59): silence held after the endpoint
 * before the utterance submits. 0 disables the hold — the endpoint submits
 * directly.
 */
export const RESUMPTION_MERGE_MS_MIN = 0
export const RESUMPTION_MERGE_MS_MAX = 3_000
/** 0 on this branch (ADR 0076): no hold after the Endpoint. (`main` holds 1,500 ms.) */
export const RESUMPTION_MERGE_MS_DEFAULT = 0
