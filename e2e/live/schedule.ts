// The four-hunt pilot schedule (#225) — what a pass submits, in what order,
// with what isolation, and what it records when a follow-up cannot happen.
//
// WHY THIS IS A MODULE AND NOT A TEST BODY. The schedule carries every rule
// the pilot's integrity rests on — one attempt per command, six commands a
// pass, no retry, no coaching, no replacement Session, grading never in the
// loop. Those rules are worth more as a testable object than as control flow
// buried in an Electron test that costs twenty minutes and real money to
// exercise. Everything here is verified with a fake host in schedule.test.ts;
// the Electron seam proves the adapter, not the arithmetic.
//
// THE PORT. `HuntCaptureHost` is deliberately narrow. #224 owns the capture
// foundation — launching Electron, restoring the benchmark profile, minting a
// fresh Session, submitting through the real Prompt Bar, observing pipeline
// acceptance, timing the Answer, archiving diagnostics — and its capture
// record is far richer than anything below. The schedule reads two fields of
// it (`accepted`, `measurementFault`) and passes the rest through untouched,
// so #224's record can grow without this file changing.
//
// WHAT THE PORT CANNOT DO, ON PURPOSE. There is no method to answer an Ask,
// approve a confirmation, sign in, solve a challenge, retry, reset, steer, or
// start a replacement Session. #225 forbids all of them, and a capability the
// port does not expose cannot be reached for under deadline pressure. A Run
// that ends waiting for help is a not-reached follow-up with a reason — that
// is the whole of the handling.
//
// GRADING IS NOT IN THIS LOOP. Nothing here reads an Answer's correctness, and
// the port offers no way to. A follow-up is delivered because its initial Run
// ended and the Session can take another command — never because the initial
// was right. That is #225's rule and #223's story 11: conditioning delivery on
// correctness would hand a weaker assistant an easier evaluation population.

import { liveWebHunts, scheduledCommandCount, type HuntId, type LiveWebHunt, type MeasuredPrompt } from './hunts.ts'

/** Where a command sits in its hunt. Reporting groups initial and follow-up separately. */
export type CommandRole = 'initial' | 'follow-up'

/**
 * The part of a capture the schedule reads. #224's record is the real one and
 * satisfies this structurally; keeping the view this narrow is what stops the
 * schedule from growing an opinion about timings or answers.
 */
export interface ScheduledAttempt {
  /**
   * Set when the capture declined to dispatch: nothing was submitted at all.
   * The capture runs its own readiness check immediately before submitting,
   * so a Session that lapsed between the schedule's check and the capture's
   * lands here. Such a command spends no budget and is recorded as not
   * reached — calling it an attempt would claim a Run that never existed.
   */
  declined: { reason: NotReachedReason; detail: string } | null
  /**
   * Pipeline acceptance — a Run exists and carries an identity. NOT task
   * success, and not "the DOM form submitted". A command that was rejected
   * (busy, no Session) was never a Run.
   */
  accepted: boolean
  /**
   * Broken measurement, if any: the harness failed, not the task. Recorded
   * apart from the Run's own outcome so a instrumentation bug can never be
   * read as a task failure, nor the reverse (#225).
   */
  measurementFault: string | null
}

/** Why a follow-up that the corpus defines was not submitted. Never a success. */
export type NotReachedReason =
  /** The initial Run ended waiting on the user. Answering it is forbidden, so the hunt stops here. */
  | 'awaiting_help'
  /** The Session that ran the initial is gone; continuing would need a replacement Session, which #225 forbids. */
  | 'session_lost'
  /** The Session is alive but could not take another command inside the capture contract's bound. */
  | 'session_unavailable'
  /** The initial command was never accepted, so there is no Run to continue. */
  | 'initial_not_accepted'
  /** The harness broke. Broken measurement, reported as such, never as a task result. */
  | 'capture_failed'

/** Whether a hunt's Session can take its follow-up, and why not when it cannot. */
export type ContinuationState =
  | { ready: true }
  | { ready: false; reason: NotReachedReason; detail: string }

/**
 * One hunt's live context: a fresh Session on a freshly restored benchmark
 * profile. The follow-up is submitted through this same context, which is how
 * "preserve the Session and profile within a hunt" is expressed — there is no
 * way to submit a follow-up anywhere else.
 */
export interface HuntContext<TAttempt extends ScheduledAttempt> {
  /**
   * Hand over one command, at most once per prompt, ever.
   *
   * The host decides whether the Session can take it: when it cannot, it
   * submits nothing, returns a capture whose `declined` says why, and records
   * that refusal durably. When it can, it submits once — never retrying,
   * never steering — and sets `measurementFault` rather than throwing if the
   * harness itself fails.
   */
  submit(prompt: MeasuredPrompt, role: CommandRole): Promise<TAttempt>
  /** Archive diagnostics, then tear down the Session and disposable profile. */
  end(): Promise<void>
}

export interface HuntCaptureHost<TAttempt extends ScheduledAttempt> {
  /**
   * Begin an independent hunt: a fresh Session and a dedicated benchmark
   * Browser Profile restored to the same clean starting state. Independent
   * hunts must share no Session evidence and no mutated browser storage, so an
   * implementation restores the profile here rather than merely clearing the
   * Feed.
   */
  beginHunt(hunt: LiveWebHunt): Promise<HuntContext<TAttempt>>
}

/**
 * A scheduled command either happened exactly once, or explicitly did not and
 * says why. There is no third state, and in particular no absent one: #225
 * requires every scheduled command to be attempted or recorded as not reached,
 * never silently dropped, so both roles share this shape.
 */
export type CommandRecord<TAttempt extends ScheduledAttempt> =
  | { status: 'attempted'; promptVersion: number; attempt: TAttempt }
  | { status: 'not-reached'; promptVersion: number; reason: NotReachedReason; detail: string }

/**
 * One hunt's whole contribution to a pass. The initial attempt and the
 * follow-up are separate fields, which is how "a failed initial Answer is not
 * overwritten by its follow-up" is enforced: there is no assignment that could
 * overwrite it, so grading downstream always sees both.
 */
export interface HuntRecord<TAttempt extends ScheduledAttempt> {
  huntId: HuntId
  /** The initial command. */
  initial: CommandRecord<TAttempt>
  /** The follow-up, or `null` for the two hunts the corpus gives none. */
  followUp: CommandRecord<TAttempt> | null
}

export interface PassRecord<TAttempt extends ScheduledAttempt> {
  /** The hunts, in schedule order. */
  hunts: HuntRecord<TAttempt>[]
  /** Commands actually submitted, and the bound they were held to. */
  commandsSubmitted: number
  commandBudget: number
}

/**
 * The pilot's absolute work bound: four initial submissions plus the two
 * eligible predefined follow-ups (#225). Stated here as a number rather than
 * derived from the corpus, so that growing the corpus cannot silently grow
 * what a paid pass may spend.
 */
export const PILOT_COMMAND_CEILING = 6

/**
 * Every command in a pass whose measurement broke, as sentences naming the
 * hunt. Empty when the pass was measured — including when hunts simply failed,
 * which is a finding rather than a fault.
 */
export function brokenMeasurements<TAttempt extends ScheduledAttempt>(pass: PassRecord<TAttempt>): string[] {
  const broken: string[] = []
  for (const hunt of pass.hunts) {
    for (const record of [hunt.initial, hunt.followUp]) {
      if (record === null) continue
      if (record.status === 'not-reached' && record.reason === 'capture_failed') {
        broken.push(`${hunt.huntId}: ${record.detail}`)
      }
      if (record.status === 'attempted' && record.attempt.measurementFault !== null) {
        broken.push(`${hunt.huntId}: ${record.attempt.measurementFault}`)
      }
    }
  }
  return broken
}

/** Raised when the schedule would exceed the pilot's work bound. Never caught internally. */
export class CommandBudgetExceeded extends Error {
  constructor(budget: number) {
    super(
      `live-web pilot pass tried to submit more than ${budget} commands — the bound is four initial submissions plus two eligible follow-ups, at most once each (#225)`,
    )
    this.name = 'CommandBudgetExceeded'
  }
}

/**
 * The pilot's work bound, spent one command at a time. It is belt and braces:
 * the schedule submits each prompt exactly once by construction, with no loop
 * that could repeat one. The budget exists so that "at most once each" is a
 * property something checks rather than a claim about the code's shape — a
 * later edit that adds a retry trips it instead of quietly doubling a paid
 * capture. Exported so the guard itself can be tested, since by design the
 * schedule cannot reach it.
 */
export class CommandBudget {
  private spent = 0

  constructor(private readonly budget: number) {}

  /**
   * Refuse to dispatch when the bound is used up. Checked BEFORE a command
   * goes out — a guard that noticed afterwards would have already paid for
   * the command it was meant to prevent.
   */
  reserve(): void {
    if (this.spent >= this.budget) {
      throw new CommandBudgetExceeded(this.budget)
    }
  }

  /** Record a command that actually went out. */
  spend(): void {
    this.reserve()
    this.spent += 1
  }

  get submitted(): number {
    return this.spent
  }
}

export interface PassOptions {
  /**
   * The hunts to run. Defaults to the whole approved corpus. Every entry must
   * be a corpus hunt: a fixture scenario or a scripted task can never be
   * selected as a measured pilot task (#225), and passing one is a programming
   * error, not a capture result.
   */
  hunts?: readonly LiveWebHunt[]
}

/**
 * Run one bounded pilot pass.
 *
 * The shape is deliberately flat and loop-free per hunt, because every rule
 * #225 states is about something NOT happening: no second attempt at a
 * command, no retry after a failure, no extra exploratory submission, no
 * replacement Session, no correction supplied between the two commands. Each
 * of those is prevented by there being no code that could do it.
 *
 * A hunt always contributes a record. A harness failure inside one hunt ends
 * that hunt and is recorded as broken measurement; it does not abort the pass,
 * because the remaining hunts are independent by construction and abandoning
 * them would silently shrink the study.
 */
export async function runLiveWebPass<TAttempt extends ScheduledAttempt>(
  host: HuntCaptureHost<TAttempt>,
  options: PassOptions = {},
): Promise<PassRecord<TAttempt>> {
  const hunts = resolveCorpusHunts(options.hunts ?? liveWebHunts())

  const scheduled = scheduledCommandCount(hunts)
  if (scheduled > PILOT_COMMAND_CEILING) {
    // The bound #225 states is absolute, not merely whatever the corpus adds
    // up to. If the corpus ever grows past it, a pass refuses to start rather
    // than quietly spending more — and corpus.test.ts trips first, pinning
    // the corpus and this ceiling to the same number.
    throw new CommandBudgetExceeded(PILOT_COMMAND_CEILING)
  }
  const budget = new CommandBudget(scheduled)
  const records: HuntRecord<TAttempt>[] = []

  for (const hunt of hunts) {
    records.push(await runHunt(host, hunt, budget))
  }

  return { hunts: records, commandsSubmitted: budget.submitted, commandBudget: scheduledCommandCount(hunts) }
}

/**
 * One independent hunt: a fresh Session on a freshly restored benchmark
 * profile, its initial command, and its follow-up when it has one.
 *
 * Sequential by construction — the context is ended before the next hunt
 * begins, so no two hunts are ever live at once and none can observe
 * another's Session evidence or mutated browser storage.
 *
 * A harness failure ends THIS hunt and is recorded as broken measurement; the
 * remaining hunts still run, because they are independent by construction and
 * abandoning them would silently shrink the study. Every command the corpus
 * scheduled still appears in the record, as an attempt or as a reason.
 */
async function runHunt<TAttempt extends ScheduledAttempt>(
  host: HuntCaptureHost<TAttempt>,
  hunt: LiveWebHunt,
  budget: CommandBudget,
): Promise<HuntRecord<TAttempt>> {
  let context: HuntContext<TAttempt>
  try {
    context = await host.beginHunt(hunt)
  } catch (error) {
    // No Session, so neither command was ever sent and no budget was spent.
    return huntNotReached(hunt, 'capture_failed', `the hunt could not be started: ${describe(error)}`)
  }

  try {
    budget.reserve()
    let initial: TAttempt
    try {
      initial = await context.submit(hunt.prompt, 'initial')
    } catch (error) {
      // A throw is a protocol error — a concurrent call, a reused attempt id,
      // a closed session — so no command went out and no budget was spent. It
      // is never retried either way: the pilot allows one attempt at a task.
      return huntNotReached(hunt, 'capture_failed', `the initial command could not be dispatched: ${describe(error)}`)
    }

    if (initial.declined) {
      // The capture's own readiness check refused between this schedule's
      // check and the submit. Nothing was submitted, so this is a not-reached
      // command, not a Run that went badly.
      return {
        huntId: hunt.id,
        initial: notReached(hunt.prompt, initial.declined.reason, initial.declined.detail),
        followUp: hunt.followUp
          ? notReached(hunt.followUp, 'initial_not_accepted', 'the initial command was never dispatched')
          : null,
      }
    }

    budget.spend()
    return {
      huntId: hunt.id,
      initial: { status: 'attempted', promptVersion: hunt.prompt.version, attempt: initial },
      followUp: hunt.followUp ? await followUpOf(context, hunt.followUp, budget) : null,
    }
  } finally {
    // Diagnostics are archived here, so a hunt that failed still leaves its
    // evidence behind. A teardown failure must not mask the hunt's result.
    await context.end().catch(() => undefined)
  }
}

/** A scheduled command that did not happen, with the reason it did not. */
function notReached(prompt: MeasuredPrompt, reason: NotReachedReason, detail: string): CommandRecord<never> {
  return { status: 'not-reached', promptVersion: prompt.version, reason, detail }
}

/** Neither of a hunt's commands happened, for the same reason. */
function huntNotReached(hunt: LiveWebHunt, reason: NotReachedReason, detail: string): HuntRecord<never> {
  return {
    huntId: hunt.id,
    initial: notReached(hunt.prompt, reason, detail),
    followUp: hunt.followUp ? notReached(hunt.followUp, reason, detail) : null,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Deliver a hunt's follow-up, once, or say why it was not reached.
 *
 * The readiness decision is the HOST'S, not the schedule's, and that is the
 * whole point. A schedule that decided for itself — asking whether the Session
 * could continue and returning before dispatching — would leave the reason
 * nowhere but memory: the host writes a durable record only for a command it
 * was actually handed, so a follow-up refused before dispatch vanished from
 * every artifact and a report could only call the slot unaccounted. #225
 * requires the reason to be retained, so the command is always handed over and
 * the host records its own refusal.
 *
 * Handing it over is not submitting it. A host that cannot take the command
 * declines it without sending anything, spends no budget, and says why — which
 * is the same guarantee the old pre-check gave, minus the lost evidence.
 */
async function followUpOf<TAttempt extends ScheduledAttempt>(
  context: HuntContext<TAttempt>,
  prompt: MeasuredPrompt,
  budget: CommandBudget,
): Promise<CommandRecord<TAttempt>> {
  budget.reserve()
  let attempt: TAttempt
  try {
    attempt = await context.submit(prompt, 'follow-up')
  } catch (error) {
    // Never re-sent: the follow-up is allowed one submission and it has had
    // its turn at one.
    return notReached(prompt, 'capture_failed', `the follow-up could not be dispatched: ${describe(error)}`)
  }
  if (attempt.declined) {
    return notReached(prompt, attempt.declined.reason, attempt.declined.detail)
  }
  budget.spend()
  return { status: 'attempted', promptVersion: prompt.version, attempt }
}

/**
 * Resolve a selection back to the approved corpus, and dispatch THAT.
 *
 * Checking that an id is known is not enough: an object carrying a corpus id
 * and substituted prompt text would pass an id check and then be sent to a
 * measured Session. So the caller's objects are used only to choose which
 * hunts run — every prompt actually dispatched is the corpus's own. A fixture
 * page or a scripted task cannot be dressed up as an approved one, which is
 * what #225 means by fixtures being verification-only.
 */
function resolveCorpusHunts(hunts: readonly LiveWebHunt[]): LiveWebHunt[] {
  const corpus = liveWebHunts()
  const seen = new Set<string>()
  return hunts.map((hunt) => {
    const approved = corpus.find((candidate) => candidate.id === hunt.id)
    if (!approved) {
      throw new Error(
        `"${hunt.id}" is not an approved live-web hunt — measured pilot tasks come from the corpus, never from a fixture or scripted scenario (#225)`,
      )
    }
    if (seen.has(hunt.id)) {
      throw new Error(`"${hunt.id}" appears twice in one pass — a hunt is attempted at most once (#225)`)
    }
    seen.add(hunt.id)
    return approved
  })
}
