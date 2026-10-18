import type { BrowserController, PageLanding, VisualGroundingController } from '../../core/ports/browser'
import { DEFAULT_DECISION_THRESHOLDS, type DecisionModel } from '../../core/ports/decisionModel'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandRunState } from '../../core/pipeline/runState'
import type { PageLink, PageSnapshot } from '../../core/browser/snapshot'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { commandPageOf, describeCommand, targetLabel, type Command, type CommandPage } from '../../core/command/command'
import { dismissCommand, isDismissPhrase } from '../../core/command/dismissDialog'
import { COMMAND_HELP } from '../../core/command/help'
import { bestGuess, headsAnotherVerb, localMatch } from '../../core/command/localMatch'
import { commandQuestions, commandState, doneLine, partialQuestions, readCommandAnswers, setAsideOf, type DoneResult, type HopContext, type SetAside } from '../../core/command/jevReading'
import { blockedOrInertAction } from '../../core/browser/actionOutcome'
import { isAddressShaped, openAddress } from '../../core/command/openAddress'
import { nameMatch, soundsAlike } from '../../core/command/nameMatch'
import {
  MISFIRE_WINDOW_MS,
  jevDetailOf,
  misfireSignal,
  type CommandLogRecord,
  type CommandReading,
  type CommandSource,
  type DecisionRecord,
  type NameSource,
  type TaskEnded,
  type TaskHop,
} from '../../core/command/decisionRecord'
import { parseSearchUrl } from '../../core/browser/urlInput'
import { pageReadPart, pageReadText } from '../../core/browser/pageText'
import { SPOKEN_FAILURES, failureLineOf, spokenFailureOf } from '../../core/command/spokenFailure'
import { STOPPED_ANSWERS, bestGuessAnswer, commandAnswer, pageReadCard } from '../../core/command/answer'
import type { SpeakOutcome, TtsSpeaker } from '../../core/ports/tts'
import { reportFault } from '../../core/trace/fault'
import { isRealPage, type LastPage } from '../../core/browser/lastPage'
import type { ActionEffect } from '../browser/createCdpBrowserController'

// The command seam (kachow, #324, ADR 0076): where a typed or spoken line
// lands and becomes one Command. The Local Match first — the CLI grammar,
// or a plain verb and the label exactly one ref carries — fires with no
// model asked; else one Jev call, three Choices over the transcript and
// the page's refs, the top Choice acted on at any confidence; else, when
// Jev does not answer, the Local Match's best guess. Nothing asks "did you
// mean"; a Misfire is recovered by the next Command and counted. Every
// step is published on the event stream the Feed and the Status Capsule
// read: one `command` per Command carrying the words heard and the action
// taken, and a `reaction` span and one decision record for each.
//
// The Name Match (ADR 0077, #325) sits between the reading and the action:
// a spoken Slot that is search terms or text to type, and sounds like a
// name the page shows (its Page Terms) or one the user has taught the app
// (the Learned Terms), is carried as that name's spelling; what was heard
// stays on the decision record. A name the page witnessed is learned at
// once; a chain of retries that ends with the user moving on proposes its
// last Slot, admitted when it recurs.
//
// Speech (#327): `read` speaks the Page Read's text, sentence by sentence,
// after its Card is shown, and stays the Command in flight until the text
// ends, the Abort Head, or the next Command silences it; its Reaction
// closes on the first spoken sample. A Command that fails, or lands on an
// Action Outcome class, speaks one plain line (spokenFailure.ts), marked a
// failure. Every other action stays silent; a best guess that landed shows
// an Answer naming what it fired (#329).
//
// A Task (#328, ADR 0076 amendment): an Utterance is one or more Commands.
// Hop 0 is read as above. A Task goes on after a Command Jev read and ends
// after one the Local Match settled: each further hop collects the landing
// and asks Jev alone — the same three Choices plus `done`, against the whole
// transcript, the addresses visited and the actions taken — until it says
// `done` or `none`, an action meets a wall, five actions have fired, two
// hops in a row change nothing (#336: each such hop's target is set aside),
// Jev does not answer, or a later Utterance, Escape or the Abort Head
// supersedes it. One `command` event and one decision record per hop. A
// dismiss phrase over an open dialog closes it before Jev is asked (#336).

export type { CommandRunState }

export interface CommandRunOptions {
  /** The voice turn's id, minted at the Endpoint; a typed Command mints one here. */
  readonly turnId?: string
  /** The spoken Utterance hit the 30 s cap: recorded, never shown. */
  readonly truncated?: boolean
  /** The tracer's monotonic ms at the Endpoint — where the Reaction span opens. A typed Command opens it at submit. */
  readonly endpointAt?: number
  /** Where the words came from; typed when absent. */
  readonly source?: CommandSource
}

export interface CommandRunner {
  /**
   * Reads one line as a Command and performs it. A Command already in
   * flight — or still being read — is superseded: the later Command
   * stands and the earlier one's late result reaches nothing. Resolves
   * false for a blank line — nothing is published then.
   */
  run(text: string, options?: CommandRunOptions): Promise<boolean>
  getState(): CommandRunState
  /** Interrupt the Command in flight or being read (Escape, the Abort Head). Returns whether one was. */
  abort(): boolean
  /**
   * Speech started (#324): collect the page's refs now, in parallel with
   * the speech, so the list is in hand at the Endpoint. The next Command
   * reads against it; a Command that needs no page lets it go. Resolves
   * to the page collected (null when none could be), for the bias the
   * same speech is decoded under (ADR 0077).
   */
  prepare(): Promise<PageSnapshot | null>
  /**
   * A partial transcript while the user speaks (Early Fire, #326): fires
   * it now when the words so far read as a complete Command — the Local
   * Match on one that carries no Slot, else Jev's "complete command?" Noul
   * — and the Endpoint's `run` then only closes the Utterance. A partial
   * identical to the last is skipped; nothing fires once one has, nor
   * when Jev does not answer. Resolves when the partial is let go, or when
   * the Command it fired settles.
   */
  consider(partial: string): Promise<void>
  /**
   * The Utterance being spoken was let go before its Endpoint (#326): the
   * Listen closed under it, or its capture was dropped. A partial still
   * being read fires nothing, and the rest of its partials are ignored.
   */
  dropPartials(): void
}

/** The Learned Terms as the runner reads and grows them (ADR 0077). */
export interface CommandTerms {
  /** The names the user has taught the app, for the Name Match after the Page Terms. */
  learned(): readonly string[]
  /** A name the page witnessed a Slot sounding like: admitted at once. */
  admit(term: string): void
  /** A name a retry chain settled on: proposed, admitted when it recurs. */
  propose(term: string): void
  /** A spoken transcript: the Learned Terms it carries are in use. */
  observe(text: string): void
}

export interface CommandRunnerDeps {
  browser: BrowserController & Pick<VisualGroundingController, 'showRef'>
  /** The Decision Model the role resolves to now; null when none is configured. */
  decisionModel(): DecisionModel | null
  publish(event: PipelineEvent): void
  /** Wall-clock now, for the events and the records. */
  now(): number
  /** The perf tracer: turn ids, the monotonic clock the Reaction is measured on, the `reaction` span. Absent keeps the runner unmeasured. */
  tracer?: PerfTracer
  /** The decision log beside the perf log; absent writes nothing. */
  decisionLog?: { write(record: CommandLogRecord): void }
  /** Hears the browser's first observable effect of an action (#324); the returned release stops hearing. */
  onEffect?(listener: (effect: ActionEffect) => void): () => void
  /** Hears how a navigation landed (#328), for the hop's decision record; the returned release stops hearing. */
  onLanding?(listener: (landing: PageLanding) => void): () => void
  screenshotDir(): string
  saveScreenshot(path: string, bytes: Uint8Array): Promise<void>
  /** The Learned Terms (ADR 0077); absent reads names off the page alone and learns nothing. */
  terms?: CommandTerms
  /** The voice (#327): a Page Read and a failure's line are spoken through it; absent keeps every Command silent. */
  speech?: Pick<TtsSpeaker, 'speak' | 'stop'>
  /** The Last Page (CONTEXT.md), for `resume`; absent, or null, leaves `resume` nothing to reopen. */
  lastPage?(): LastPage | null
}

/** How much of a Page Read the Feed card shows. */
const DISPLAY_LIMIT = 4_000

/**
 * How long a page collected at speech start stays good for: an Utterance
 * can be at most this long, so a prepared page older than this belongs to
 * speech the VAD let go, and the page may have moved on since.
 */
const PREPARED_MAX_AGE_MS = 30_000

/**
 * How long a retry chain stays open (ADR 0077): a Slot spoken this long
 * after the one before, sounding like it, is a retry of it; the Command
 * that moves on inside this window settles the chain on its last Slot.
 */
const RETRY_CHAIN_WINDOW_MS = 60_000

/** How many actions a Task may fire, hop 0's and scrolls included (#328): the fifth ends it where it stands. */
const MAX_TASK_ACTIONS = 5

/** The verbs a Jev-read Task goes on after (#328); every other verb ends it. */
const CONTINUING: ReadonlySet<Command['verb']> = new Set(['open', 'click', 'type', 'press', 'scroll_up', 'scroll_down', 'back', 'forward', 'reload'])

/**
 * How a Task ends on this hop's reading alone (#328), before anything
 * fires; null when it goes on after the action — a Jev-read continuing
 * verb, whose own landing decides.
 */
function endedByReading(reading: CommandReading, verb: Command['verb'], hop: number): TaskEnded | null {
  if (reading === 'local_match') return 'local_match'
  if (reading === 'best_guess') return 'unavailable'
  if (verb === 'done') return 'done'
  if (verb === 'none') return hop === 0 ? 'terminal' : 'none'
  return CONTINUING.has(verb) ? null : 'terminal'
}

/** What a fired action came to: it landed, it met a wall (it failed, or speaks a failure's line), or a later Command superseded it. */
type FireOutcome = 'landed' | 'wall' | 'superseded'

/** A fired action's outcome, how its navigation landed when it made one (#328), and whether it changed nothing (#336). */
interface FireResult {
  readonly outcome: FireOutcome
  readonly landing?: PageLanding
  /** The action landed and moved nothing: no navigation, and the click's own verdict "no observable change". */
  readonly unchanged?: true
}

/** How many hops in a row that change nothing end a Task (#336). */
const MAX_UNCHANGED_HOPS = 2

/** The verbs that say the user moved on from a Slot: the retry chain settles on them. */
const MOVES_ON: ReadonlySet<Command['verb']> = new Set(['click', 'scroll_up', 'scroll_down', 'read', 'forward'])

/** A Name Match as the runner carries it: the words heard, the name they became, and whose spelling it is. */
interface NameMatched {
  readonly heard: string
  readonly candidate: string
  readonly from: NameSource
}

/** The page the reading sees when none can be collected: the address alone, no refs. */
function blankPage(browser: BrowserController): CommandPage {
  const state = browser.state()
  return { url: state.url ?? '', title: state.title ?? '', refs: [] }
}

/** Whether a Command's Slot is words a name could be misheard in: search terms, or text to type — never an address or a key. */
function slotIsNameable(command: Command): command is Command & { slot: string } {
  if (command.slot === null || command.slot === '') return false
  if (command.verb === 'type') return true
  return command.verb === 'open' && (command.search === true || !isAddressShaped(command.slot))
}

/** Whether the Local Match's page-free reading settles the line without the page's refs. */
function pageFree(command: Command | null): command is Command {
  if (command === null) return false
  if (command.verb === 'click' || command.verb === 'type') return false
  // "open <label>" clicks the ref that carries the label (localMatch): the page decides.
  if (command.verb === 'open' && !command.search) return false
  return true
}

/**
 * Whether a partial's Local Match may fire before the Endpoint (#326): a
 * Command that carries no Slot still being spoken — never an `open` (an
 * address or search terms: "open you" is a bare word, and the user is
 * still saying "youtube"), a `type` or a `screenshot`'s path, and never
 * `none`, which fires nothing. Jev may still fire an `open` or a `type`
 * on a partial, when its Noul says the words are complete. A verb phrase
 * that heads a longer one of another kind ("scroll", which may yet be
 * "scroll up") is held before this is asked.
 */
function firesEarly(command: Command): boolean {
  return command.verb !== 'open' && command.verb !== 'type' && command.verb !== 'screenshot' && command.verb !== 'none'
}

function toolOf(command: Command): { name: string; args: Record<string, unknown> } {
  switch (command.verb) {
    case 'open':
      return { name: 'navigate', args: { url: openAddress(command.slot ?? '', command.search === true) } }
    case 'click':
      return { name: 'click', args: { ref: command.target } }
    case 'type':
      return { name: 'type', args: { ref: command.target, text: command.slot ?? '' } }
    case 'scroll_up':
      return { name: 'scroll', args: { direction: 'up' } }
    case 'scroll_down':
      return { name: 'scroll', args: { direction: 'down' } }
    case 'press':
      return { name: 'press', args: { key: command.key?.key ?? 'Enter', times: command.times ?? 1, ...(command.key?.shift ? { shift: true } : {}) } }
    case 'read':
      return { name: 'read_page', args: {} }
    case 'screenshot':
      return { name: 'screenshot', args: command.slot ? { path: command.slot } : {} }
    default:
      return { name: command.verb, args: {} }
  }
}

/** A page collected at speech start, and when. */
interface PreparedPage {
  readonly at: number
  readonly snapshot: Promise<PageSnapshot | null>
}

export function createCommandRunner(deps: CommandRunnerDeps): CommandRunner {
  const { browser, publish, tracer } = deps
  /** The Command whose action is in flight, if one is. */
  let inFlight: { turnId: string; generation: number } | null = null
  let generation = 0
  /**
   * Counts every submission and abort: a reading that finishes after a
   * later submission (or an abort) is stale, and fires nothing.
   */
  let submitted = 0
  /** The submissions an abort made (#330): a reading the next of which went stale on was stopped, not superseded. */
  const stoppedAt = new Set<number>()
  /** The Command being read, if one is — so abort reaches it and the state says running. */
  let reading: { turnId: string; submission: number } | null = null
  let screenshotCount = 0
  /** The page collected at speech start, waiting for the Endpoint's Command. */
  let prepared: PreparedPage | null = null
  /** The Command that last fired, for the Misfire signal. */
  let previous: { turnId: string; verb: Command['verb']; key?: Command['key']; at: number } | null = null
  /** The Jev-read hop that last fired (#328), for the overrun signal; null once a Command read otherwise fires, or one is counted. */
  let jevHop: { turnId: string; hop: number; at: number } | null = null
  /** The runner's texts still sounding (a Page Read, a failure's line): the next Command or an abort silences them. */
  let sounding = 0

  const at = (): number => deps.now()
  const monotonic = (): number => tracer?.now() ?? at()

  function log(record: CommandLogRecord): void {
    try {
      deps.decisionLog?.write(record)
    } catch (error) {
      reportFault('run.commandRunner.decisionLog', error, { turnId: record.turnId })
    }
  }

  function span(turnId: string, durMs: number, detail: Record<string, unknown>): void {
    try {
      tracer?.span(turnId, 'reaction', durMs, detail)
    } catch (error) {
      reportFault('run.commandRunner.reactionSpan', error, { turnId })
    }
  }

  /** The page the Command is read against: the one prepared at speech start while it is fresh, else one collected now. */
  async function collectPage(pending: PreparedPage | null): Promise<CommandPage> {
    const fresh = pending !== null && monotonic() - pending.at <= PREPARED_MAX_AGE_MS
    const snapshot = fresh
      ? await pending.snapshot
      : await browser.collectPage().catch((error: unknown) => {
          reportFault('run.commandRunner.collectPage', error)
          return null
        })
    return snapshot === null ? blankPage(browser) : commandPageOf(snapshot)
  }

  /** The turn that last published its Answer: a Command leaves one (#333), so a second for the same turn is not shown. */
  let answeredTurn: string | null = null

  /** A Command's one Answer (#333), unless its turn already has one. */
  function answer(turnId: string, text: string, failure = false): void {
    if (answeredTurn === turnId) return
    answeredTurn = turnId
    publish({ type: 'display', turnId, text, ...(failure ? { failure: true } : {}), at: at() })
  }

  /**
   * End the Command in flight: its turn ends cancelled now, answered as a
   * Stop ended it or as a later Command did (#333) unless it already has
   * its Answer, and whatever its action answers later reaches nothing.
   */
  function cancelInFlight(by: keyof typeof STOPPED_ANSWERS): boolean {
    if (inFlight === null) return false
    const { turnId } = inFlight
    inFlight = null
    publish({ type: 'status', turnId, status: 'cancelled', at: at() })
    answer(turnId, STOPPED_ANSWERS[by])
    publish({ type: 'done', turnId, outcome: 'cancelled', at: at() })
    return true
  }

  /** Stop ends the page's load too (#330), not only the Command's wait on it: the pane stops where it stands. */
  function stopLoading(): void {
    void browser.stop().catch((error: unknown) => reportFault('run.commandRunner.stopLoading', error))
  }

  /**
   * What a reading abandoned past its submission says it came to (#330):
   * the bump right after its own decides — Escape, the Abort Head or a
   * `stop` stopped it; anything else was a later Command coming first.
   */
  const abandonedAction = (submission: number): string => (stoppedAt.has(submission + 1) ? 'abandoned: stopped' : 'abandoned: a later Command came first')

  /** Speak a Command's text (#327): one `speak` event carries it — marked when it tells a failure (#329) — and it counts as the runner's until it ends. */
  function say(speech: Pick<TtsSpeaker, 'speak'>, turnId: string, text: string, options: { onFirstSound?: () => void; failure?: boolean } = {}): Promise<SpeakOutcome> {
    const { onFirstSound, failure } = options
    publish({ type: 'speak', turnId, text, ...(failure ? { failure: true } : {}), at: at() })
    sounding += 1
    return speech
      .speak(text, { turnId, ...(onFirstSound ? { onFirstSound } : {}) })
      .catch((error: unknown): SpeakOutcome => {
        reportFault('run.commandRunner.speak', error, { turnId })
        return { ok: false, error: String(error) }
      })
      .finally(() => {
        sounding -= 1
      })
  }

  /**
   * Speak a Page Read to its end (#327): its first part's text — or that
   * the page has none — and then each further part, read when the one
   * before has been spoken to its end. A part that was cut (barge-in, the
   * Abort Head, a later Command) or failed ends the reading there.
   */
  async function speakPageRead(
    speech: Pick<TtsSpeaker, 'speak'>,
    turnId: string,
    firstPart: string,
    current: () => boolean,
    onFirstSound: () => void,
  ): Promise<void> {
    let page = firstPart
    for (let first = true; ; first = false) {
      const words = pageReadText(page)
      if (first || words !== '') {
        const outcome = await say(speech, turnId, words || SPOKEN_FAILURES.empty, { ...(first ? { onFirstSound } : {}), failure: words === '' })
        if (!outcome.ok || outcome.stopped === true) return
      }
      const at = pageReadPart(page)
      if (!current() || at === null || at.part >= at.of) return
      try {
        page = await browser.readPage(at.part + 1)
      } catch (error) {
        reportFault('run.commandRunner.readNextPart', error, { turnId })
        return
      }
    }
  }

  /**
   * A failure's one line (#329) is the Command's Answer (#333), marked a
   * failure and shown whether or not there is a voice; spoken too, not
   * waited on: the turn ends now, and the next Command silences it.
   */
  function answerFailure(turnId: string, line: string): void {
    answer(turnId, line, true)
    if (deps.speech !== undefined) void say(deps.speech, turnId, line, { failure: true })
  }

  /** Silence the runner's speech, if any is sounding; whether any was. */
  function silence(): boolean {
    if (sounding === 0) return false
    deps.speech?.stop()
    return true
  }

  interface Reading {
    command: Command
    page: CommandPage
    reading: CommandReading
    jevAsked: boolean
    jev?: DecisionRecord['jev']
  }

  /**
   * The dismiss rule (#336): a dismiss phrase over an open dialog closes it
   * before anything else reads the words, so the phrase waits for the page.
   * One the Local Match reads as `stop` ("cancel") never waits — a `stop`
   * is what ends a page still loading (#330) — and closes a dialog only
   * when the page collected at speech start is already in hand. Resolves to
   * the dismissal, or null, and the page it read when it collected one.
   */
  async function readDismissal(text: string, quick: Command | null, pending: PreparedPage | null): Promise<{ dismissal: Reading | null; page: CommandPage | null }> {
    if (!isDismissPhrase(text)) return { dismissal: null, page: null }
    const page = quick?.verb === 'stop' ? await pageInHand(pending) : await collectPage(pending)
    const dismiss = page === null ? null : dismissCommand(text, page)
    return { dismissal: dismiss === null ? null : { command: dismiss, page: page!, reading: 'local_match', jevAsked: false }, page }
  }

  /** The page collected at speech start, when it is fresh and already collected; null rather than wait for it. */
  async function pageInHand(pending: PreparedPage | null): Promise<CommandPage | null> {
    if (pending === null || monotonic() - pending.at > PREPARED_MAX_AGE_MS) return null
    // An already-settled snapshot wins the race; one still being collected loses to the settled `undefined`.
    const snapshot = await Promise.race([pending.snapshot, Promise.resolve(undefined)])
    return snapshot === undefined || snapshot === null ? null : commandPageOf(snapshot)
  }

  /**
   * The Local Match first; else one Jev call; else the best guess. A dismiss
   * phrase over an open dialog comes before all of them (#336). A spoken
   * Slot that could carry a name waits for the page, so the Name Match can
   * read it against the Page Terms.
   */
  async function read(text: string, pending: PreparedPage | null, spoken: boolean): Promise<Reading> {
    const quick = localMatch(text, [])
    const { dismissal, page: dismissPage } = await readDismissal(text, quick, pending)
    if (dismissal !== null) return dismissal
    if (pageFree(quick) && !(spoken && slotIsNameable(quick))) return { command: quick, page: dismissPage ?? blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = dismissPage ?? (await collectPage(pending))
    if (pageFree(quick)) return { command: quick, page, reading: 'local_match', jevAsked: false }
    const local = localMatch(text, page.refs, page.url)
    if (local !== null) return { command: local, page, reading: 'local_match', jevAsked: false }
    const model = deps.decisionModel()
    if (model === null) return { command: bestGuess(text, page.refs, page.url), page, reading: 'best_guess', jevAsked: false }
    const result = await model.ask({ state: commandState(text, page), questions: commandQuestions(text, page) })
    if (result.status === 'answered') {
      return {
        command: readCommandAnswers(result.answers, text, page),
        page,
        reading: 'jev',
        jevAsked: true,
        jev: jevDetailOf(result.answers, result.latencyMs, result.model),
      }
    }
    return {
      command: bestGuess(text, page.refs, page.url),
      page,
      reading: 'best_guess',
      jevAsked: true,
      jev: { model: result.model, latencyMs: result.latencyMs, reason: result.reason },
    }
  }

  /** The Learned Terms, when wired. */
  const learnedTerms = (): readonly string[] => deps.terms?.learned() ?? []

  function observeTerms(text: string): void {
    try {
      deps.terms?.observe(text)
    } catch (error) {
      reportFault('run.commandRunner.observeTerms', error)
    }
  }

  /** The retry chain (ADR 0077): the last spoken Slot, when it was spoken, and how many retries it closes. */
  let chain: { slot: string; at: number; length: number } | null = null

  /**
   * What a fired spoken Command teaches: a Name Match the page witnessed
   * is a name the user says and the page spells, admitted at once; a Slot
   * sounding like the one before extends a retry chain; a Command that
   * moves on after a chain of two or more settles it on its last Slot,
   * proposed and admitted only when it recurs.
   */
  function learnFrom(command: Command, name: NameMatched | null, firedAt: number): void {
    try {
      if (name?.from === 'page') deps.terms?.admit(name.candidate)
      if (slotIsNameable(command)) {
        const retry = chain !== null && firedAt - chain.at <= RETRY_CHAIN_WINDOW_MS && soundsAlike(chain.slot, command.slot, 1)
        chain = { slot: command.slot, at: firedAt, length: retry ? chain!.length + 1 : 1 }
        return
      }
      if (chain === null || !MOVES_ON.has(command.verb)) return
      if (chain.length >= 2 && firedAt - chain.at <= RETRY_CHAIN_WINDOW_MS) deps.terms?.propose(chain.slot)
      chain = null
    } catch (error) {
      reportFault('run.commandRunner.learnFrom', error)
    }
  }

  /**
   * What `resume` does (CONTEXT.md, Last Page): the pane still on a page —
   * the Idle Screen only ever hid it — needs nothing reopened, so the
   * Command names the page and fires no action; a pane that boots blank
   * after a restart navigates to the Last Page, and that is a navigate in
   * every respect (its landing read for walls, its line the navigate's).
   */
  function resumePlan(): { tool: { name: string; args: Record<string, unknown> }; perform: () => Promise<string> } {
    const state = browser.state()
    const last = deps.lastPage?.() ?? null
    if (isRealPage(state.url)) {
      const title = state.title ?? ''
      return { tool: { name: 'resume', args: {} }, perform: async () => `resumed: url=${state.url} title=${JSON.stringify(title)}` }
    }
    if (last === null) return { tool: { name: 'resume', args: {} }, perform: async () => 'nothing to resume: no page has been visited yet' }
    return { tool: { name: 'navigate', args: { url: last.url } }, perform: () => browser.navigate(last.url) }
  }

  /** Whether a dialog is still open over the page after a dismissal (#336); a page that cannot be read is taken as closed. */
  async function dialogStillOpen(): Promise<boolean> {
    try {
      return (await browser.collectPage()).dialogOpen
    } catch (error) {
      reportFault('run.commandRunner.dialogStillOpen', error)
      return false
    }
  }

  /** The chosen ref lights as the action lands — after it, never before: the flash is a DOM change of our own making, and must not be the effect the Reaction closes on. */
  function flash(ref: number): void {
    void browser.showRef(ref).catch((error: unknown) => reportFault('run.commandRunner.showRef', error))
  }

  async function perform(command: Command, resume: ReturnType<typeof resumePlan> | null): Promise<string> {
    switch (command.verb) {
      case 'resume':
        return (resume ?? resumePlan()).perform()
      case 'open':
        return browser.navigate(openAddress(command.slot ?? '', command.search === true))
      case 'click': {
        const result = await browser.click(command.target ?? 0)
        flash(command.target ?? 0)
        return result
      }
      case 'type': {
        const result = await browser.type(command.target ?? 0, command.slot ?? '')
        flash(command.target ?? 0)
        return result
      }
      case 'scroll_up':
        return browser.scroll('up')
      case 'scroll_down':
        return browser.scroll('down')
      case 'back':
        return browser.back()
      case 'forward':
        return browser.forward()
      case 'reload':
        return browser.reload()
      case 'press': {
        const key = command.key ?? { key: 'Enter' }
        await browser.pressKey(key, command.times ?? 1)
        return `pressed ${key.shift ? 'Shift+' : ''}${key.key}${(command.times ?? 1) > 1 ? ` ×${command.times}` : ''}`
      }
      case 'read':
        return browser.readPage()
      case 'clear':
        return browser.clearFocused()
      case 'screenshot': {
        const bytes = await browser.screenshot()
        screenshotCount += 1
        const path = command.slot ?? `${deps.screenshotDir()}/screenshot-${screenshotCount}.jpg`
        await deps.saveScreenshot(path, bytes)
        return `screenshot saved: ${path}`
      }
      case 'help':
        return COMMAND_HELP
      case 'stop':
        return 'stopped'
      case 'none':
      case 'done':
        return ''
    }
  }

  /**
   * What the Feed shows of a result as a Card: a Page Read's title and
   * words, its whole part — what is spoken (#333) — a screenshot's path,
   * the help; never an action's outcome line.
   */
  function cardOf(command: Command, result: string): { text: string; failure: boolean } | null {
    if (command.verb === 'read') return pageReadCard(result)
    if (command.verb !== 'screenshot' && command.verb !== 'help') return null
    const shown = result.length > DISPLAY_LIMIT ? `${result.slice(0, DISPLAY_LIMIT)}\n…` : result
    return { text: shown === '' ? 'done' : shown, failure: false }
  }

  /** The Name Match (ADR 0077): a spoken Slot that sounds like a name on the page, or one the user taught, is carried as that name. */
  function matchName(heard: Command, page: CommandPage, spoken: boolean): { command: Command; matched: NameMatched | null } {
    if (!spoken || !slotIsNameable(heard)) return { command: heard, matched: null }
    const pageTerms = page.terms ?? []
    const match = nameMatch(heard.slot, [...pageTerms, ...learnedTerms()])
    if (match === null) return { command: heard, matched: null }
    return {
      command: { ...heard, slot: match.slot },
      matched: { heard: match.heard, candidate: match.candidate, from: pageTerms.includes(match.candidate) ? 'page' : 'learned' },
    }
  }

  function recordOf(turnId: string, firedAt: number, source: CommandSource, transcript: string, read: Reading, command: Command, matched: NameMatched | null, truncated: boolean): DecisionRecord {
    const label = targetLabel(command, read.page)
    return {
      type: 'decision',
      turnId,
      at: firedAt,
      source,
      transcript,
      reading: read.reading,
      verb: command.verb,
      target: command.target,
      ...(label !== undefined ? { targetLabel: label } : {}),
      slot: command.slot,
      ...(matched !== null ? { slotHeard: matched.heard, slotFrom: matched.from } : {}),
      jevAsked: read.jevAsked,
      ...(read.jev !== undefined ? { jev: read.jev } : {}),
      ...(truncated ? { truncated: true } : {}),
    }
  }

  /** How a fired Command's Reaction is measured and its turn closed. */
  interface Reacting {
    /** The action's first observable effect (or its end, or its first spoken sample), at the tracer's `endedAt`, as the span's detail: the Reaction closes on it. */
    react(detail: Record<string, unknown>, endedAt: number): void
    /** The action settled: the turn closes, once its Reaction is in. */
    settled(): void
  }

  /**
   * What firing a Command does once it is read: the Misfire signal, the
   * learning, superseding the Command in flight, and the action — its
   * events, its Reaction, its result. Resolves when the action settles.
   */
  async function fire(
    turnId: string,
    text: string,
    source: CommandSource,
    command: Command,
    page: CommandPage,
    readingKind: CommandReading,
    matched: NameMatched | null,
    firedAt: number,
    reacting: Reacting,
    task: TaskHop,
  ): Promise<FireResult> {
    // The Misfire signal (ADR 0076): this Command as the recovery of the one
    // that fired before it. A hop past the first is the Task's own move, never the user's recovery.
    if (previous !== null && task.hop === 0) {
      const signal = misfireSignal(previous, { verb: command.verb, key: command.key, at: firedAt })
      if (signal !== null) log({ type: 'misfire', turnId: previous.turnId, at: firedAt, signal, signalTurnId: turnId, withinMs: firedAt - previous.at })
    }
    previous = { turnId, verb: command.verb, key: command.key, at: firedAt }
    // A Jev-read hop: what an overrun is read against, until the next one fires.
    jevHop = readingKind === 'jev' ? { turnId, hop: task.hop, at: firedAt } : null
    if (source === 'spoken') learnFrom(command, matched, firedAt)

    // A later Command supersedes the one in flight, and silences what it was saying; `stop` is only that.
    cancelInFlight(command.verb === 'stop' ? 'stopped' : 'superseded')
    silence()
    generation += 1
    const mine = generation
    inFlight = { turnId, generation: mine }
    const current = (): boolean => inFlight !== null && inFlight.generation === mine

    publish({ type: 'command', turnId, text, action: describeCommand(command, page), task, at: firedAt })
    if (command.verb === 'stop') {
      // `stop` is an abort said in words: a reading it went past was stopped, and the page's load ends with it.
      stoppedAt.add(submitted)
      stopLoading()
      inFlight = null
      answer(turnId, STOPPED_ANSWERS.stopped)
      publish({ type: 'done', turnId, outcome: 'done', at: at() })
      return { outcome: 'landed' }
    }
    publish({ type: 'status', turnId, status: 'acting', at: at() })
    const callId = `${turnId}-1`
    // `resume` decides once, here, whether it is a navigate: the tool the Feed names and the action performed agree.
    const resume = command.verb === 'resume' ? resumePlan() : null
    const { name, args } = resume !== null ? resume.tool : toolOf(command)
    publish({ type: 'tool_call', turnId, callId, name, args, at: at() })

    // The Reaction (CONTEXT.md): Endpoint to the action's first observable
    // effect — or, for a read that is spoken (#327), to its first spoken sample.
    const speech = command.verb === 'read' ? deps.speech : undefined
    let reacted = false
    const react = (effect: string, endedAt = monotonic()): void => {
      if (reacted) return
      reacted = true
      reacting.react({ verb: command.verb, effect, reading: readingKind, source }, endedAt)
    }
    const release = deps.onEffect?.((effect) => {
      if (current() && speech === undefined) react(effect)
    })
    // How its navigation landed (#328), heard while it is the Command in flight.
    let landing: PageLanding | undefined
    const releaseLanding = deps.onLanding?.((landed) => {
      if (current()) landing = landed
    })
    let unchanged = false
    const ended = (outcome: FireOutcome): FireResult => ({ outcome, ...(landing !== undefined ? { landing } : {}), ...(unchanged && landing === undefined ? { unchanged: true } : {}) })
    try {
      const result = await perform(command, resume)
      if (!current()) return ended('superseded')
      let outcome: FireOutcome = 'landed'
      unchanged = blockedOrInertAction(result) === 'inert'
      const card = cardOf(command, result)
      if (speech === undefined) react(card !== null && command.verb === 'read' ? 'display' : 'settled')
      publish({ type: 'tool_result', turnId, callId, name, ok: true, result, at: at() })
      if (card !== null) answer(turnId, card.text, card.failure)
      if (speech !== undefined) {
        const shownAt = monotonic()
        publish({ type: 'status', turnId, status: 'speaking', at: at() })
        await speakPageRead(speech, turnId, result, current, () => {
          if (current()) react('spoken')
        })
        if (!current()) return ended('superseded')
        // Nothing was spoken (the voice failed, or was cut first): the Card was the effect.
        react('display', shownAt)
      } else {
        const state = browser.state()
        const failure =
          spokenFailureOf({ tool: name, outcome: { ok: true, result }, ...(state.url ? { url: state.url } : {}), ...(state.title ? { title: state.title } : {}) }) ??
          (command.dismiss === true && (await dialogStillOpen()) ? 'dialogStayed' : null)
        if (!current()) return ended('superseded')
        if (failure !== null) {
          answerFailure(turnId, SPOKEN_FAILURES[failure])
          outcome = 'wall'
        } else if (card === null) {
          // One Answer per Command (#333), from its verb's sentence — a best guess's names what it fired (#329), so an unread line never reads as nothing done.
          const label = targetLabel(command, page)
          const text =
            readingKind === 'best_guess' ? bestGuessAnswer(command, page) : commandAnswer(command, { page: { url: state.url ?? '', title: state.title ?? '' }, ...(label !== undefined ? { label } : {}) })
          if (text !== null) answer(turnId, text)
        }
      }
      inFlight = null
      publish({ type: 'done', turnId, outcome: 'done', at: at() })
      return ended(outcome)
    } catch (error) {
      if (!current()) return ended('superseded')
      react('failed')
      const message = error instanceof Error ? error.message : String(error)
      publish({ type: 'tool_result', turnId, callId, name, ok: false, error: message, at: at() })
      answerFailure(turnId, failureLineOf(name, message))
      inFlight = null
      publish({ type: 'done', turnId, outcome: 'failed', at: at() })
      return ended('wall')
    } finally {
      release?.()
      releaseLanding?.()
      reacting.settled()
    }
  }

  function summarize(turnId: string): void {
    try {
      tracer?.summarize(turnId)
    } catch (error) {
      reportFault('run.commandRunner.summarize', error, { turnId })
    }
  }

  /**
   * The overrun signal (#328): Escape, "stop", the Abort Head or a new
   * Utterance this soon after a Jev-read hop fired says the Task went on
   * past what the user wanted; it counts against that hop, once.
   */
  function overrun(signalTurnId?: string): void {
    if (jevHop === null) return
    const now = at()
    const withinMs = now - jevHop.at
    if (withinMs <= MISFIRE_WINDOW_MS) log({ type: 'misfire', turnId: jevHop.turnId, at: now, signal: 'overrun', ...(signalTurnId !== undefined ? { signalTurnId } : {}), withinMs, hop: jevHop.hop })
    jevHop = null
  }

  /** A Task under way (#328): its id (hop 0's turn id), the submission that started it, its words, and where it has been. */
  interface Task {
    readonly id: string
    readonly submission: number
    readonly text: string
    readonly source: CommandSource
    /** The tracer's monotonic ms at the Endpoint: where the `task` span opens. */
    readonly endpointAt: number
    readonly visited: string[]
    /** Each action fired and what it did, as "Done so far" tells it (#336). */
    readonly actions: string[]
    /** The targets of hops that changed nothing (#336): not offered again. */
    readonly setAside: SetAside[]
    /** How many hops in a row have changed nothing (#336). */
    unchanged: number
  }

  function visit(task: Task, url: string): void {
    if (url !== '' && url !== 'about:blank' && task.visited.at(-1) !== url) task.visited.push(url)
  }

  /** Whether a later submission (a Command, an Early Fire) or an abort has superseded the Task. */
  const superseded = (task: Task): boolean => task.submission !== submitted

  /** How a continuing hop's action came out, for the Task (#328): its end, or null when it goes on. */
  function endedByAction(task: Task, outcome: FireOutcome): TaskEnded | null {
    if (outcome === 'superseded' || superseded(task)) return 'superseded'
    if (outcome === 'wall') return 'wall'
    if (task.unchanged >= MAX_UNCHANGED_HOPS) return 'unchanged'
    return task.actions.length >= MAX_TASK_ACTIONS ? 'cap' : null
  }

  /**
   * A hop's record before it fires (#328): written now when nothing it does
   * can change it — a Task that ends on a verb that leaves no page. A hop
   * whose verb lands is written by {@link settleHop}, with its landing.
   */
  function recordBeforeFiring(record: DecisionRecord, ending: TaskEnded | null, command: Command): void {
    if (ending !== null && !CONTINUING.has(command.verb)) log({ ...record, ended: ending })
  }

  /**
   * A hop has fired (#328): its record is written with how its navigation
   * landed and, when the Task ends here, how. A Task goes on from a
   * Jev-read hop that landed, under the cap; resolves to its end, or null.
   */
  function settleHop(task: Task, record: DecisionRecord, ending: TaskEnded | null, command: Command, page: CommandPage, fired: FireResult): TaskEnded | null {
    const landed = fired.landing !== undefined ? { landing: fired.landing } : {}
    if (ending !== null) {
      if (CONTINUING.has(command.verb)) log({ ...record, ...landed, ended: ending })
      return ending
    }
    task.actions.push(doneLine(command, page, doneResult(page, fired)))
    if (fired.unchanged === true) {
      // A hop that changed nothing (#336): its target is not offered again, and a second in a row ends the Task.
      task.unchanged += 1
      const target = page.refs.find((ref) => ref.ref === command.target)
      if (target !== undefined) task.setAside.push(setAsideOf(target, page))
    } else {
      task.unchanged = 0
    }
    const ended = endedByAction(task, fired.outcome)
    log({ ...record, ...landed, ...(ended !== null ? { ended } : {}) })
    return ended
  }

  /** What a fired hop did, for "Done so far" (#336): nothing, or the page it left the tab on when that is another one. */
  function doneResult(page: CommandPage, fired: FireResult): DoneResult {
    if (fired.unchanged === true) return { changed: false }
    const after = browser.state().url ?? ''
    return isRealPage(after) && after !== page.url ? { changed: true, opened: after } : { changed: true }
  }

  /** A Task's end (#328): the `task` span, from its Endpoint, on hop 0's turn. */
  function endTask(task: Task, ended: TaskEnded, hops: number): TaskEnded {
    try {
      tracer?.span(task.id, 'task', Math.max(0, monotonic() - task.endpointAt), { ended, hops, actions: task.actions.length, source: task.source })
    } catch (error) {
      reportFault('run.commandRunner.taskSpan', error, { turnId: task.id })
    }
    summarize(task.id)
    return ended
  }

  /** A hop that fires nothing: its words greyed in the Feed with what it came to, and its turn closed. */
  function dropHop(turnId: string, task: Task, hop: number, action: string, outcome: 'done' | 'cancelled', firedAt: number): void {
    publish({ type: 'command', turnId, text: task.text, action, dropped: true, task: { id: task.id, hop }, at: firedAt })
    publish({ type: 'done', turnId, outcome, at: at() })
  }

  /** A search landing's whole-page links (#328), where its results below the fold are; none when they cannot be read. */
  async function resultPageLinks(turnId: string): Promise<readonly PageLink[]> {
    try {
      return (await browser.pageLinks()) ?? []
    } catch (error) {
      reportFault('run.commandRunner.pageLinks', error, { turnId })
      return []
    }
  }

  /**
   * The hops past the first (#328): each collects the landing the last
   * action left, asks Jev alone what comes next, and fires it — until the
   * Task ends. Resolves to how it ended.
   */
  async function continueTask(task: Task, from: number): Promise<TaskEnded> {
    for (let hop = from; ; hop += 1) {
      const turnId = tracer?.mintTurnId() ?? `${task.id}-hop${hop}`
      const spoken = task.source === 'spoken'
      // The hop is being read: the Task is running, and abort reaches it.
      reading = { turnId, submission: task.submission }
      const page = superseded(task) ? blankPage(browser) : await collectPage(null)
      visit(task, page.url)
      const links = !superseded(task) && parseSearchUrl(page.url) !== null ? await resultPageLinks(turnId) : []
      const context: HopContext = { hop, visited: [...task.visited], actions: [...task.actions], links, setAside: [...task.setAside] }
      const model = deps.decisionModel()
      const result = superseded(task) || model === null ? null : await model.ask({ state: commandState(task.text, page, context), questions: commandQuestions(task.text, page, context) })
      if (reading?.turnId === turnId) reading = null
      const firedAt = at()
      const base = { type: 'decision' as const, turnId, at: firedAt, source: task.source, transcript: task.text, reading: 'jev' as const, task: { id: task.id, hop } }
      const none = { verb: 'none' as const, target: null, slot: null }

      if (result === null || result.status !== 'answered') {
        const jev = result === null ? undefined : { model: result.model, latencyMs: result.latencyMs, reason: result.reason }
        const ended: TaskEnded = superseded(task) ? 'superseded' : 'unavailable'
        log({ ...base, ...none, jevAsked: result !== null, ...(jev !== undefined ? { jev } : {}), ended })
        dropHop(turnId, task, hop, ended === 'superseded' ? abandonedAction(task.submission) : 'not read', ended === 'superseded' ? 'cancelled' : 'done', firedAt)
        return endTask(task, ended, hop + 1)
      }

      const read: Reading = { command: readCommandAnswers(result.answers, task.text, page, context), page, reading: 'jev', jevAsked: true, jev: jevDetailOf(result.answers, result.latencyMs, result.model) }
      const { command, matched } = matchName(read.command, page, spoken)
      const record = { ...recordOf(turnId, firedAt, task.source, task.text, read, command, matched, false), task: { id: task.id, hop } }
      if (superseded(task)) {
        // A later Command, Escape or the Abort Head came while this hop was read: the reading is data, nothing fires.
        log({ ...record, ended: 'superseded' })
        dropHop(turnId, task, hop, abandonedAction(task.submission), 'cancelled', firedAt)
        return endTask(task, 'superseded', hop + 1)
      }
      const ending = endedByReading('jev', command.verb, hop)
      if (command.verb === 'done' || command.verb === 'none') {
        log({ ...record, ended: ending! })
        dropHop(turnId, task, hop, command.verb === 'done' ? 'done' : 'no next step', 'done', firedAt)
        return endTask(task, ending!, hop + 1)
      }
      recordBeforeFiring(record, ending, command)
      const fired = await fire(turnId, task.text, task.source, command, page, 'jev', matched, firedAt, { react: () => {}, settled: () => summarize(turnId) }, { id: task.id, hop })
      const ended = settleHop(task, record, ending, command, page, fired)
      if (ended !== null) return endTask(task, ended, hop + 1)
    }
  }

  // Early Fire (#326, ADR 0076): a partial transcript that already reads
  // as a complete Command fires before the Endpoint. Each Utterance is the
  // speech between one speech start (`prepare`) and its Endpoint (`run`);
  // its partials are considered in order, at most one Jev call in flight,
  // and once one fires the rest are let go.

  /** Counts Utterances: bumped at speech start and at each Endpoint, so a partial's late reading knows its Utterance is gone. */
  let utterance = 0
  /** The partial last considered in this Utterance: an identical one is skipped. */
  let lastPartial: string | null = null
  /** A partial heard while another was being read: considered next, the newest only. */
  let waitingPartial: string | null = null
  let considering = false
  /** Jev calls made on this Utterance's partials, for the record its Endpoint writes. */
  let partialCalls = 0

  /** A Command fired on a partial, waiting for its Utterance's Endpoint to write its record and close its Reaction. */
  interface EarlyFired {
    readonly utterance: number
    readonly turnId: string
    readonly partial: string
    /** The tracer's monotonic ms when it fired (the record's `at` is wall-clock). */
    readonly firedMono: number
    readonly record: DecisionRecord
    readonly noul?: number
    /** The submission it made, which its Task is superseded past (#328). */
    readonly submission: number
    readonly command: Command
    readonly page: CommandPage
    /** What its action came to, once it settles: hop 0's, which the Endpoint's Task goes on from (#328). */
    outcome: Promise<FireResult>
    /** The Endpoint's monotonic ms, once it came. */
    endpointAt: number | null
    /** The first effect seen before the Endpoint: the Reaction closes on it, at 0, once the Endpoint comes. */
    effect: { detail: Record<string, unknown>; at: number } | null
    settled: boolean
  }
  let early: EarlyFired | null = null

  /** Whether a partial of this Utterance has fired: its other partials are let go. */
  const firedIn = (of: number): boolean => early !== null && early.utterance === of

  function leadOf(fired: EarlyFired): number {
    return Math.max(0, (fired.endpointAt ?? fired.firedMono) - fired.firedMono)
  }

  function reactingEarly(fired: EarlyFired): Reacting {
    return {
      react(detail, now) {
        if (fired.endpointAt === null) {
          fired.effect = { detail, at: now }
          return
        }
        span(fired.turnId, Math.max(0, now - fired.endpointAt), { ...detail, earlyFire: true, leadMs: leadOf(fired) })
      },
      settled() {
        fired.settled = true
        if (early !== fired) summarize(fired.turnId)
      },
    }
  }

  /**
   * An Early Fire's Utterance is over: its decision record is written —
   * with the Endpoint's transcript and the lead, when the Endpoint is what
   * closed it — and a Reaction whose effect came first is closed at 0.
   * The record carries how its Task ended (#328); `deferred` leaves the
   * writing to the caller, for a hop 0 its Task goes on from once its
   * action lands. An Utterance that never reached its Endpoint ends after
   * hop 0: superseded, when Jev read a hop that would have gone on.
   */
  function closeEarly(fired: EarlyFired, endpoint: { transcript: string; at: number; truncated: boolean } | null, ended: TaskEnded | 'deferred' = endedByReading(fired.record.reading, fired.record.verb, 0) ?? 'superseded'): DecisionRecord {
    early = null
    if (endpoint !== null) fired.endpointAt = endpoint.at
    const record: DecisionRecord = {
      ...fired.record,
      ...(endpoint !== null ? { transcript: endpoint.transcript } : {}),
      ...(endpoint?.truncated ? { truncated: true } : {}),
      earlyFire: { partial: fired.partial, ...(endpoint !== null ? { leadMs: leadOf(fired) } : {}), ...(fired.noul !== undefined ? { noul: fired.noul } : {}) },
      ...(partialCalls > 0 ? { partialCalls } : {}),
    }
    if (ended !== 'deferred') log({ ...record, ended })
    if (endpoint !== null && fired.effect !== null) {
      span(fired.turnId, Math.max(0, fired.effect.at - endpoint.at), { ...fired.effect.detail, earlyFire: true, leadMs: leadOf(fired) })
    }
    if (fired.settled) summarize(fired.turnId)
    return record
  }

  /** A new Utterance (speech start) or the end of one (its Endpoint): what the last one's partials left is let go. */
  function nextUtterance(): void {
    utterance += 1
    lastPartial = null
    waitingPartial = null
    partialCalls = 0
  }

  /** A partial's reading, when it settles a Command that may fire before the Endpoint. */
  async function readPartial(words: string, stale: () => boolean): Promise<(Reading & { noul?: number }) | null> {
    // "scroll" may yet be "scroll up": the words are known to be unfinished, so no one is asked.
    if (headsAnotherVerb(words)) return null
    const quick = localMatch(words, [])
    const { dismissal, page: dismissPage } = await readDismissal(words, quick, prepared)
    if (stale()) return null
    if (dismissal !== null) return dismissal
    if (pageFree(quick) && firesEarly(quick)) return { command: quick, page: blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = dismissPage ?? (await collectPage(prepared))
    if (stale()) return null
    const local = localMatch(words, page.refs, page.url)
    if (local !== null && firesEarly(local)) return { command: local, page, reading: 'local_match', jevAsked: false }
    const model = deps.decisionModel()
    if (model === null) return null
    partialCalls += 1
    const result = await model.ask({ state: commandState(words, page), questions: partialQuestions(words, page) })
    // Jev unavailable on a partial: nothing fires, and the Endpoint reads as before.
    if (stale() || result.status !== 'answered') return null
    const noul = result.answers.complete.noul
    if (noul < DEFAULT_DECISION_THRESHOLDS.noul) return null
    const command = readCommandAnswers(result.answers, words, page)
    if (command.verb === 'none') return null
    return { command, page, reading: 'jev', jevAsked: true, jev: jevDetailOf(result.answers, result.latencyMs, result.model), noul }
  }

  /** Reads one partial; when it fires, resolves to the action under way (boxed, so it is not awaited here). */
  async function considerOne(words: string): Promise<{ action: Promise<void> } | null> {
    const mine = utterance
    const since = submitted
    // A later Endpoint, Utterance, submission or abort makes the reading stale; so does a partial of the same Utterance that fired first.
    const stale = (): boolean => mine !== utterance || since !== submitted || firedIn(mine)
    const found = await readPartial(words, stale)
    if (found === null || stale()) return null
    const turnId = tracer?.mintTurnId() ?? `turn-${at().toString(36)}`
    // A new Utterance firing soon after a Jev-read hop: the Task overran (#328).
    overrun(turnId)
    // An Early Fire is a submission: a reading still under way for an earlier Command is stale now.
    submitted += 1
    const firedAt = at()
    const { command, matched } = matchName(found.command, found.page, true)
    const hop0: TaskHop = { id: turnId, hop: 0 }
    const fired: EarlyFired = {
      utterance: mine,
      turnId,
      partial: words,
      firedMono: monotonic(),
      record: { ...recordOf(turnId, firedAt, 'spoken', words, found, command, matched, false), task: hop0 },
      ...(found.noul !== undefined ? { noul: found.noul } : {}),
      submission: submitted,
      command,
      page: found.page,
      outcome: Promise.resolve({ outcome: 'landed' }),
      endpointAt: null,
      effect: null,
      settled: false,
    }
    early = fired
    fired.outcome = fire(turnId, words, 'spoken', command, found.page, found.reading, matched, firedAt, reactingEarly(fired), hop0)
    return { action: fired.outcome.then(() => {}) }
  }

  return {
    getState: () => (inFlight === null && reading === null && sounding === 0 ? 'idle' : 'running'),

    abort() {
      const acting = reading !== null || inFlight !== null
      const had = acting || sounding > 0
      // Escape, "stop" or the Abort Head soon after a Jev-read hop fired: the Task overran (#328).
      overrun()
      // A reading under way is stale from here: when its answer comes, it fires nothing.
      submitted += 1
      stoppedAt.add(submitted)
      reading = null
      cancelInFlight('stopped')
      silence()
      // A Command in flight or being read may be waiting on a page still loading: the load ends with it.
      if (acting) stopLoading()
      return had
    },

    prepare() {
      // Speech started: a new Utterance. An Early Fire whose Utterance never reached an Endpoint is recorded without one.
      if (early !== null) closeEarly(early, null)
      nextUtterance()
      prepared = {
        at: monotonic(),
        snapshot: browser.collectPage().catch((error: unknown) => {
          reportFault('run.commandRunner.prepare', error)
          return null
        }),
      }
      return prepared.snapshot
    },

    async consider(partial) {
      const words = partial.trim()
      if (words === '' || words === lastPartial) return
      lastPartial = words
      if (firedIn(utterance)) return
      if (considering) {
        waitingPartial = words
        return
      }
      // The one partial call in flight: held while a partial is read, let go
      // once one fires — the action runs outside it, so the next Utterance's
      // partials are read while it does.
      considering = true
      let fired: { action: Promise<void> } | null = null
      try {
        let next: string | null = words
        while (next !== null && fired === null) {
          waitingPartial = null
          fired = await considerOne(next)
          next = firedIn(utterance) ? null : waitingPartial
        }
      } finally {
        considering = false
      }
      if (fired !== null) await fired.action
    },

    dropPartials() {
      nextUtterance()
    },

    async run(text, options) {
      const trimmed = text.trim()
      if (trimmed === '') return false
      const source: CommandSource = options?.source ?? 'typed'
      const endpointAt = options?.endpointAt ?? monotonic()
      const truncated = options?.truncated === true

      // The Endpoint of an Utterance a partial already fired on closes it (#326): the final transcript is not read again for hop 0.
      // A Task hop 0 goes on from waits for this Endpoint, and its hops read the final transcript (#328).
      const fired = early
      if (fired !== null && source === 'spoken' && fired.utterance === utterance) {
        observeTerms(trimmed)
        prepared = null
        const ending = endedByReading(fired.record.reading, fired.record.verb, 0)
        // A hop 0 whose verb lands is recorded once it has, with its landing.
        const lands = ending === null || CONTINUING.has(fired.command.verb)
        const record = closeEarly(fired, { transcript: trimmed, at: endpointAt, truncated }, lands ? 'deferred' : ending)
        nextUtterance()
        if (options?.turnId !== undefined) summarize(options.turnId)
        const task: Task = { id: fired.turnId, submission: fired.submission, text: trimmed, source, endpointAt, visited: [], actions: [], setAside: [], unchanged: 0 }
        visit(task, fired.page.url)
        const ended = lands ? settleHop(task, record, ending, fired.command, fired.page, await fired.outcome) : ending
        if (ended !== null) endTask(task, ended, 1)
        else await continueTask(task, 1)
        return true
      }
      // A spoken Endpoint of another Utterance: the Early Fire never reached its own. A typed line leaves it waiting for its Endpoint.
      if (fired !== null && source === 'spoken') closeEarly(fired, null)
      const calls = source === 'spoken' ? partialCalls : 0
      // An Endpoint (or a typed line) ends the Utterance: a partial still being read fires nothing.
      if (source === 'spoken') nextUtterance()

      const turnId = options?.turnId ?? tracer?.mintTurnId() ?? `turn-${at().toString(36)}`
      // When it was given (#330): an abandoned reading is filed here, however late its reading ends.
      const givenAt = at()
      // A new Utterance soon after a Jev-read hop fired: the Task overran (#328).
      overrun(turnId)
      // This submission: a reading still under way for an earlier one is stale now.
      submitted += 1
      const submission = submitted
      reading = { turnId, submission }
      // The prepared page is this Command's, whether it needs it or not.
      const pending = prepared
      prepared = null

      const heard = await read(trimmed, pending, source === 'spoken')
      if (reading !== null && reading.submission === submission) reading = null
      const firedAt = at()
      if (source === 'spoken') observeTerms(trimmed)

      // This Utterance is a Task (#328); hop 0 is the Command read above.
      const task: Task = { id: turnId, submission, text: trimmed, source, endpointAt, visited: [], actions: [], setAside: [], unchanged: 0 }
      const hop0: TaskHop = { id: turnId, hop: 0 }
      visit(task, heard.page.url || (browser.state().url ?? ''))
      const { command, matched } = matchName(heard.command, heard.page, source === 'spoken')
      const record: DecisionRecord = { ...recordOf(turnId, firedAt, source, trimmed, heard, command, matched, truncated), ...(calls > 0 ? { partialCalls: calls } : {}), task: hop0 }

      if (submission !== submitted) {
        // A later Command (or an abort) arrived while this one was being
        // read: the later one stands. The reading is data; nothing fires.
        log({ ...record, ended: 'superseded' })
        publish({ type: 'command', turnId, text: trimmed, action: abandonedAction(submission), dropped: true, task: hop0, at: givenAt })
        publish({ type: 'done', turnId, outcome: 'cancelled', at: at() })
        endTask(task, 'superseded', 1)
        return true
      }

      // A reading that ends the Task before it fires is recorded so now; a hop that goes on, once its action has landed.
      const ending = endedByReading(heard.reading, command.verb, 0)
      recordBeforeFiring(record, ending, command)
      if (command.verb === 'none' || command.verb === 'done') {
        // An Utterance read as no Command, or as the page already being what was asked: one greyed entry of the words, nothing else.
        publish({ type: 'command', turnId, text: trimmed, ...(command.verb === 'done' ? { action: 'already here' } : {}), dropped: true, task: hop0, at: firedAt })
        publish({ type: 'done', turnId, outcome: 'done', at: at() })
        endTask(task, ending!, 1)
        return true
      }

      const result = await fire(
        turnId,
        trimmed,
        source,
        command,
        heard.page,
        heard.reading,
        matched,
        firedAt,
        {
          react: (detail, endedAt) => span(turnId, endedAt - endpointAt, detail),
          settled: () => summarize(turnId),
        },
        hop0,
      )
      const ended = settleHop(task, record, ending, command, heard.page, result)
      if (ended !== null) endTask(task, ended, 1)
      else await continueTask(task, 1)
      return true
    },
  }
}
