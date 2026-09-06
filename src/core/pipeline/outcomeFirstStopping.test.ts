import { describe, expect, it } from 'vitest'
import { parseAssistantAnswer } from '../agent/answerContract'
import { createCommandPipeline } from './createCommandPipeline'
import { createReportRunPlanTool } from './runPlanTools'
import { VisionDeadlineError } from '../ports/vision'
import { FakeClock, RecordingTts, ScriptedLlm, withoutTurnId, type ScriptedTurn } from '../testing/doubles'
import { createSessionRuntime } from '../session/sessionRuntime'
import type { RunId, SessionId, SessionIdentitySource, SubmissionId } from '../session/sessionIdentity'
import type { PipelineEvent } from './events'
import type { Tool } from './tool'
import type { SettledPageState } from './progressFingerprints'
import type { ToolCall } from '../ports/llm'
import { TIER_TOOL_ROUND_BUDGETS } from './effortEpoch'
import { FORBIDDEN_ENDINGS, RESOURCE_ACCOUNTING } from '../testing/stoppingPolicy'

// The outcome-first stopping policy (#203, ADR 0038), end to end over a
// real Session. Two Runs share one Session Journal: the first is stopped
// by a rail and answers deterministically, the second asks why. What
// these tests can prove is mechanical — what the default Answer contains,
// what the Journal retains, and what the next Run's request carries. They
// cannot prove that a live model honours the policy it is given; the
// prompt assertions in orchestratorPrompt.test.ts pin the instruction,
// not the behaviour, and the scripted Answers below are fixtures, never
// evidence of live-model compliance (see docs/search-continuation-design.md,
// "Verification Boundary").

class Identities implements SessionIdentitySource {
  private submission = 0
  private run = 0
  private session = 0
  mintSubmissionId(): SubmissionId {
    return `submission-${++this.submission}` as SubmissionId
  }
  mintRunId(): RunId {
    return `run-${++this.run}` as RunId
  }
  mintSessionId(): SessionId {
    return `session-${++this.session}` as SessionId
  }
}

const lookupPlan = (id: string): ToolCall => ({
  id,
  name: 'report_run_plan',
  args: { objective: 'Find the tier list post', headline: 'Find the tier list post', effort_tier: 'lookup' },
})

/** A Session whose Runs share one Journal, and the pipeline that fills it. */
function session() {
  const clock = new FakeClock()
  const runtime = createSessionRuntime({ clock, identities: new Identities() })
  return {
    clock,
    runtime,
    /** One Run: admitted, executed against `llm`, committed, finished. */
    async run(
      command: string,
      llm: ScriptedLlm,
      tools: Tool[],
      surroundings: Partial<Parameters<typeof createCommandPipeline>[0]> = {},
    ): Promise<PipelineEvent[]> {
      const admission = runtime.accept(runtime.submit().submissionId)
      const pipeline = createCommandPipeline({
        llm,
        tts: new RecordingTts(),
        clock,
        tools: [createReportRunPlanTool(), ...tools],
        ...surroundings,
      })
      const events: PipelineEvent[] = []
      for await (const raw of pipeline.execute(command, 'turn', false, {
        snapshot: admission.journal,
        memory: admission.memory,
        generation: admission.generation,
        commit: (outcome, note, patch, stop) =>
          runtime.commitRunContinuity(admission.runId, outcome, note, patch, stop),
      })) {
        events.push(withoutTurnId(raw))
      }
      runtime.finish(admission.runId)
      return events
    },
  }
}

/** The run's spoken and displayed halves, in order. */
function rendered(events: PipelineEvent[]): string[] {
  return events
    .filter((event): event is Extract<PipelineEvent, { type: 'display' | 'speak' }> =>
      event.type === 'display' || event.type === 'speak')
    .map((event) => event.text)
}

/** The one settled page a no-Progress run keeps re-reading. */
const SETTLED: SettledPageState = {
  url: 'https://example.com/article',
  title: 'The article',
  textDigest: 'Intro paragraph.\nSecond paragraph.',
  scrollX: 0,
  scrollY: 0,
  dialogOpen: false,
  dialogText: '',
}

/** A tool that succeeds forever on the page the run is looking at. */
const browse: Tool = { name: 'navigate', acquisition: true, async execute() { return 'navigated' } }

/** The rounds that spend a Lookup budget without ever finishing. */
function spendLookup(): ScriptedTurn[] {
  return Array.from({ length: TIER_TOOL_ROUND_BUDGETS.lookup }, (_, index) => ({
    kind: 'tool_calls' as const,
    calls: [
      ...(index === 0 ? [lookupPlan('p1')] : []),
      { id: `n${index}`, name: 'navigate', args: { url: 'https://www.reddit.com/r/manhwa/' } },
    ],
  }))
}

describe('a stopped Run ends on the state of the task (#203, ADR 0038)', () => {
  it('answers with retained progress and the unresolved check, naming no limit', async () => {
    const harness = session()
    const events = await harness.run(
      'find the tier list post',
      // The budget is spent, the bookkeeping round is refused, and the
      // reserved Answer round's script is exhausted — it fails, so the
      // deterministic Answer is what the user actually gets.
      new ScriptedLlm([
        ...spendLookup(),
        { kind: 'tool_calls', calls: [{ id: 'bk', name: 'navigate', args: {} }] },
      ]),
      [{ name: 'navigate', acquisition: true, async execute() { return 'navigated' } }],
    )

    const answer = rendered(events)
    expect(answer).toEqual([
      'I have not made progress I can show on “find the tier list post” yet.',
      'I do not have anything to show for that request yet.',
    ])
    for (const text of answer) {
      expect(text).not.toMatch(RESOURCE_ACCOUNTING)
      expect(text).not.toMatch(FORBIDDEN_ENDINGS)
    }
    expect(events.find((event) => event.type === 'error')).toBeUndefined()
  })

  it('states an unreadable image as an unresolved check, not a provider failure', async () => {
    const harness = session()
    // The vision route fails on its own deadline. That is a mechanically
    // observed failure — it belongs in diagnostics — and what the user
    // gets is the page the run did read, plus the check it could not
    // complete.
    const look: Tool = {
      name: 'look',
      acquisition: true,
      async execute() {
        throw new VisionDeadlineError(20_000)
      },
    }
    const readPage: Tool = {
      name: 'read_page',
      acquisition: true,
      async execute() {
        return '# Tier list thread — https://www.reddit.com/r/manhwa/tiers/\n\npage text:\nThe 10/10 tier image is below.'
      },
    }
    const rounds: ScriptedTurn[] = [
      { kind: 'tool_calls', calls: [lookupPlan('p1'), { id: 'r1', name: 'read_page', args: {} }] },
      ...Array.from({ length: TIER_TOOL_ROUND_BUDGETS.lookup - 1 }, (_, index) => ({
        kind: 'tool_calls' as const,
        calls: [{ id: `l${index}`, name: 'look', args: {} }],
      })),
      { kind: 'tool_calls', calls: [{ id: 'bk', name: 'look', args: {} }] },
    ]
    const events = await harness.run('is this post in the 10/10 tier', new ScriptedLlm(rounds), [look, readPage], {
      currentPageUrl: () => 'https://www.reddit.com/r/manhwa/tiers/',
    })

    const display = events.find((event) => event.type === 'display')!
    expect(display.text).toContain('I have not confirmed an answer for')
    // The check the run could not complete is named as exactly that —
    // not as the generic "these are unverified leads" line, and not as
    // the vision failure behind it (#203/AC2).
    expect(display.text).toContain('I could not read the image I needed to check, so that is still unverified.')
    expect(display.text).not.toContain('I have not verified that any of these answers the request.')
    // The page the run did read is still shown.
    expect(display.text).toContain('https://www.reddit.com/r/manhwa/tiers')
    // The spoken half names the same unresolved check.
    expect(events.filter((event) => event.type === 'speak').map((event) => event.text)).toEqual([
      'I could not read the image I needed, so I have not confirmed that.',
    ])
    // Nothing about the provider's own failure reaches either half.
    for (const text of rendered(events)) {
      expect(text).not.toMatch(RESOURCE_ACCOUNTING)
      expect(text).not.toContain('vision')
      expect(text).not.toContain('20000')
    }
  })

  it('keeps an actionable external blocker visible with the step that clears it', async () => {
    const harness = session()
    const WALLED = 'navigated to https://www.reddit.com/\nBLOCKER:login-wall www.reddit.com\nThis page is a Blocker.'
    const navigate: Tool = { name: 'navigate', acquisition: true, async execute() { return WALLED } }
    const click: Tool = { name: 'click', acquisition: true, async execute() { return 'clicked' } }
    const events = await harness.run(
      'find the tier list post',
      new ScriptedLlm([
        { kind: 'tool_calls', calls: [lookupPlan('p1'), { id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/' } }] },
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'c3', name: 'click', args: {} }] },
      ]),
      [navigate, click],
      { currentHost: () => 'www.reddit.com' },
    )

    const answer = rendered(events)
    // The blocker is the one stop the user is told about, because it is
    // the one they can act on.
    expect(answer.some((text) => text.includes('sign in to www.reddit.com once in the browser tab'))).toBe(true)
    expect(answer.some((text) => text.includes('I could not get past the sign-in wall on www.reddit.com.'))).toBe(true)
    for (const text of answer) expect(text).not.toMatch(RESOURCE_ACCOUNTING)
  })
})

describe('a later explicit "why did you stop?" is answered from the Run (#203/AC5)', () => {
  it('retains the entry cause and the Finalization failure, without a second store', async () => {
    const harness = session()
    await harness.run(
      'find the tier list post',
      new ScriptedLlm([
        ...spendLookup(),
        { kind: 'tool_calls', calls: [{ id: 'bk', name: 'navigate', args: {} }] },
      ]),
      [browse],
    )

    // The second Run is admitted with the Journal the first one wrote.
    const follow = new ScriptedLlm([
      { kind: 'answer', speak: 'I stopped before I had confirmed it.', display: 'Detail.' },
    ])
    await harness.run('why did you stop?', follow, [browse])

    const journal = follow.requests[0]!.journal!
    expect(journal).toHaveLength(1)
    // The authoritative Finalization Cause — the one the Run entered
    // Finalization under, not the failure that followed it (AC6).
    expect(journal[0]!.stop).toEqual({
      cause: 'budget_exhausted',
      failure: 'the reserved Answer round failed: ScriptedLlm ran out of scripted turns',
    })
    // Bounded Session continuity is the only place it lives: the Run
    // Journal the model already receives, not a parallel diagnostic log.
    expect(journal[0]!.outcome).toBe('failed')
  })

  it('does not let a later Finalization failure overwrite the entry cause (#203/AC6)', async () => {
    const harness = session()
    // Two Approaches in a row make no progress: the Run enters
    // Finalization for `no_progress`. The reserved Answer round then
    // replies off contract — a second, later failure.
    const readPage: Tool = { name: 'read_page', acquisition: true, async execute() { return 'read' } }
    const look: Tool = { name: 'look', acquisition: true, usesVision: true, async execute() { return 'seen' } }
    const scroll: Tool = { name: 'scroll', acquisition: true, async execute() { return 'scrolled' } }
    const back: Tool = { name: 'back', acquisition: true, async execute() { return 'went back' } }
    // Prose where the reserved round's one job was the Answer contract:
    // an Off-contract Reply, which is a failed round (#198, ADR 0034).
    const NARRATION = 'Retrying the candidate record with the observation id.'
    const events = await harness.run(
      'study the article',
      new ScriptedLlm([
        { kind: 'tool_calls', calls: [lookupPlan('p1'), { id: 'r0', name: 'read_page', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'l1', name: 'look', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 's1', name: 'scroll', args: { direction: 'down' } }] },
        { kind: 'tool_calls', calls: [{ id: 'b1', name: 'back', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'r2', name: 'read_page', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'l2', name: 'look', args: {} }] },
        // The second Approach exhausts here; the bookkeeping round follows.
        { kind: 'tool_calls', calls: [{ id: 's2', name: 'scroll', args: { direction: 'up' } }] },
        { kind: 'tool_calls', calls: [{ id: 'bk1', name: 'read_page', args: {} }] },
        { kind: 'answer', ...parseAssistantAnswer(NARRATION), streamChunks: [NARRATION] } as ScriptedTurn,
      ]),
      [readPage, look, scroll, back],
      { settledPageState: () => SETTLED },
    )
    expect(events.at(-1)).toMatchObject({ outcome: 'failed', finalizationCause: 'no_progress' })

    const follow = new ScriptedLlm([{ kind: 'answer', speak: 'Because I stalled.', display: 'Detail.' }])
    await harness.run('why did you stop?', follow, [browse])

    const stop = follow.requests[0]!.journal![0]!.stop!
    // The mechanical outcome, the Finalization Cause, and the recorded
    // failure stay three separate facts.
    expect(stop.cause).toBe('no_progress')
    expect(stop.failure).toBe('the reserved Answer round replied off contract instead of answering')
  })

  it('retains a Blocker stop with the wall it kept at', async () => {
    const harness = session()
    const WALLED = 'navigated to https://www.reddit.com/\nBLOCKER:login-wall www.reddit.com\nThis page is a Blocker.'
    const navigate: Tool = { name: 'navigate', acquisition: true, async execute() { return WALLED } }
    const click: Tool = { name: 'click', acquisition: true, async execute() { return 'clicked' } }
    await harness.run(
      'find the tier list post',
      new ScriptedLlm([
        { kind: 'tool_calls', calls: [lookupPlan('p1'), { id: 'n1', name: 'navigate', args: { url: 'https://www.reddit.com/' } }] },
        { kind: 'tool_calls', calls: [{ id: 'c1', name: 'click', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: {} }] },
        { kind: 'tool_calls', calls: [{ id: 'c3', name: 'click', args: {} }] },
      ]),
      [navigate, click],
      { currentHost: () => 'www.reddit.com' },
    )

    const follow = new ScriptedLlm([{ kind: 'answer', speak: 'A sign-in wall.', display: 'Detail.' }])
    await harness.run('why did you stop?', follow, [browse])

    const stop = follow.requests[0]!.journal![0]!.stop!
    expect(stop.cause).toBe('blocker')
    expect(stop.detail).toContain('www.reddit.com')
    expect(stop.detail).toContain('login-wall')
  })

  it('does not put a stopped Run\u2019s cause into an unrelated follow-up\u2019s Answer', async () => {
    const harness = session()
    await harness.run(
      'find the tier list post',
      new ScriptedLlm([
        ...spendLookup(),
        { kind: 'tool_calls', calls: [{ id: 'bk', name: 'navigate', args: {} }] },
      ]),
      [browse],
    )

    // A follow-up about something else entirely. Bounded Session
    // continuity is shared, so the stopped Run's record is in the
    // request — that is the point of reusing it, and the Journal block
    // labels it internal (openAiLlmClient.test.ts pins that wording).
    const follow = new ScriptedLlm([
      { kind: 'answer', speak: 'It is the manhwa subreddit.', display: 'The page is r/manhwa.', runNote: 'Read the page.' } as ScriptedTurn,
    ])
    const events = await harness.run('what is on the page?', follow, [browse])
    expect(follow.requests[0]!.journal![0]!.stop).toEqual({
      cause: 'budget_exhausted',
      failure: 'the reserved Answer round failed: ScriptedLlm ran out of scripted turns',
    })

    // What the runtime renders is the model's Answer and nothing else:
    // no cause is spliced in, and none of the stopped Run's internal
    // vocabulary reaches the user. Whether the model volunteers it is a
    // prompt instruction, pinned in orchestratorPrompt.test.ts — this
    // scripted Answer is a fixture, not evidence about a live model.
    expect(rendered(events)).toEqual(['The page is r/manhwa.', 'It is the manhwa subreddit.'])
    for (const text of rendered(events)) expect(text).not.toMatch(RESOURCE_ACCOUNTING)

    // And the follow-up, having concluded on its own terms, retains no
    // stop of its own — the earlier Run's cause does not travel forward
    // as though it were this one's.
    const third = new ScriptedLlm([{ kind: 'answer', speak: 'Sure.', display: 'Detail.' }])
    await harness.run('and the title?', third, [browse])
    const journal = third.requests[0]!.journal!
    expect(journal).toHaveLength(2)
    expect(journal[1]!.stop).toBeUndefined()
  })
})
