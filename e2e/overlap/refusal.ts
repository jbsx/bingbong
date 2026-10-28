// A run a host refused for credit (owner, 2026-10-28: "when a run ends mid
// run due to insufficient credit on baseten or jev, we dont throw away any
// run data"): the account is spent, not busy. A 429 is rate limiting and is
// run again (overlap-gate.ts `limitedIn`); a refusal for credit is
// persistent, so the point it met is neither red nor green and the gate
// stops, keeping what it finished. Read from the run's own records: the
// decision log's `jev` (its status, the host's words, every attempt), the
// Planner's `planner-step` spans, and the cell's own words, where the judge's
// refusal lands.

/** A status that names a spent or barred account: 402 Payment Required, 403 Forbidden. */
const CREDIT_STATUSES = new Set([402, 403])
/** The host's words for an account out of credit. */
const CREDIT_WORDS = /\b(credits?|billing|quota|insufficient[ _-]?(funds|balance|credits?)|payment required|out of funds)\b/i

interface DecisionLine {
  readonly jev?: { readonly model?: string; readonly httpStatus?: number; readonly message?: string; readonly attempts?: readonly { readonly model?: string; readonly host?: string; readonly httpStatus?: number }[] }
}
interface PerfLine {
  readonly stage?: string
  readonly detail?: { readonly model?: string; readonly httpStatus?: number; readonly reason?: string }
}

/** The records a refusal is read from: the run's decision and perf lines, and the words its cell ended in. */
export interface RefusalSources {
  readonly decision: readonly unknown[]
  readonly perf: readonly unknown[]
  readonly why?: string
}

const refusedStatus = (status: number | undefined): boolean => status !== undefined && CREDIT_STATUSES.has(status)

/** Why a host refused the run for credit, in words, or null when none did. A 429 is never one. */
export function creditRefusal(sources: RefusalSources): string | null {
  for (const line of sources.decision as DecisionLine[]) {
    const jev = line.jev
    if (jev === undefined) continue
    if (refusedStatus(jev.httpStatus) || (jev.httpStatus !== 429 && jev.message !== undefined && CREDIT_WORDS.test(jev.message))) {
      return `the Decision Model ${jev.model ?? ''} answered ${jev.httpStatus ?? 'a refusal'}${jev.message !== undefined ? `: ${jev.message.slice(0, 200)}` : ''}`.replace(/\s+/g, ' ')
    }
    const attempt = jev.attempts?.find((item) => refusedStatus(item.httpStatus))
    if (attempt !== undefined) return `the Decision Model ${attempt.model ?? ''} at ${attempt.host ?? 'its host'} answered ${attempt.httpStatus}`.replace(/\s+/g, ' ')
  }
  for (const span of sources.perf as PerfLine[]) {
    if (span.stage === 'planner-step' && refusedStatus(span.detail?.httpStatus)) return `the Planner ${span.detail?.model ?? ''} answered ${span.detail?.httpStatus}`.replace(/\s+/g, ' ')
  }
  // The judge's refusal ends the run in words (judgeMeaning's "the judge was unavailable: …").
  if (sources.why !== undefined && !/\b429\b/.test(sources.why) && /unavailable|refused|failed/i.test(sources.why) && (CREDIT_WORDS.test(sources.why) || /\b40[23]\b/.test(sources.why))) return sources.why
  return null
}

/** Each JSON line of the logs whose file name starts with `prefix`. */
export function logLines(logs: Readonly<Record<string, string>> | undefined, prefix: string): unknown[] {
  return Object.entries(logs ?? {})
    .filter(([file]) => file.startsWith(prefix))
    .flatMap(([, text]) =>
      text.split('\n').flatMap((line) => {
        if (line.trim() === '') return []
        try {
          return [JSON.parse(line) as unknown]
        } catch {
          return []
        }
      }),
    )
}
