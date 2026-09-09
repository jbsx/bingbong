import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../../src/core/ports/llm'
import { startFixtureServer, type FixtureServer } from '../fixtureServer'
import { validateCaptureSet } from './artifacts.ts'
import { startCaptureSession, type CaptureSession, type CaptureSessionOptions } from './capture.ts'
import { liveWebHunts } from './hunts.ts'
import { captureSetOf, createHuntCaptureHost, type HuntAttempt, type StartCaptureSession } from './pass.ts'
import { runLiveWebPass, type CommandRecord } from './schedule.ts'
import type { LiveAcceptedCommand, LiveAttemptCapture } from './types.ts'

// The whole four-hunt schedule at the agreed boundary (#225): the real
// Electron Prompt Bar, real app Sessions, real benchmark profiles, and the
// files a pass leaves behind — all scripted, all local, no model spend, and
// none of it baseline evidence.
//
// WHAT THIS PROVES THAT THE UNIT TESTS CANNOT. schedule.test.ts proves the
// protocol's arithmetic against a fake host; it cannot prove that a "fresh
// Session and restored profile" is actually fresh, or that a follow-up really
// lands in its initial's Session. Those are properties of the app and its
// profile, so they are checked here against Session identities the app itself
// published and a cookie the browser itself kept.
//
// The corpus prompts are dispatched verbatim even though a scripted model
// answers them: what is under test is that the approved text reaches the
// pipeline unaltered, which a stand-in string would not show.

const answer = (display: string, speak = 'Done.'): AssistantTurn => ({ kind: 'answer', speak, display })
const navigate = (url: string, id = 'nav'): AssistantTurn => ({ kind: 'tool_calls', calls: [{ id, name: 'navigate', args: { url } }] })

function attemptOf(record: CommandRecord<HuntAttempt>, what: string): LiveAttemptCapture {
  if (record.status !== 'attempted') {
    throw new Error(`${what} was not reached (${record.reason}): ${record.detail}`)
  }
  if (record.attempt.capture.kind !== 'attempt') {
    throw new Error(`${what} was never dispatched: ${record.attempt.capture.reason}`)
  }
  return record.attempt.capture
}

function acceptedOf(record: CommandRecord<HuntAttempt>, what: string): LiveAcceptedCommand {
  const accepted = attemptOf(record, what).accepted
  if (accepted.status !== 'observed') {
    throw new Error(`${what} was never accepted: ${accepted.reason}`)
  }
  return accepted.value
}

describe('the four-hunt schedule, end to end (#225)', () => {
  let fixture: FixtureServer
  let root: string
  const CORPUS = liveWebHunts()
  const [PI, WATCH, EUROSTAR, VOYAGER] = CORPUS

  beforeAll(async () => {
    fixture = await startFixtureServer()
    root = mkdtempSync(join(tmpdir(), 'live-schedule-e2e-'))
  })

  afterAll(async () => {
    await fixture?.close()
    rmSync(root, { recursive: true, force: true })
  })

  /**
   * A capture starter that scripts each hunt's model separately. The host
   * gives every hunt the same options, so per-hunt scripting has to be
   * injected here — which also keeps the schedule itself unaware that a
   * scripted model exists.
   */
  function scriptedStart(
    scripts: Record<string, AssistantTurn[]>,
    onSession?: (huntId: string, session: CaptureSession) => void,
  ): StartCaptureSession {
    return async (options: CaptureSessionOptions) => {
      const session = await startCaptureSession({
        ...options,
        verification: {
          env: { BINGBONG_LLM_SCRIPT: JSON.stringify(scripts[options.huntId] ?? [answer('UNSCRIPTED')]) },
          fixture,
        },
      })
      onSession?.(options.huntId, session)
      return session
    }
  }

  it(
    'runs all six commands, keeps each hunt in its own Session, and delivers both follow-ups',
    async () => {
      const start = scriptedStart({
        // The first hunt answers WRONGLY on purpose. Nothing in the schedule
        // can tell, which is the point: its follow-up must go out exactly as
        // the correct-looking ones do.
        [PI.id]: [answer('THE ZERO TAKES THE SUPPLIED CABLE, USE RASPISTILL'), answer('PI FOLLOW-UP')],
        [WATCH.id]: [answer('WATCH ANSWER')],
        [EUROSTAR.id]: [answer('EUROSTAR ANSWER'), answer('EUROSTAR FOLLOW-UP')],
        [VOYAGER.id]: [answer('VOYAGER ANSWER')],
      })
      const host = createHuntCaptureHost(start, { mode: 'verification', setId: 'set-whole', root })

      const pass = await runLiveWebPass(host)

      // The pilot's whole work bound, actually spent.
      expect(pass.commandsSubmitted).toBe(6)
      expect(pass.commandBudget).toBe(6)
      expect(pass.hunts.map((hunt) => hunt.huntId)).toEqual(CORPUS.map((hunt) => hunt.id))

      // Every initial was accepted by the pipeline, and carries the corpus
      // text unaltered — the approved prompt is what reached the app.
      for (const hunt of CORPUS) {
        const record = pass.hunts.find((candidate) => candidate.huntId === hunt.id)!
        expect(acceptedOf(record.initial, `${hunt.id} initial`).text).toBe(hunt.prompt.text)
      }

      // Both follow-ups went out — one of them after a wrong Answer.
      const piInitial = acceptedOf(pass.hunts[0].initial, 'pi initial')
      const piFollowUp = acceptedOf(pass.hunts[0].followUp!, 'pi follow-up')
      expect(piFollowUp.text).toBe(PI.followUp!.text)
      const eurostarFollowUp = acceptedOf(pass.hunts[2].followUp!, 'eurostar follow-up')
      expect(eurostarFollowUp.text).toBe(EUROSTAR.followUp!.text)

      // A follow-up is the SAME Session as its initial, and a different Run.
      expect(piFollowUp.sessionId).toBe(piInitial.sessionId)
      expect(piFollowUp.runId).not.toBe(piInitial.runId)
      expect(piFollowUp.turnId).not.toBe(piInitial.turnId)

      // Independent hunts never share a Session.
      const sessionIds = CORPUS.map(
        (hunt) => acceptedOf(pass.hunts.find((candidate) => candidate.huntId === hunt.id)!.initial, hunt.id).sessionId,
      )
      expect(new Set(sessionIds).size).toBe(CORPUS.length)

      // The hunts with no follow-up submitted one command and recorded null.
      expect(pass.hunts[1].followUp).toBeNull()
      expect(pass.hunts[3].followUp).toBeNull()

      // THE SIX-COMMAND MAXIMUM, read from what the apps themselves recorded
      // rather than from what the schedule believes it sent. Each hunt's
      // capture file lists every attempt its app saw; six across the four is
      // the bound, and an extra submission anywhere would show up here.
      const recorded = host.captures.flatMap((capture) => capture.attempts)
      expect(recorded).toHaveLength(6)
      expect(recorded.filter((attempt) => attempt.kind === 'attempt')).toHaveLength(6)
      expect(new Set(recorded.map((attempt) => attempt.attemptId)).size).toBe(6)

      // PROMPT/KEY SEPARATION at the seam: what reached the pipeline is the
      // approved text exactly (asserted above, which is stricter than any
      // substring rule) and carries no evaluator source — the assistant has
      // to find its own.
      for (const hunt of CORPUS) {
        const record = pass.hunts.find((candidate) => candidate.huntId === hunt.id)!
        expect(acceptedOf(record.initial, hunt.id).text).not.toMatch(/https?:\/\//i)
      }

      // The set file describes the whole planned population, and #224's own
      // reader accepts it.
      const set = captureSetOf(pass, { setId: 'set-whole', mode: 'verification', sessions: host.sessions })
      expect(set.slots).toHaveLength(6)
      expect(set.state).toBe('complete')
      const validation = validateCaptureSet(JSON.parse(JSON.stringify(set)))
      expect(validation.ok ? [] : validation.errors).toEqual([])
    },
    10 * 60_000,
  )

  it(
    'starts each independent hunt on a profile that kept nothing from the last',
    async () => {
      // Hunt one leaves a cookie in its profile; hunt two visits the same
      // origin and must not find it. A cleared Feed would not show this — the
      // cookie lives in the browser partition, which is exactly what a
      // reused profile would carry across.
      const start = scriptedStart({
        [WATCH.id]: [navigate(fixture.url('/set-cookie')), answer('COOKIE SET')],
        [VOYAGER.id]: [navigate(fixture.url('/cookie-echo')), answer('COOKIE READ')],
      })

      const cookies: Record<string, string> = {}
      const probing: StartCaptureSession = async (options) => {
        const session = await start(options)
        return {
          ...session,
          captureCommand: async (input) => {
            const record = await session.captureCommand(input)
            // Read the partition's own cookie jar from the page the Run
            // navigated to, while the app is still up.
            cookies[options.huntId] = await session.harness!.paneEval<string>('document.cookie')
            return record
          },
        }
      }

      const host = createHuntCaptureHost(probing, { mode: 'verification', setId: 'set-isolation', root })
      const pass = await runLiveWebPass(host, { hunts: [WATCH, VOYAGER] })

      expect(pass.commandsSubmitted).toBe(2)
      // The first hunt really did set it...
      expect(cookies[WATCH.id]).toContain('bb_profile=persisted')
      // ...and the second hunt, on the same origin, never saw it.
      expect(cookies[VOYAGER.id]).not.toContain('bb_profile=persisted')
      expect(host.sessions).toHaveLength(2)
    },
    10 * 60_000,
  )

  it(
    'records a not-reached follow-up when the Session the initial ran in is gone',
    async () => {
      // The model asks for a fresh Session mid-Run. The replay lands in a
      // replacement Session, which #225 forbids the follow-up from riding —
      // so the continuation is refused and the command is recorded as not
      // reached, with no second submission of any kind.
      const start = scriptedStart({
        [PI.id]: [
          { kind: 'tool_calls', calls: [{ id: 'reset', name: 'new_session', args: {} }] },
          answer('ANSWERED IN A REPLACEMENT SESSION'),
          answer('THIS FOLLOW-UP MUST NEVER RUN'),
        ],
      })
      const host = createHuntCaptureHost(start, { mode: 'verification', setId: 'set-lost', root })

      const pass = await runLiveWebPass(host, { hunts: [PI] })

      const followUp = pass.hunts[0].followUp!
      expect(followUp.status).toBe('not-reached')
      if (followUp.status !== 'not-reached') throw new Error('unreachable')
      // The reset's replacement Session is not the one the initial was
      // accepted into, and the capture says so by naming both.
      expect(followUp.reason).toBe('session_lost')
      expect(followUp.detail).toMatch(/the live Session .+ is not the accepted /)
      // The bound is spent on the initial alone: no replacement Session was
      // created to make the follow-up possible, and nothing was retried.
      expect(pass.commandsSubmitted).toBe(1)

      const set = captureSetOf(pass, { setId: 'set-lost', mode: 'verification', sessions: host.sessions })
      // The slot still exists in the plan, so a reader sees the command that
      // never happened rather than a shorter pass.
      expect(set.slots.filter((slot) => slot.huntId === PI.id)).toHaveLength(2)

      // AND THE REASON IS DURABLE. This is the part a pass record cannot be
      // trusted for: it dies with the process. The capture file must carry
      // the not-reached follow-up itself, or a grader reading only the
      // artifacts sees an unaccounted slot and cannot tell a lost Session
      // from an access wall from a Run still waiting on help.
      const recorded = host.captures.flatMap((capture) => capture.attempts)
      expect(recorded).toHaveLength(2)
      const followUpRecord = recorded.find((attempt) => attempt.stepId === 'follow_up')!
      expect(followUpRecord.kind).toBe('not_reached')
      if (followUpRecord.kind !== 'not_reached') throw new Error('unreachable')
      expect(followUpRecord.reason).toMatch(/^session_lost: /)
      expect(followUpRecord.attemptId).toBe(
        set.slots.find((slot) => slot.stepId === 'follow_up')!.attemptId,
      )
    },
    10 * 60_000,
  )
})
