import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeCommandText } from './capture.ts'
import { liveWebHunts, scheduledCommandCount, type MeasuredPrompt } from './hunts.ts'
import { keyManifestDigest, parseLiveKeyManifest } from './grades.ts'
import { gradingKeyFor, gradingKeys, keyManifestOf, type GradingKey } from './keys.ts'
import { PILOT_COMMAND_CEILING } from './schedule.ts'

// The corpus's own guard rails (#225 acceptance criteria 1–3). Three things
// are pinned here, and each of them is a rule that would otherwise survive
// only as an intention:
//
//   1. The corpus IS the four hunts and two follow-ups — six commands, no
//      more. The pilot's work bound is derived from this list, so a fifth
//      hunt added casually fails here rather than quietly doubling a paid
//      capture.
//   2. Prompt text and key material never mix. Asserted both ways: no
//      evaluator string appears in a prompt, and no prompt carries a URL.
//   3. A prompt or key changes only with a version bump and a stated
//      reason. The digest pins below are what make "do not silently change
//      a prompt after observing a measured response" mechanical — editing
//      the text alone fails; editing it with a bump forces a new digest and
//      a new revision entry, which is a deliberate, reviewable act.

/** Stable digest of a prompt's exact text — what the pins below compare against. */
function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * The frozen identity of every accepted prompt version. A pin is added when a
 * version is added and is NEVER edited in place: an edited pin means the text
 * of an already-captured version changed, which would silently invalidate
 * every capture taken against it.
 */
const PINNED_PROMPT_DIGESTS: Record<string, string> = {
  // v1 of all six was verified character-exact against the quoted prompts in
  // #223 before being pinned, so these digests identify the approved text
  // rather than whatever was typed into the corpus.
  'compatibility-pi-camera:initial:v1': '62ccf9fb4528227a',
  'compatibility-pi-camera:follow-up:v1': '53a1183c0b9f4f2b',
  'historical-longitude-watch:initial:v1': '44ade9e0460fb75a',
  'rule-eurostar-luggage:initial:v1': 'c8ae6d8137510760',
  'rule-eurostar-luggage:follow-up:v1': 'd2a198807b5e8f68',
  'superseded-voyager-interstellar:initial:v1': 'aa094cb237191ff3',
}

/**
 * Answer material that must never appear in a prompt. Every entry is a fact
 * the assistant is supposed to DISCOVER; seeing one in a prompt would mean
 * the task had been reduced to a reading exercise. Terms the prompt
 * legitimately owns are absent on purpose — "Premier" and "Eurostar" are the
 * follow-up's question, not its answer.
 */
const ANSWER_TOKENS = [
  // Hunt 1 — the cable, sensor, and current software stack are the answer.
  'IMX708',
  'libcamera',
  'rpicam',
  '15-pin',
  '22-pin',
  'Standard-Mini',
  // Hunt 2 — catalogue identity, measurements, and the case's real dating.
  'ZAA0037',
  'H3',
  'H4',
  'K1',
  '102 mm',
  '1938',
  '1962',
  'Hamilton',
  // Hunt 3 — the allowance arithmetic and the length threshold.
  '85 cm',
  'two pieces',
  'three pieces',
  // Hunt 4 — the dates and the decisive measurement.
  'August 25',
  'April 9',
  'June 27',
  'September 12',
  '40 times',
  'plasma',
]

/** Every source hostname the evaluator used. None may appear in a prompt. */
const SOURCE_HOSTS = ['raspberrypi.com', 'rmg.co.uk', 'eurostar.com', 'nasa.gov']

/** Every prompt a pass may submit, labelled by where it sits in the schedule. */
function allPrompts(): { label: string; prompt: MeasuredPrompt }[] {
  return liveWebHunts().flatMap((hunt) => [
    { label: `${hunt.id}:initial`, prompt: hunt.prompt },
    ...(hunt.followUp ? [{ label: `${hunt.id}:follow-up`, prompt: hunt.followUp }] : []),
  ])
}

/** Every free-text string a key holds, including its follow-up delta. */
function keyStrings(key: GradingKey): string[] {
  return [
    ...key.requiredFacts,
    ...key.constraints,
    ...key.pitfalls,
    ...key.uncertainties,
    ...key.liveFacts,
    ...key.sources.map((source) => source.supports),
    ...(key.followUpDelta?.requiredFacts ?? []),
    ...(key.followUpDelta?.pitfalls ?? []),
    ...(key.followUpDelta?.sources.map((source) => source.supports) ?? []),
  ]
}

describe('the live-web hunt corpus', () => {
  it('is the four accepted hunts, in a fixed order', () => {
    expect(liveWebHunts().map((hunt) => hunt.id)).toEqual([
      'compatibility-pi-camera',
      'historical-longitude-watch',
      'rule-eurostar-luggage',
      'superseded-voyager-interstellar',
    ])
  })

  it('gives each hunt its own kind, so no two measure the same shape', () => {
    const kinds = liveWebHunts().map((hunt) => hunt.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('carries the two fixed follow-ups, on the hunts #223 accepted them for', () => {
    const withFollowUp = liveWebHunts()
      .filter((hunt) => hunt.followUp)
      .map((hunt) => hunt.id)
    expect(withFollowUp).toEqual(['compatibility-pi-camera', 'rule-eurostar-luggage'])
  })

  it('bounds a pass at six commands — four initials plus two follow-ups', () => {
    expect(scheduledCommandCount()).toBe(6)
    expect(allPrompts()).toHaveLength(6)
    // The schedule states the same bound as an absolute number. Pinning them
    // equal here is what makes a corpus that grows fail loudly rather than
    // quietly widening what a paid pass may spend.
    expect(scheduledCommandCount()).toBe(PILOT_COMMAND_CEILING)
  })

  it('has no empty prompt', () => {
    for (const { label, prompt } of allPrompts()) {
      expect(prompt.text.trim(), label).not.toBe('')
    }
  })

  it('stores every prompt exactly as the Prompt Bar will submit it', () => {
    // The capture refuses a multi-line command, because the single-line
    // Prompt Bar would strip the newline and the accepted text would then
    // never match what was dispatched. Checked with the capture's own
    // normalizer rather than a local regex, so the corpus and the thing that
    // submits it cannot drift: a prompt is stored ready to send, and
    // dispatch never has to edit approved text.
    for (const { label, prompt } of allPrompts()) {
      expect(normalizeCommandText(prompt.text), label).toBe(prompt.text)
    }
  })

})

describe('prompt and key separation', () => {
  it('keeps every hunt paired with exactly one key', () => {
    const huntIds = liveWebHunts().map((hunt) => hunt.id)
    const keyIds = gradingKeys().map((key) => key.huntId)
    expect([...keyIds].sort()).toEqual([...huntIds].sort())
  })

  it('gives a key a follow-up delta exactly when its hunt has a follow-up', () => {
    for (const hunt of liveWebHunts()) {
      const key = gradingKeyFor(hunt.id)
      expect(key, hunt.id).toBeDefined()
      expect(Boolean(key!.followUpDelta), hunt.id).toBe(Boolean(hunt.followUp))
    }
  })

  it('never puts a URL in a prompt — the assistant finds its own sources', () => {
    for (const { label, prompt } of allPrompts()) {
      expect(prompt.text, label).not.toMatch(/https?:\/\//i)
      for (const host of SOURCE_HOSTS) {
        expect(prompt.text.toLowerCase(), `${label} names ${host}`).not.toContain(host)
      }
    }
  })

  it('never puts answer material in a prompt', () => {
    for (const { label, prompt } of allPrompts()) {
      for (const token of ANSWER_TOKENS) {
        expect(prompt.text.toLowerCase(), `${label} leaks "${token}"`).not.toContain(token.toLowerCase())
      }
    }
  })

  it('never lets a key string appear verbatim in a prompt', () => {
    const prompts = allPrompts()
    for (const key of gradingKeys()) {
      for (const value of keyStrings(key)) {
        for (const { label, prompt } of prompts) {
          expect(prompt.text.includes(value), `${label} contains key text of ${key.huntId}`).toBe(false)
        }
      }
    }
  })

  it('keeps every evaluator source URL out of every prompt', () => {
    const urls = gradingKeys().flatMap((key) => [
      ...key.sources.map((source) => source.url),
      ...(key.followUpDelta?.sources.map((source) => source.url) ?? []),
    ])
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      for (const { label, prompt } of allPrompts()) {
        expect(prompt.text, `${label} names ${url}`).not.toContain(url)
      }
    }
  })

  it('supports every key fact with at least one primary source', () => {
    for (const key of gradingKeys()) {
      expect(key.requiredFacts.length, key.huntId).toBeGreaterThan(0)
      expect(key.sources.length, key.huntId).toBeGreaterThan(0)
      for (const source of key.sources) {
        expect(source.url, key.huntId).toMatch(/^https:\/\//)
        expect(source.supports.trim(), source.url).not.toBe('')
      }
    }
  })
})

describe('nothing on the capture path can load a key', () => {
  // The protocol doc calls this split structural rather than conventional:
  // "the runner cannot leak a key it never loaded". String non-overlap does
  // not show that — only the import graph does. Walked transitively from the
  // module a pass actually starts from, so a key reached through two hops
  // fails here too.
  const liveDir = join(import.meta.dirname)

  function localImportsOf(module: string): string[] {
    const source = readFileSync(join(liveDir, module), 'utf8')
    return [...source.matchAll(/from '\.\/([\w.]+?)(?:\.ts)?'/g)].map((match) => `${match[1]}.ts`)
  }

  /** Every module reachable from the entry points a measured pass loads. */
  function capturePathModules(): Set<string> {
    const seen = new Set<string>()
    const queue = ['pass.ts', 'schedule.ts', 'hunts.ts', 'pilot.live.test.ts']
    while (queue.length > 0) {
      const module = queue.pop()!
      if (seen.has(module)) continue
      seen.add(module)
      queue.push(...localImportsOf(module))
    }
    return seen
  }

  it('never reaches keys.ts from anything a measured pass loads', () => {
    const reachable = capturePathModules()
    // Sanity: the walk really did traverse, rather than silently finding nothing.
    expect(reachable.has('schedule.ts')).toBe(true)
    expect(reachable.has('capture.ts')).toBe(true)
    expect([...reachable].sort()).not.toContain('keys.ts')
  })

  it('is loaded only by grading-side modules, never by the runner', () => {
    // Grading legitimately loads keys — that is what grading is. What must
    // never happen is a module on the capture path loading them, and the
    // walk above is the guard for that. This one keeps the list of loaders
    // short and deliberate: a new name here is a decision someone should
    // have to make on purpose, not a diff nobody read.
    const allowed = new Set(['corpus.test.ts', 'keyManifest.ts', 'keyManifest.test.ts'])
    const importers = readdirSync(liveDir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => localImportsOf(name).includes('keys.ts'))

    expect(importers.length).toBeGreaterThan(0)
    expect(importers.filter((name) => !allowed.has(name))).toEqual([])
    // And none of them may be reachable from a measured pass.
    const reachable = capturePathModules()
    expect(importers.filter((name) => reachable.has(name))).toEqual([])
  })
})

describe('the manifest a key shows the grader', () => {
  it('is accepted by #226’s own parser, for every hunt', () => {
    for (const hunt of liveWebHunts()) {
      const parsed = parseLiveKeyManifest(JSON.parse(JSON.stringify(keyManifestOf(hunt.id))))
      expect(parsed.ok ? [] : parsed.errors, hunt.id).toEqual([])
    }
  })

  it('describes both steps of a hunt that has a follow-up, and one otherwise', () => {
    for (const hunt of liveWebHunts()) {
      const steps = keyManifestOf(hunt.id).tasks.map((task) => task.stepId)
      expect(steps, hunt.id).toEqual(hunt.followUp ? ['initial', 'follow_up'] : ['initial'])
    }
  })

  it('grades each step against the prompt version that step was submitted at', () => {
    const manifest = keyManifestOf('rule-eurostar-luggage')
    const hunt = liveWebHunts().find((candidate) => candidate.id === 'rule-eurostar-luggage')!
    expect(manifest.tasks[0].promptVersion).toBe(String(hunt.prompt.version))
    expect(manifest.tasks[1].promptVersion).toBe(String(hunt.followUp!.version))
  })

  it('gives every step at least one check — a key that requires nothing cannot be failed', () => {
    for (const hunt of liveWebHunts()) {
      for (const task of keyManifestOf(hunt.id).tasks) {
        expect(task.checks.length, `${hunt.id}/${task.stepId}`).toBeGreaterThan(0)
        const ids = task.checks.map((check) => check.checkId)
        expect(new Set(ids).size, `${hunt.id}/${task.stepId} repeats a check id`).toBe(ids.length)
      }
    }
  })

  it('carries no key conclusions in the reference the grader stores', () => {
    // `keyRef` points a reviewer at the key; it is opaque to grades.ts and
    // must never be a way for a conclusion to travel into a grading record.
    for (const hunt of liveWebHunts()) {
      const key = gradingKeyFor(hunt.id)!
      for (const task of keyManifestOf(hunt.id).tasks) {
        expect(task.keyRef).toContain('e2e/live/keys.ts')
        for (const fact of key.requiredFacts) {
          expect(task.keyRef).not.toContain(fact)
        }
      }
    }
  })

  it('pins the key it was prepared from', () => {
    const manifest = keyManifestOf('superseded-voyager-interstellar')
    expect(manifest.keyDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(manifest.keyVersion).toBe(String(gradingKeyFor('superseded-voyager-interstellar')!.version))
    // preparedAt is the key's own newest revision, not generation time.
    expect(manifest.preparedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('changes its digest when the key changes, which is what makes a late edit visible', () => {
    // The whole point of binding a grade to a keyDigest: a key edited after
    // an Answer was graded no longer matches the grade that claims it.
    const manifest = keyManifestOf('historical-longitude-watch')
    const before = keyManifestDigest(manifest)

    const edited = { ...manifest, keyDigest: 'sha256:' + '0'.repeat(64) }
    expect(keyManifestDigest(edited)).not.toBe(before)

    // And the same manifest digests the same, whatever order it was built in.
    expect(keyManifestDigest({ ...manifest, tasks: [...manifest.tasks].reverse() })).toBe(before)
  })

  it('refuses a hunt the corpus does not declare', () => {
    expect(() => keyManifestOf('no-such-hunt')).toThrow(/not an approved live-web hunt/)
  })

  it('states the review load a pass costs a human', () => {
    // Manual review is the pilot's real bottleneck, so the number belongs
    // somewhere it can be checked rather than in a summary someone wrote from
    // memory. It grows whenever a key gains a fact, pitfall or uncertainty:
    // update it deliberately, and tell whoever is planning reviewer time.
    const load = liveWebHunts().flatMap((hunt) =>
      keyManifestOf(hunt.id).tasks.map((task) => [`${hunt.id}/${task.stepId}`, task.checks.length] as const),
    )

    expect(Object.fromEntries(load)).toEqual({
      'compatibility-pi-camera/initial': 10,
      'compatibility-pi-camera/follow_up': 6,
      'historical-longitude-watch/initial': 17,
      'rule-eurostar-luggage/initial': 14,
      'rule-eurostar-luggage/follow_up': 6,
      'superseded-voyager-interstellar/initial': 15,
    })

    const total = load.reduce((sum, [, checks]) => sum + checks, 0)
    expect(total).toBe(68)
  })
})

describe('task and key provenance', () => {
  /** A version is only real if every version up to it has a dated, reasoned entry. */
  function expectProvenanced(label: string, version: number, revisions: readonly { version: number; date: string; reason: string }[]): void {
    expect(revisions, `${label} has no revision history`).toHaveLength(version)
    revisions.forEach((revision, index) => {
      expect(revision.version, `${label} revision ${index}`).toBe(index + 1)
      expect(revision.date, `${label} revision ${index}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(revision.reason.trim(), `${label} revision ${index}`).not.toBe('')
    })
  }

  it('provenances every prompt version', () => {
    for (const { label, prompt } of allPrompts()) {
      expectProvenanced(label, prompt.version, prompt.revisions)
    }
  })

  it('provenances every key version', () => {
    for (const key of gradingKeys()) {
      expectProvenanced(`key:${key.huntId}`, key.version, key.revisions)
    }
  })

  it('pins the exact text of every accepted prompt version', () => {
    // Compared as one map rather than pin by pin: a corpus-wide edit should
    // report every prompt it touched, not stop at the first.
    const observed = Object.fromEntries(
      allPrompts().map(({ label, prompt }) => [`${label}:v${prompt.version}`, digest(prompt.text)]),
    )
    const pinned = Object.fromEntries(Object.keys(observed).map((pin) => [pin, PINNED_PROMPT_DIGESTS[pin]]))
    expect(observed, 'a prompt changed without a version bump, or a new version has no pin').toEqual(pinned)
  })

  it('pins nothing that the corpus no longer contains', () => {
    const live = new Set(allPrompts().map(({ label, prompt }) => `${label}:v${prompt.version}`))
    const superseded = Object.keys(PINNED_PROMPT_DIGESTS).filter((pin) => !live.has(pin))
    // Superseded pins are kept deliberately — they identify the text older
    // captures were taken against. They must still name a hunt that exists.
    for (const pin of superseded) {
      const huntId = pin.split(':')[0]
      expect(
        liveWebHunts().some((hunt) => hunt.id === huntId),
        `pin ${pin} names a hunt the corpus dropped`,
      ).toBe(true)
    }
  })

  it('names the live-policy facts that must be rechecked before a paid pass', () => {
    // Exactly one hunt rests on current policy rather than settled history.
    // If that ever becomes two, the preflight has another target and this
    // test is where it gets noticed.
    const volatile = gradingKeys().filter((key) => key.liveFacts.length > 0)
    expect(volatile.map((key) => key.huntId)).toEqual(['rule-eurostar-luggage'])
  })
})
