// The one provenance field a live summary or Round Audit aggregate may be
// told to pool across (#279). The Decision Model experiment (#274) pools
// its live passes by arm, and the arm is a configured versus unconfigured
// `decision` role — exactly a routing difference, which both readers refuse
// by default. `--allow-differs=routing` names that one field; every other
// field the protocol fixes stays refused, and the output says in its
// provenance which field was let through and what each set held.

import type { Validation } from './artifacts.ts'

/** The fields a caller may allow to differ. Routing alone: the arm marker. */
export const ALLOWABLE_DIFFERENCES = ['routing'] as const

export type AllowedDifference = (typeof ALLOWABLE_DIFFERENCES)[number]

/** What an output records of a field it was allowed to pool across: each set's value, in set order. */
export interface AllowedDifferenceRecord {
  readonly field: AllowedDifference
  readonly values: readonly { readonly setId: string; readonly value: string }[]
}

/** Parse the `--allow-differs` value: exactly one allowable field name. */
export function parseAllowDiffers(value: string): Validation<AllowedDifference> {
  if ((ALLOWABLE_DIFFERENCES as readonly string[]).includes(value)) return { ok: true, value: value as AllowedDifference }
  return {
    ok: false,
    errors: [`--allow-differs names the one field that may differ, and only ${ALLOWABLE_DIFFERENCES.join(', ')} may (got "${value}")`],
  }
}

/** The header line an output prints for a field it pooled across. */
export function allowedDifferenceLine(record: AllowedDifferenceRecord): string {
  return `- ${record.field} differs, pooled by --allow-differs=${record.field}: ${record.values.map((entry) => `${entry.setId}=${entry.value}`).join(', ')}`
}
