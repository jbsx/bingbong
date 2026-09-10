// One key manifest for a whole scheduled pass (#227).
//
// `keys.ts` describes ONE hunt to the grader (`keyManifestOf`). The offline
// grading commands read ONE manifest for a whole capture set: `init-grades`
// takes a single `--keys=` file and `initializeLiveGrades` walks every slot
// in the set. So a pass of four hunts and two follow-ups needs the four
// per-hunt manifests composed into one, and that composition is the only
// thing this module does.
//
// It deliberately derives nothing itself. Check ids, check wording, per-hunt
// digests, keyRefs and reference sources all come from `keyManifestOf`,
// because two modules deriving checks from the same keys is two answers to
// "what is check `fact-03`" — and a grade names a check by id.
//
// WHAT COMPOSITION HAS TO DECIDE. A merged manifest carries one `keyVersion`
// and one `keyDigest`, while the keys it merges each have their own. Both are
// joined rather than collapsed: `grades.ts` treats an entry whose
// `keyVersion` differs from the manifest's as a stale review, so the label
// has to move when *any* key is revised, and it should say which one moved.
// Silently reporting `1` for four keys at version 1 would hide the day one of
// them reaches 2.
//
// THIS MODULE LOADS A KEY, so nothing on the capture path may load it;
// `corpus.test.ts` walks the import graph and enforces both halves.
//
// A GENERATED MANIFEST IS EVALUATOR MATERIAL — its check descriptions are the
// key's own words about what a correct Answer says. It never belongs in a
// report or in the measured assistant's context.

import { digestOf } from './artifacts.ts'
import { LIVE_GRADING_SCHEMA_VERSION, LIVE_KEY_MANIFEST_KIND, type LiveKeyManifest, type LiveKeyTask } from './grades.ts'
import { liveWebHunts, type LiveWebHunt } from './hunts.ts'
import { gradingKeyFor, gradingKeys, keyManifestOf, type GradingKey } from './keys.ts'

export type { GradingKey }

/** Each hunt's own manifest, in the schedule's order. */
function perHunt(hunts: readonly LiveWebHunt[]): LiveKeyManifest[] {
  return hunts.map((hunt) => keyManifestOf(hunt.id))
}

/**
 * Every key's version, in schedule order — `1.1.1.1` for four keys at
 * version 1. Composing a single hunt yields that hunt's own label, so a
 * one-hunt manifest reads exactly as `keyManifestOf` wrote it.
 */
export function keyVersionLabel(hunts: readonly LiveWebHunt[] = liveWebHunts()): string {
  return perHunt(hunts)
    .map((manifest) => manifest.keyVersion)
    .join('.')
}

/**
 * A digest over the composed keys' own digests, bound to the hunt each came
 * from. Order-independent, so it identifies which keys were merged rather
 * than the order they happened to be listed in; changing what any one key
 * requires changes it, because each per-hunt digest is over that key's
 * content.
 */
export function keyCorpusDigest(hunts: readonly LiveWebHunt[] = liveWebHunts()): string {
  const bound = perHunt(hunts)
    .map((manifest) => `${manifest.tasks[0]!.huntId}=${manifest.keyDigest}`)
    .sort()
  return digestOf(bound.join('\n'))
}

export interface BuildKeyManifestOptions {
  readonly hunts?: readonly LiveWebHunt[]
}

/**
 * The manifest for a scheduled population: every slot the pass plans, in the
 * order it plans them, so no captured attempt can turn out to be ungradeable.
 * A hunt whose key cannot describe it throws from `keyManifestOf` — finding
 * that out here costs nothing, and finding it out after a paid capture costs
 * the capture.
 */
export function buildLiveKeyManifest(options: BuildKeyManifestOptions = {}): LiveKeyManifest {
  const hunts = options.hunts ?? liveWebHunts()
  if (hunts.length === 0) throw new Error('a key manifest needs at least one hunt to describe')

  const manifests = perHunt(hunts)
  const tasks: LiveKeyTask[] = manifests.flatMap((manifest) => [...manifest.tasks])

  return {
    kind: LIVE_KEY_MANIFEST_KIND,
    schemaVersion: LIVE_GRADING_SCHEMA_VERSION,
    keyVersion: keyVersionLabel(hunts),
    keyDigest: keyCorpusDigest(hunts),
    // The newest key preparation date among the merged keys — when the keys
    // were last prepared, never when this file happened to be generated.
    preparedAt: manifests.map((manifest) => manifest.preparedAt).sort().at(-1)!,
    tasks,
  }
}

/**
 * The statements a key marks as current-state rather than settled history.
 * #227 requires these rechecked against their sources before a paid capture;
 * a hunt absent from this list claims nothing that can move.
 */
export function liveFactsToRecheck(
  keys: readonly GradingKey[] = gradingKeys(),
): { huntId: string; liveFacts: readonly string[] }[] {
  return [...keys]
    .sort((left, right) => left.huntId.localeCompare(right.huntId))
    .filter((key) => key.liveFacts.length > 0)
    .map((key) => ({ huntId: key.huntId, liveFacts: key.liveFacts }))
}

/**
 * Re-exported so callers compose through this module rather than reaching
 * around it: `gradingKeyFor` for a reviewer reading `constraints` before
 * judging a hunt's checks, and `keyManifestOf` for the per-hunt manifest this
 * composition is built from. Keeping the direct importers of `keys.ts` down to
 * the two that must read it is what makes `corpus.test.ts`'s importer pin
 * mean something.
 */
export { gradingKeyFor, keyManifestOf }
