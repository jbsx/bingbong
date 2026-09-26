// How a capture set's launches read as routing (#279): one string per role
// per launch, `role=model` or `role=unconfigured (reason)`, the Decision
// Model's role among them when the launch recorded it. The report and the
// Round Audit both compare Passes by this list, and the Decision Model
// experiment's arm is exactly a difference in it — so it is built once,
// here, rather than by each reader. A launch captured before #279 has no
// decision entry and contributes none, so its routing reads as it always did.
//
// No runtime imports: the CLIs run this under Node's type stripping.

import type { LiveLaunchProvenance } from './types.ts'

const ROLE_ORDER = ['orchestrator', 'subagent', 'vision', 'decision'] as const

/** Every distinct role string across the launches, sorted. */
export function launchRoutingOf(launches: readonly Pick<LiveLaunchProvenance, 'roles'>[]): string[] {
  return [
    ...new Set(
      launches.flatMap((launch) =>
        ROLE_ORDER.flatMap((role) => {
          const provenance = launch.roles[role]
          if (provenance === undefined) return []
          return [`${role}=${provenance.configured ? provenance.model : `unconfigured (${provenance.reason})`}`]
        }),
      ),
    ),
  ].sort()
}

/** The seam list the launches forwarded (#279): distinct values joined, or null when none forwarded one. */
export function launchDecisionSeamsOf(launches: readonly Pick<LiveLaunchProvenance, 'decisionSeams'>[]): string | null {
  const values = [...new Set(launches.map((launch) => launch.decisionSeams ?? null).filter((value): value is string => value !== null))].sort()
  return values.length === 0 ? null : values.join(' | ')
}
