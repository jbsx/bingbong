import type { BrowserController, PageLanding, VisualGroundingController } from '../../core/ports/browser'
import { DEFAULT_DECISION_THRESHOLDS, type DecisionChoiceAnswer, type DecisionModel, type DecisionQuestions, type DecisionResult } from '../../core/ports/decisionModel'
import { askImageFile, type AskKind } from '../../core/decision/askRecord'
import type { AskLogSink } from './askLogSink'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandRunState } from '../../core/pipeline/runState'
import type { PageLink, PageSnapshot } from '../../core/browser/snapshot'
import type { PerfTracer } from '../../core/perf/perfTracer'
import type { BrowserSubspans } from '../../core/perf/browserSubspans'
import { PRESS_KEYS, commandPageOf, describeCommand, isMounting, targetLabel, commandKeepsIdle, verbNeedsPage, type Command, type CommandPage } from '../../core/command/command'
import { dismissalLadder, isDismissPhrase, obstacleOf, ruledDismissal, type DismissChoice } from '../../core/command/dismissDialog'
import { COMMAND_HELP } from '../../core/command/help'
import { carriesWordsPastAddress, headsAnotherVerb, isSearchLanding, localMatch, resultRefsOf } from '../../core/command/localMatch'
import { isWebEngineSearch } from '../../core/command/siteScope'
import {
  commandQuestions,
  whereQuestions,
  markQuestions,
  textlessRefsOf,
  isTextlessGuess,
  MARKS_IMAGE,
  type CommandQuestions,
  commandState,
  doneAction,
  doneFacts,
  doneLine,
  hopQuestions,
  partialQuestions,
  readCommandAnswers,
  readDismissChoice,
  readProgress,
  readSteps,
  dismissPhraseQuestions,
  readVerdict,
  freshRefs,
  refIdentityOf,
  refNamed,
  runnerUpOf,
  PROGRESS_FLOOR,
  setAsideOf,
  slotWords,
  type Appliance,
  type DoneResult,
  type HopContext,
  type SetAside,
  type StepContext,
  type Verdict,
} from '../../core/command/jevReading'
import { blockedOrInertAction, mediaOpHead } from '../../core/browser/actionOutcome'
import { navigateAddress, searchAddress } from '../../core/command/openAddress'
import { hearNames, nameMatch, soundsAlike, type NameHearing } from '../../core/command/nameMatch'
import {
  MAX_TASK_ACTIONS,
  MISFIRE_WINDOW_MS,
  jevDetailOf,
  misfireSignal,
  type CommandLogRecord,
  type CommandReading,
  type CommandSource,
  type DecisionRecord,
  type NameSource,
  type PickSource,
  type TaskEnded,
  type TaskHop,
} from '../../core/command/decisionRecord'
import { pageReadPart, pageReadText } from '../../core/browser/pageText'
import { SCROLL_END_OF_PAGE } from '../../core/browser/scrollDelta'
import { ONE_SCREEN, scrollOpOfVerb } from '../../core/command/scrollOp'
import { DEAD_END_LANDINGS, DONE_LINE, SPOKEN_FAILURES, failureLineOf, landedUrl, notHereLine, spokenFailureOf } from '../../core/command/spokenFailure'
import { STOPPED_ANSWERS, commandAnswer, controlsOnlyLine, noResponseAnswer, pageReadCard } from '../../core/command/answer'
import { grammarErrorOf } from '../../core/command/cliGrammar'
import { describeDuration } from '../../core/timer/duration'
import type { Timer } from '../../core/timer/timer'
import type { SpeakOutcome, TtsSpeaker } from '../../core/ports/tts'
import { reportFault } from '../../core/trace/fault'
import { isRealPage, type LastPage } from '../../core/browser/lastPage'
import type { ActionEffect } from '../browser/createCdpBrowserController'
import type { Player, PlayerOutcome } from '../music/player'

// The command seam (kachow, #324, ADR 0076): where a typed or spoken line
// lands and becomes one Command. The Local Match first — the CLI grammar,
// or a plain verb and the label exactly one ref carries — fires with no
// model asked; else one Jev call, the action card over the transcript and
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
// failure. Every other action stays silent, but for a Task's end (#399):
// one done after more than one action says "Done.", and one that hit the
// cap or lost Jev past hop 0 says it could not finish, marked a failure. A
// best guess that landed shows an Answer naming what it fired (#329).
//
// A Task (#328, ADR 0076 amendment): an Utterance is one or more Commands.
// Hop 0 is read as above. A Task goes on after a Command Jev read and ends
// after one the Local Match settled: each further hop collects the landing
// and asks Jev alone — the same action card and the Verdict, against the
// whole transcript, the addresses visited and the actions taken — until the
// Verdict is a sure yes or the card reads `none`, an action meets a wall, five actions have fired, two
// hops in a row change nothing (#336) or are sure not to have helped (the
// Progress Noul at or under 0.3, #373) — each such action set aside by its
// card label — Jev does not answer, or a later Utterance, Escape or the Abort Head
// supersedes it. One `command` event and one decision record per hop. A
// dismiss phrase over an open dialog closes it before Jev is asked (#336).
// A hop whose Verdict is a sure "in the way" over a dialog steps aside
// (#354): the runner fires the dialog's dismissal as that hop and the Task
// goes on, once per Obstacle — the same dialog raised again is the wall —
// with the target that raised it set aside.
//
// Steps (#364, ADR 0076 "a line is Steps"): hop 0's Jev call on a line with
// a conjunction also asks where a second Command starts. A split line runs
// each Step as its own Task, in order, under the line's one Task id: its
// words read as a fresh hop 0, told the line and what the Steps before it
// did; a later Step runs only once the one before ended done. A partial is
// never split, nor a line the grammar settles whole.
//
// Look then act (#363, ADR 0079): a hop with no next step and no sure yes,
// after a hop that opened something on the same page — a menu, a panel —
// closes it, Escape and then the opener again, and fires the reading
// before's runner-up once; a Task that looked again and found nothing says
// "I couldn't find <words> here.", leaving nothing it opened open.

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
  /** The browser sub-span channel (#32): each Command's browser work is its turn's, so the controller's sub-spans land against it (#377). Absent, none are opened. */
  subspans?: Pick<BrowserSubspans, 'runInTurn'>
  /** The decision log beside the perf log; absent writes nothing. */
  decisionLog?: { write(record: CommandLogRecord): void }
  /**
   * The asks sidecar beside it (#338): every Jev call's whole ask; absent
   * writes nothing. An ask's image (the Mark Ask's, #382) is saved beside
   * it, the ask naming the file `saveImage` answers; absent, or answering
   * null, the ask names none.
   */
  askLog?: Pick<AskLogSink, 'write'> & Partial<Pick<AskLogSink, 'saveImage'>>
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
  /** A landing on no page worth going back to (not found, unavailable, empty): the Last Page leaves it (2026-10-22 audit). */
  dropLastPage?(url: string): void
  /** The Timer (CONTEXT.md), for `timer` — and `stop`, which silences it ringing; absent leaves `timer` a failure. */
  timer?: Pick<Timer, 'set' | 'cancel' | 'silence'>
  /** The Player (#343, CONTEXT.md), for `play` — and `stop` with nothing in flight, which pauses it; absent leaves `play` a failure and offers Jev no Appliance Verb. */
  player?: Pick<Player, 'perform' | 'pauseAll' | 'queue'>
  /** A wait on the clock, for the results of a Web Engine's landing ({@link RESULTS_WAIT_MS}); tests make it immediate. */
  sleep?(ms: number): Promise<void>
}

/**
 * The most a hop waits for a Web Engine's landing to show a result among
 * its refs (2026-10-19): the engine's script draws the results after the
 * landing goes quiet — DuckDuckGo's about a second after — and a hop that
 * read the page before then saw the engine's chrome alone, clicked its
 * Search button, which re-submitted the words and reset the page, and
 * read chrome again next hop, to the cap. Polled at {@link RESULTS_POLL_MS}.
 */
export const RESULTS_WAIT_MS = 3_000
export const RESULTS_POLL_MS = 250

/**
 * The most a hop waits for a page still mounting to draw (post mortem
 * 2026-10-19 23:26, {@link isMounting}): the landing ends at the load
 * event, which a script-drawn site fires on its empty shell. Polled at
 * {@link RESULTS_POLL_MS}.
 */
export const MOUNTING_WAIT_MS = 3_000

/** How much of a Page Read the Feed card shows. */
const DISPLAY_LIMIT = 4_000

/** A screenshot's result line: the path it was saved at. */
const SCREENSHOT_SAVED_RE = /^screenshot saved: (.*)$/

/**
 * A screenshot's Card, in the Feed's plain style: the folder it went to by
 * name, never the path. The result line keeps the path for the CLI.
 */
function screenshotCardOf(result: string): string {
  const path = SCREENSHOT_SAVED_RE.exec(result)?.[1]
  if (path === undefined) return result
  const folder = path.split(/[\\/]/).slice(0, -1).filter((part) => part !== '').pop()
  return folder === undefined ? 'Saved a screenshot.' : `Saved a screenshot to ${folder}.`
}

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

/** The verbs a Jev-read Task goes on after (#328); every other verb ends it. */
const CONTINUING: ReadonlySet<Command['verb']> = new Set(['navigate', 'search', 'click', 'type', 'menu', 'press', 'scroll_up', 'scroll_down', 'back', 'forward', 'reload'])

/**
 * How a Task ends on this hop's reading alone (#328), before anything
 * fires; null when it goes on after the action — a Jev-read continuing
 * verb, whose own landing decides, or a Local-Matched open of an address
 * whose Utterance carries words past it (`wordsPast`, #341).
 */
function endedByReading(reading: CommandReading, verb: Command['verb'], wordsPast = false): TaskEnded | null {
  if (reading === 'local_match') return wordsPast ? null : 'local_match'
  if (reading === 'best_guess') return 'unavailable'
  // At a hop past the first, `none` is the Verdict's to end (continueTask), never read here.
  if (verb === 'none') return 'terminal'
  return CONTINUING.has(verb) ? null : 'terminal'
}

/** The Command a line Jev could not read becomes (#353): the Local Match already settled none, and nothing guesses. */
const UNREAD: Command = { verb: 'none', target: null, slot: null }

/** The verbs whose record waits for the action (#328): a continuing verb's landing, the video `play` opened or queued (#343), and a Media Op's refusal (#372). */
function recordedAfterFiring(verb: Command['verb']): boolean {
  return CONTINUING.has(verb) || verb === 'play' || verb === 'media'
}

/** What a fired action came to: it landed, it met a wall (it failed, or speaks a failure's line), or a later Command superseded it. */
/** `stayed`: a dismissal whose dialog is still open, with another rung of the Dismissal Ladder to try (#354) — no failure said yet. */
type FireOutcome = 'landed' | 'wall' | 'superseded' | 'stayed'

/** A fired action's outcome, how its navigation landed when it made one (#328), and whether it changed nothing (#336). */
interface FireResult {
  readonly outcome: FireOutcome
  readonly landing?: PageLanding
  /** The action landed and moved nothing: no navigation, and the click's own verdict "no observable change". */
  readonly unchanged?: true
  /** For `play` (#343): the video the Player opened or queued. */
  readonly video?: string
  /** For a `play` search (#345): where its video came from. */
  readonly pick?: PickSource
  /** The action threw: its message, for the record (post mortem 2026-10-19). */
  readonly error?: string
}

/** How many hops in a row that change nothing, or that the Progress Noul is sure did not help, end a Task (#336, #373). */
const MAX_STALLED_HOPS = 2

/** The verbs that say the user moved on from a Slot: the retry chain settles on them. */
const MOVES_ON: ReadonlySet<Command['verb']> = new Set(['click', 'menu', 'scroll_up', 'scroll_down', 'read', 'forward'])

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
  // A music search's words (#343) are search terms like any other; a `navigate`'s Slot is an address.
  return command.verb === 'type' || command.verb === 'play' || command.verb === 'search'
}

/** Whether the Local Match's page-free reading settles the line without the page's refs. */
function pageFree(command: Command | null): command is Command {
  if (command === null) return false
  if (command.verb === 'click' || command.verb === 'type') return false
  // "open <label>" clicks the ref that carries the label (localMatch): the page decides before a navigate does.
  if (command.verb === 'navigate') return false
  return true
}

/**
 * Whether a partial's Local Match may fire before the Endpoint (#326): a
 * Command that carries no Slot still being spoken — never a `navigate`
 * or a `search` (an address or search terms: "open you" is a bare word,
 * and the user is still saying "youtube"), a `type`, a `screenshot`'s
 * path or a `timer`'s length ("set a timer for five" may yet be "…
 * minutes"), and never `none`, which fires nothing. Jev may still fire a
 * `navigate`, a `search` or a `type` on a partial, when its Noul says the
 * words are complete. A verb phrase
 * that heads a longer one of another kind ("scroll", which may yet be
 * "scroll up") is held before this is asked. A Player verb (#343) never
 * fires early, as `timer`: "play" may yet be "play bohemian rhapsody".
 */
function firesEarly(command: Command): boolean {
  return command.verb !== 'navigate' && command.verb !== 'search' && command.verb !== 'type' && command.verb !== 'screenshot' && command.verb !== 'timer' && command.verb !== 'play' && command.verb !== 'none'
}

function toolOf(command: Command): { name: string; args: Record<string, unknown> } {
  switch (command.verb) {
    case 'navigate':
      return { name: 'navigate', args: { url: navigateAddress(command.slot ?? '') } }
    case 'search':
      return { name: 'navigate', args: { url: searchAddress(command.slot ?? '', command.site) } }
    case 'click':
      return { name: 'click', args: { ref: command.target } }
    case 'type':
      return { name: 'type', args: { ref: command.target, text: command.slot ?? '', ...(command.submit === true ? { submit: true } : {}) } }
    case 'menu':
      return { name: 'menu', args: { ref: command.target } }
    case 'media':
      return { name: 'media', args: { ref: command.target, ...command.mediaOp } }
    case 'scroll_up':
    case 'scroll_down':
      return { name: 'scroll', args: { direction: scrollOpOfVerb(command.verb), ...(command.target !== null ? { ref: command.target } : {}), ...command.extent, ...(command.show !== undefined ? { show: command.show.text } : {}) } }
    case 'press':
      return { name: 'press', args: { key: command.key?.key ?? 'Enter', times: command.times ?? 1, ...(command.key?.shift ? { shift: true } : {}) } }
    case 'read':
      return { name: 'read_page', args: {} }
    case 'screenshot':
      return { name: 'screenshot', args: command.slot ? { path: command.slot } : {} }
    case 'play':
      return { name: 'play', args: { ...command.music, ...(command.slot !== null ? { words: command.slot } : {}) } }
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
  let previous: { turnId: string; verb: Command['verb']; target: number | null; key?: Command['key']; at: number } | null = null
  /** The Jev-read hop that last fired (#328), for the overrun signal; null once a Command read otherwise fires, or one is counted. */
  let jevHop: { turnId: string; hop: number; at: number } | null = null
  /** The runner's texts still sounding (a Page Read, a failure's line): the next Command or an abort silences them. */
  let sounding = 0
  /** The last submission made with nothing in flight, being read or sounding (#343): a `stop` it carries pauses the music. */
  let idleAt = -1
  /** Nothing in flight, being read or sounding: what the run state calls idle. */
  const idle = (): boolean => inFlight === null && reading === null && sounding === 0

  /**
   * What the appliance holds for the card's Appliance Verbs (#374): whether
   * the Queue holds a current song; absent while no Player is wired. The
   * card offers each verb by ability, the song's own ops being its media
   * ref's (ADR 0080).
   */
  const appliance = (): Appliance | undefined => (deps.player === undefined ? undefined : { queued: deps.player.queue().current !== null })

  /** What plays on the page paused for a `stop` (#343, #376); whether anything was playing. A failure to reach it is no pause. */
  async function pauseAll(): Promise<boolean> {
    try {
      return (await deps.player?.pauseAll()) ?? false
    } catch (error) {
      reportFault('run.commandRunner.pauseAll', error)
      return false
    }
  }

  const at = (): number => deps.now()
  const monotonic = (): number => tracer?.now() ?? at()
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  function log(record: CommandLogRecord): void {
    try {
      deps.decisionLog?.write(record)
    } catch (error) {
      reportFault('run.commandRunner.decisionLog', error, { turnId: record.turnId })
    }
  }

  /** Partial asks made so far: a partial is asked before its turn exists, so its ask id is its own. */
  let partialAsks = 0

  /**
   * One Jev call (#338): its whole ask is written to the sidecar once the
   * answer is in — never ahead of the call, where a page's state text would
   * cost the round its write — so a misread can be replayed; resolves to
   * the result, with the ask's id the reading's decision record names.
   */
  async function askJev<const Q extends DecisionQuestions>(
    model: DecisionModel,
    kind: AskKind,
    turnId: string | null,
    state: string,
    questions: Q,
    /** The ask's own id, for a turn asked twice (#364: a line's split, then its first Step); the turn's id otherwise. */
    ownId?: string,
    /** The images the state names (#382: the Mark Ask's), by reference. */
    images?: Readonly<Record<string, Uint8Array>>,
  ): Promise<DecisionResult<Q> & { readonly askId: string }> {
    const askedAt = at()
    const askId = ownId ?? turnId ?? `partial-${askedAt.toString(36)}-${(partialAsks += 1)}`
    const result = await model.ask({ state, questions, ...(images !== undefined ? { images } : {}) })
    try {
      const saved = images === undefined ? null : savedImages(askId, images)
      deps.askLog?.write({ type: 'ask', id: askId, ...(turnId !== null ? { turnId } : {}), at: askedAt, kind, model: model.model, state, questions, ...(saved !== null ? { images: saved } : {}) })
    } catch (error) {
      reportFault('run.commandRunner.askLog', error, turnId !== null ? { turnId } : {})
    }
    return { ...result, askId }
  }

  /** An ask's images saved beside it (#382), each by the file the sink named; null when none was saved. */
  function savedImages(askId: string, images: Readonly<Record<string, Uint8Array>>): Record<string, string> | null {
    const saved = Object.entries(images).flatMap(([reference, bytes], index) => {
      const file = deps.askLog?.saveImage?.(askImageFile(askId, index), bytes) ?? null
      return file === null ? [] : [[reference, file] as const]
    })
    return saved.length === 0 ? null : Object.fromEntries(saved)
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

  /** A Command's one Answer (#333), unless its turn already has one; `tone` marks a failure, or a Stop's grey. */
  function answer(turnId: string, text: string, tone?: 'failure' | 'muted'): void {
    if (answeredTurn === turnId) return
    answeredTurn = turnId
    publish({ type: 'display', turnId, text, ...(tone === 'failure' ? { failure: true } : tone === 'muted' ? { muted: true } : {}), at: at() })
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
    answer(turnId, STOPPED_ANSWERS[by], 'muted')
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
        // A page of controls alone says what it holds (2026-10-21 audit); only a page of nothing is the failure.
        const said = words || controlsOnlyLine(page) || SPOKEN_FAILURES.empty
        const outcome = await say(speech, turnId, said, { ...(first ? { onFirstSound } : {}), failure: said === SPOKEN_FAILURES.empty })
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
    answer(turnId, line, 'failure')
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
    /** The ask Jev was given (#338), when it was asked. */
    ask?: string
    /** A dismiss phrase's Dismissal Ladder past its first rung (owner's rule 2026-10-19): fired in turn while the pop-up stays. */
    ladder?: readonly Command[]
    /** Jev's action card answer (#363, #370), when it read the line: the runner-up a dead end may try comes from it. */
    action?: DecisionChoiceAnswer
    /** The line Jev split into Steps (#364): each Step's words; `command` is then the whole line's reading, never fired. */
    steps?: readonly string[]
    /** The Where Ask's reading (#379, ADR 0082), read after a hop 0 whose top choice was `none`. */
    whereAsk?: true
    /** The Verdict asked beside the Where Ask (#394), when Jev answered it. */
    verdict?: Verdict
    /** The Mark Ask's reading (#382, ADR 0084), read after a Where Ask whose top choice was `none`, over a card with a Textless Ref. */
    markAsk?: true
  }

  /** How a hop 0 is read (#364): whether Jev may split the line, and, for a Step's own words, where the Step stands and the ask's own id. */
  interface ReadOptions {
    readonly split: boolean
    readonly step?: StepContext
    readonly askId?: string
  }

  /**
   * The dismiss rule (#336): a dismiss phrase over an open dialog closes it
   * before anything else reads the words, so the phrase waits for the page.
   * One the Local Match reads as `stop` ("cancel") never waits — a `stop`
   * is what ends a page still loading (#330) — and closes a dialog only
   * when the page collected at speech start is already in hand. Resolves to
   * the dismissal, or null, and the page it read when it collected one.
   */
  async function readDismissal(turnId: string, text: string, quick: Command | null, pending: PreparedPage | null): Promise<{ dismissal: Reading | null; page: CommandPage | null }> {
    const page = await dismissPage(text, quick, pending)
    if (page === null || page.dialog === undefined) return { dismissal: null, page }
    return { dismissal: await dismissalOf(turnId, text, page), page }
  }

  /** The page a dismiss phrase is read over; null for words that are none, or a `stop` with no page in hand. */
  async function dismissPage(text: string, quick: Command | null, pending: PreparedPage | null): Promise<CommandPage | null> {
    if (!isDismissPhrase(text)) return null
    return quick?.verb === 'stop' ? await pageInHand(pending) : await collectPage(pending)
  }

  /**
   * The Dismissal Ladder a dismiss phrase walks over the pop-up (owner's
   * rule 2026-10-19: the widest net). A consent wall's reject is the
   * policy's, clicked with no one asked; otherwise Jev is asked which of
   * the pop-up's controls closes it, beside the Command's own questions,
   * and its choice goes on the ladder as a Step Aside's does. Jev
   * unavailable, the ladder stands without it. Null when nothing on the
   * pop-up can be tried.
   */
  async function dismissalOf(turnId: string, text: string, page: CommandPage): Promise<Reading | null> {
    const ruled = ruledDismissal(page)
    const model = ruled === null ? deps.decisionModel() : null
    const questions = model === null ? null : dismissPhraseQuestions(text, page, { appliance: appliance() })
    const result = model === null || questions === null ? null : await askJev(model, 'command', turnId, commandState(text, page, undefined, undefined, undefined, questions), questions)
    const chosen = result?.status === 'answered' ? readDismissChoice(result.answers, page) : null
    const ladder = dismissalLadder(page, chosen, DEFAULT_DECISION_THRESHOLDS.choice)
    const [first, ...rest] = ladder
    if (first === undefined) return null
    const asked =
      result === null
        ? {}
        : result.status === 'answered'
          ? { jev: jevDetailOf(result.answers, result.latencyMs, result.model), ask: result.askId }
          : { jev: { model: result.model, latencyMs: result.latencyMs, reason: result.reason }, ask: result.askId }
    return { command: first, page, reading: 'local_match', jevAsked: result !== null, ...asked, ...(rest.length > 0 ? { ladder: rest } : {}) }
  }

  /** The page collected at speech start, when it is fresh and already collected; null rather than wait for it. */
  async function pageInHand(pending: PreparedPage | null): Promise<CommandPage | null> {
    if (pending === null || monotonic() - pending.at > PREPARED_MAX_AGE_MS) return null
    // An already-settled snapshot wins the race; one still being collected loses to the settled `undefined`.
    const snapshot = await Promise.race([pending.snapshot, Promise.resolve(undefined)])
    return snapshot === undefined || snapshot === null ? null : commandPageOf(snapshot)
  }

  /**
   * The Local Match first; else one Jev call; else nothing (#353): the
   * Local Match already settled no Command, and no reading guesses. A
   * dismiss phrase over an open dialog comes before all of them (#336). A
   * spoken Slot that could carry a name waits for the page, so the Name
   * Match can read it against the Page Terms.
   */
  async function read(turnId: string, text: string, pending: PreparedPage | null, spoken: boolean, options: ReadOptions = { split: true }): Promise<Reading> {
    const quick = localMatch(text, [])
    const { dismissal, page: dismissed } = await readDismissal(turnId, text, quick, pending)
    if (dismissal !== null) return dismissal
    if (pageFree(quick) && !(spoken && slotIsNameable(quick))) return { command: quick, page: dismissed ?? blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = dismissed ?? (await collectPage(pending))
    if (pageFree(quick)) return { command: quick, page, reading: 'local_match', jevAsked: false }
    const local = localMatch(text, page.refs, page.url)
    if (local !== null) return { command: local, page, reading: 'local_match', jevAsked: false }
    const model = deps.decisionModel()
    if (model === null) return { command: UNREAD, page, reading: 'best_guess', jevAsked: false }
    const heard = hearingOf(text, page, spoken)
    const questions = commandQuestions(text, page, undefined, { steps: options.split, appliance: appliance(), heard })
    const result = await askJev(model, 'command', turnId, commandState(text, page, undefined, options.step, undefined, questions, heard), questions, options.askId)
    // Jev split the line (#364): each Step is read on its own, and this reading of the whole fires nothing.
    const split = result.status === 'answered' ? readSteps(result.answers, text) : null
    return { ...readingOf(result, text, page), ...(split !== null ? { steps: [split.first, split.rest] } : {}) }
  }

  /** A hop 0 reading of Jev's answer to the action card; one it did not answer is no Command, and nothing guesses (#353). */
  function readingOf(result: DecisionResult<CommandQuestions> & { readonly askId: string }, text: string, page: CommandPage): Reading {
    if (result.status === 'answered') {
      return {
        command: readCommandAnswers(result.answers, text, page),
        page,
        reading: 'jev',
        jevAsked: true,
        jev: jevDetailOf(result.answers, result.latencyMs, result.model),
        ask: result.askId,
        action: result.answers.action,
      }
    }
    return { command: UNREAD, page, reading: 'best_guess', jevAsked: true, jev: { model: result.model, latencyMs: result.latencyMs, reason: result.reason }, ask: result.askId }
  }

  /**
   * The Where Ask (#379, ADR 0082): a hop 0 whose top choice was `none`, on
   * a line Jev read, is asked once more — the same card over the same
   * page, the question changed to where the thing the words name would
   * be. Its reading is hop 0's, fired with no bar; `none` again, or no
   * answer, is no Command, and nothing guesses. The Verdict rides the
   * same call (#394): the page may already show what the words ask for.
   */
  async function readWhere(turnId: string, text: string, first: Reading, step: StepContext | undefined, heard: readonly NameHearing[]): Promise<Reading> {
    const { page } = first
    const model = deps.decisionModel()
    if (model === null) return { command: UNREAD, page, reading: 'best_guess', jevAsked: false, whereAsk: true }
    const questions = whereQuestions(text, page, { appliance: appliance(), heard })
    const result = await askJev(model, 'where', turnId, commandState(text, page, undefined, step, undefined, questions, heard), questions, `${first.ask ?? turnId}-where`)
    const verdict = result.status === 'answered' ? readVerdict(result.answers) : null
    return { ...readingOf(result, text, page), whereAsk: true, ...(verdict !== null ? { verdict } : {}) }
  }

  /**
   * The Mark Ask (#382, ADR 0084): a Where Ask that read `none` over a card
   * with a Textless Ref is asked once more — the same card, with one image
   * of the pane on which each Textless Ref is boxed with its number, those
   * refs' options reading "the control marked N". Null when it is not
   * made: no Textless Ref on the card, no model, a model that reads no
   * images (#395), or no capture (a hidden pane) — the line then ends as
   * it would have. Its reading is hop 0's,
   * fired with no bar; `none`, or no answer, is no Command.
   */
  async function readMarks(turnId: string, text: string, first: Reading, where: Reading, step: StepContext | undefined, heard: readonly NameHearing[]): Promise<Reading | null> {
    const { page } = where
    const model = deps.decisionModel()
    const capture = browser.markedScreenshot?.bind(browser)
    if (model === null || model.readsImages === false || capture === undefined) return null
    const textless = textlessRefsOf(whereQuestions(text, page, { appliance: appliance() }), page)
    if (textless.length === 0) return null
    const shot = await capture(textless)
    if (shot === null || shot.marks.length === 0) return null
    const marked = new Set(shot.marks.map((mark) => mark.ref))
    const questions = markQuestions(text, page, { appliance: appliance(), marked, heard })
    const result = await askJev(
      model,
      'mark',
      turnId,
      commandState(text, page, undefined, step, marked, questions, heard),
      questions,
      `${first.ask ?? turnId}-mark`,
      { [MARKS_IMAGE]: shot.jpeg },
    )
    const read = readingOf(result, text, page)
    // The command it reads knows it was found on the image, which its "Done so far" line says.
    return { ...read, command: read.command.target === null ? read.command : { ...read.command, marked: true }, markAsk: true }
  }

  /** Whether a Where Ask's reading is followed by a Mark Ask (#382): Jev answered it, and its top choice was `none`, at any probability. */
  const asksMarks = (where: Reading): boolean => where.whereAsk === true && asksWhere(where)

  /** Whether a hop 0 reading is an unsure click on a Textless Ref (owner ruling 2026-10-22, ADR 0084 amended), which the Mark Ask is asked in place of. */
  const guessesTextless = (first: Reading, text: string): boolean =>
    first.reading === 'jev' && first.action !== undefined && isTextlessGuess(first.action, whereQuestions(text, first.page, { appliance: appliance() }), first.page, DEFAULT_DECISION_THRESHOLDS.choice)

  /** Whether a hop 0 reading is followed by a Where Ask (#379): Jev read the line, and its top choice was `none`, at any probability. */
  const asksWhere = (first: Reading): boolean => first.reading === 'jev' && first.action?.choice === 'none'

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

  async function perform(command: Command, resume: ReturnType<typeof resumePlan> | null, current: () => boolean, onPlayed: (outcome: PlayerOutcome) => void): Promise<string> {
    switch (command.verb) {
      case 'play': {
        if (deps.player === undefined) throw new Error('no player on this surface')
        const outcome = await deps.player.perform(command.music ?? { kind: 'unpause' }, command.slot, current)
        onPlayed(outcome)
        return outcome.result
      }
      case 'resume':
        return (resume ?? resumePlan()).perform()
      case 'navigate':
        return browser.navigate(navigateAddress(command.slot ?? ''))
      case 'search':
        return browser.navigate(searchAddress(command.slot ?? '', command.site))
      case 'click': {
        const result = await browser.click(command.target ?? 0)
        flash(command.target ?? 0)
        return result
      }
      case 'type': {
        // A Search Op (#398) is the same type, the box submitted after the words.
        const result = await browser.type(command.target ?? 0, command.slot ?? '', command.submit === true ? { submit: true } : undefined)
        flash(command.target ?? 0)
        return result
      }
      case 'menu': {
        const result = await browser.openMenu(command.target ?? 0)
        flash(command.target ?? 0)
        return result
      }
      case 'media': {
        // A Media Op (#372, ADR 0080): one evaluate on the media ref's own element, beside click and type.
        if (command.mediaOp === undefined || command.target === null) throw new Error('a media Command names no op, or no ref')
        const result = await browser.mediaOp(command.target, command.mediaOp)
        flash(command.target)
        return result
      }
      case 'scroll_up':
      case 'scroll_down': {
        const direction = scrollOpOfVerb(command.verb)!
        // A Show Op (#393, ADR 0086): one evaluate bringing its block into view, never a wheel on the page.
        if (command.show !== undefined) return browser.showText(command.show)
        if (command.target === null) return browser.scroll(direction, command.extent)
        // A Scroll Op (#383, ADR 0085): one evaluate on the region's own element, never the page.
        const result = await browser.scrollRegion(command.target, direction, command.extent ?? ONE_SCREEN)
        flash(command.target)
        return result
      }
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
      case 'timer': {
        if (deps.timer === undefined) throw new Error('no timer on this surface')
        if (command.durationMs === undefined) return deps.timer.cancel() ? 'timer off' : 'timer off: none was running'
        deps.timer.set(command.durationMs)
        return `timer set: ${describeDuration(command.durationMs)}`
      }
      case 'stop':
        return 'stopped'
      case 'none':
        return ''
    }
  }

  /**
   * What the Feed shows of a result as a Card: a Page Read's title and
   * words, its whole part — what is spoken (#333) — where a screenshot
   * went, the help; never an action's outcome line.
   */
  function cardOf(command: Command, result: string): { text: string; failure: boolean } | null {
    if (command.verb === 'read') return pageReadCard(result)
    if (command.verb === 'screenshot') return { text: screenshotCardOf(result), failure: false }
    if (command.verb !== 'help') return null
    const shown = result.length > DISPLAY_LIMIT ? `${result.slice(0, DISPLAY_LIMIT)}\n…` : result
    return { text: shown === '' ? 'done' : shown, failure: false }
  }

  /** The Name Match (ADR 0077): a spoken Slot that sounds like a name on the page, or one the user taught, is carried as that name. */
  /**
   * The Hearing (#396, ADR 0077 as amended): the names a spoken line sounds
   * like, read against the Page Terms and the Learned Terms before Jev is
   * asked, so the card says them beside the words as heard. A typed line
   * is exact and hears none.
   */
  function hearingOf(text: string, page: CommandPage, spoken: boolean): readonly NameHearing[] {
    return spoken ? hearNames(text, page.terms ?? [], learnedTerms()) : []
  }

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
      ...(command.music !== undefined ? { music: command.music } : {}),
      ...(command.mediaOp !== undefined ? { mediaOp: command.mediaOp } : {}),
      ...(command.extent !== undefined ? { extent: command.extent } : {}),
      ...(command.submit === true ? { submit: true } : {}),
      target: command.target,
      ...(label !== undefined ? { targetLabel: label } : {}),
      slot: command.slot,
      ...(matched !== null ? { slotHeard: matched.heard, slotFrom: matched.from } : {}),
      jevAsked: read.jevAsked,
      ...(read.jev !== undefined ? { jev: read.jev } : {}),
      ...(read.ask !== undefined ? { ask: read.ask } : {}),
      ...(read.whereAsk ? { whereAsk: true as const } : {}),
      ...(read.markAsk ? { markAsk: true as const } : {}),
      ...(truncated ? { truncated: true } : {}),
    }
  }

  /** How a fired Command's Reaction is measured and its turn closed. */
  interface Reacting {
    /** The action's first observable effect (or its end, or its first spoken sample), at the tracer's `endedAt`, as the span's detail: the Reaction closes on it. */
    react(detail: Record<string, unknown>, endedAt: number): void
    /** The action settled: the turn closes, once its Reaction is in. */
    settled(): void
    /** A dismissal with a rung of the Dismissal Ladder still to try (#354): a dialog still open is `stayed`, not yet the failure. */
    readonly deferStay?: true
    /** A later rung of a dismiss phrase's Dismissal Ladder: the runner's own move, never the user's recovery from the rung before. */
    readonly ownMove?: true
    /**
     * A plain `navigate` that ends its Task at hop 0 (2026-10-21 audit): a pop-up open over the page it opened is said as a
     * Task's hop says it — "A pop-up is in the way." — a fact the page shows, read with no Jev call. A navigate that goes
     * on leaves the pop-up to its next hop's Verdict and Step Aside (#354).
     */
    readonly tellsPopup?: true
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
    // that fired before it. A hop past the first is the Task's own move, never the user's recovery; so is a later Step's (#364).
    if (previous !== null && task.hop === 0 && (task.step ?? 1) === 1 && reacting.ownMove !== true) {
      const signal = misfireSignal(previous, { verb: command.verb, target: command.target, key: command.key, at: firedAt })
      if (signal !== null) log({ type: 'misfire', turnId: previous.turnId, at: firedAt, signal, signalTurnId: turnId, withinMs: firedAt - previous.at })
    }
    previous = { turnId, verb: command.verb, target: command.target, key: command.key, at: firedAt }
    // A Jev-read hop: what an overrun is read against, until the next one fires.
    jevHop = readingKind === 'jev' ? { turnId, hop: task.hop, at: firedAt } : null
    if (source === 'spoken' && reacting.ownMove !== true) learnFrom(command, matched, firedAt)

    // Whether a `stop` finds anything to stop: nothing in flight, being read or sounding pauses the music instead (#343, owner's ruling 2).
    const nothingInFlight = idleAt === submitted && idle()
    // A later Command supersedes the one in flight, and silences what it was saying; `stop` is only that.
    cancelInFlight(command.verb === 'stop' ? 'stopped' : 'superseded')
    silence()
    generation += 1
    const mine = generation
    inFlight = { turnId, generation: mine }
    const current = (): boolean => inFlight !== null && inFlight.generation === mine

    const paneHasPage = isRealPage(page.url) || isRealPage(browser.state().url)
    publish({ type: 'command', turnId, text, action: describeCommand(command, page), ...(commandKeepsIdle(command, paneHasPage) ? { keepsIdle: true } : {}), task, at: firedAt })
    if (!paneHasPage && verbNeedsPage(command.verb)) {
      // A blank pane has nothing to act on (#361): it is never shown, and an action on it, hidden under the Idle Screen, would never settle.
      inFlight = null
      answerFailure(turnId, SPOKEN_FAILURES.noPage)
      publish({ type: 'done', turnId, outcome: 'failed', at: at() })
      return { outcome: 'wall' }
    }
    if (command.verb === 'stop') {
      // `stop` is an abort said in words: a reading it went past was stopped, and the page's load ends with it.
      stoppedAt.add(submitted)
      stopLoading()
      // A ringing Timer is what "stop" most often means; a running one is left to run.
      const silenced = deps.timer?.silence() ?? false
      // With nothing else to stop, what plays is what "stop" means: every playing media element on the page pauses, by kind (#376).
      const paused = nothingInFlight && !silenced && deps.player !== undefined && (await pauseAll())
      inFlight = null
      // Pausing the music is an action done; a Stop is grey, and one that found nothing says so.
      if (paused) answer(turnId, STOPPED_ANSWERS.paused)
      else answer(turnId, nothingInFlight && !silenced ? STOPPED_ANSWERS.nothing : STOPPED_ANSWERS.stopped, 'muted')
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
    /** What the Player made of a `play` (#343): its Answer, and the video it opened. */
    let played: PlayerOutcome | null = null
    const ended = (outcome: FireOutcome): FireResult => ({
      outcome,
      ...(landing !== undefined ? { landing } : {}),
      ...(unchanged && landing === undefined ? { unchanged: true } : {}),
      ...(played?.video !== undefined ? { video: played.video } : {}),
      ...(played?.pick !== undefined ? { pick: played.pick } : {}),
    })
    try {
      const result = await perform(command, resume, current, (outcome) => (played = outcome))
      if (!current()) return ended('superseded')
      let outcome: FireOutcome = 'landed'
      unchanged = blockedOrInertAction(result) === 'inert'
      const card = cardOf(command, result)
      if (speech === undefined) react(card !== null && command.verb === 'read' ? 'display' : 'settled')
      publish({ type: 'tool_result', turnId, callId, name, ok: true, result, at: at() })
      if (card !== null) answer(turnId, card.text, card.failure ? 'failure' : undefined)
      if (speech !== undefined) {
        const shownAt = monotonic()
        publish({ type: 'status', turnId, status: 'speaking', at: at() })
        await speakPageRead(speech, turnId, result, current, () => {
          if (current()) react('spoken')
        })
        if (!current()) return ended('superseded')
        // Nothing was spoken (the voice failed, or was cut first): the Card was the effect.
        react('display', shownAt)
      } else if (played !== null) {
        // The Player's own Answer (#343): what it played, queued or did to the element — or, marked a failure, why it could not.
        const outcomeOfPlay: PlayerOutcome = played
        if (outcomeOfPlay.failure === true) {
          answerFailure(turnId, outcomeOfPlay.answer)
          outcome = 'wall'
        } else {
          answer(turnId, outcomeOfPlay.answer)
        }
      } else {
        const state = browser.state()
        const landedFailure = spokenFailureOf({ tool: name, outcome: { ok: true, result }, ...(state.url ? { url: state.url } : {}), ...(state.title ? { title: state.title } : {}) })
        const stayed = landedFailure === null && command.dismiss === true && (await dialogStillOpen())
        const covered = landedFailure === null && !stayed && reacting.tellsPopup === true && (await dialogOpenNow())
        const failure = landedFailure ?? (stayed ? 'dialogStayed' : covered ? 'popup' : null)
        const deadEnd = landedFailure !== null && DEAD_END_LANDINGS.has(landedFailure) ? (landedUrl(result) ?? state.url) : undefined
        if (deadEnd) deps.dropLastPage?.(deadEnd)
        if (!current()) return ended('superseded')
        if (stayed && reacting.deferStay === true) {
          // The next rung of the Dismissal Ladder is the runner's to fire (#354): nothing is said of this one.
          inFlight = null
          publish({ type: 'done', turnId, outcome: 'done', at: at() })
          return ended('stayed')
        }
        if (failure !== null) {
          answerFailure(turnId, SPOKEN_FAILURES[failure])
          outcome = 'wall'
        } else if (card === null) {
          // One Answer per Command (#333), from its verb's sentence.
          const label = targetLabel(command, page)
          const text = commandAnswer(command, {
            page: { url: state.url ?? '', title: state.title ?? '' },
            ...(label !== undefined ? { label } : {}),
            ...(result.endsWith(`\n${SCROLL_END_OF_PAGE}`) || blockedOrInertAction(result) === 'inert' ? { scrollEnded: true } : {}),
            // A Media Op's changes clause (#372): what follows its `<op> [N]: ` head.
            ...(command.verb === 'media' && command.mediaOp !== undefined ? { mediaChanges: result.slice(mediaOpHead(command.mediaOp.op, command.target ?? 0).length).split('\n', 1)[0] } : {}),
          })
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
      return { ...ended('wall'), error: message }
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
    /** The actions of hops that changed nothing (#336) or did not help (#373), by card label: not offered again. */
    readonly setAside: SetAside[]
    /** How many hops in a row have changed nothing or not helped (#336, #373): one counter. */
    stalled: number
    /** The sites it has searched (#341): one Site Scope search per site per Task. */
    readonly searched: string[]
    /** The words it has searched for or typed (owner's rule 2026-10-19): a page whose address carries them is their results. */
    readonly terms: string[]
    /** The last hop fired, whose "Done so far" line waits for the page it left to be read, so it can tell the facts; `told` is the page it was told against before, when a re-read tells it again. */
    pending?: { readonly command: Command; readonly page: CommandPage; readonly fired: FireResult; readonly told?: CommandPage; readonly stepAside?: true }
    /** The last action told in "Done so far", kept so a re-read (the page moved under the reading) tells it again against the page as it is then. */
    last?: { readonly command: Command; readonly page: CommandPage; readonly fired: FireResult; readonly stepAside?: true }
    /** Whether a reading was already read again because the page had moved under it: once per Task. */
    rechecked: boolean
    /** The Obstacles the Task stepped aside from (#354): each dialog closed once; the same one raised again is the wall. */
    readonly obstacles: string[]
    /** The last action, when it raised a pop-up over a clear page (#354): its target is set aside when the Task steps past that pop-up. */
    raised?: { readonly command: Command; readonly page: CommandPage }
    /** In a line read as Steps (#364): where this Step stands in it — every hop's reading is told the line and what the Steps before it did. */
    readonly step?: StepContext
    /** The Jev reading that fired the last action (#363): its action card answer (#370) and the page it was read on, where a dead end's runner-up comes from. */
    reading?: { readonly action: DecisionChoiceAnswer; readonly page: CommandPage }
    /** What the last action opened on the page it stayed on (#363): the controls it drew, closed at a dead end. */
    opened?: Opened
    /** Whether the Task has looked again (#363): closed what it opened and tried, or passed on, the runner-up — once per Task. */
    lookedAgain?: boolean
    /** Whether its end said a line of its own (#399): a Step that ends so stops its line without a second. */
    saidEnd?: boolean
  }

  /** A hop's place in its Task, and in its line when the line is Steps (#364). */
  function hopOf(task: Pick<Task, 'id' | 'step'>, hop: number): TaskHop {
    return { id: task.id, hop, ...(task.step !== undefined ? { step: task.step.step, of: task.step.of } : {}) }
  }

  /** What an action opened on the page it stayed on (#363): the action, the page it was read on, and the labels of the controls it drew. */
  interface Opened {
    readonly command: Command
    readonly page: CommandPage
    readonly appeared: readonly string[]
  }

  /**
   * What a click or a right-click opened, when it left the address as it was
   * and drew controls that were not there; undefined otherwise. Only those
   * open something: a scroll or a type that brings new refs into view has
   * opened nothing to close.
   */
  function openedBy(command: Command, before: CommandPage, after: CommandPage): Opened | undefined {
    if ((command.verb !== 'click' && command.verb !== 'menu') || after.url !== before.url) return undefined
    const appeared = freshRefs(before, after).map((ref) => ref.label)
    return appeared.length > 0 ? { command, page: before, appeared } : undefined
  }

  /** Whether the Verdict is sure: its confidence clears the Choice bar. */
  const sure = (verdict: Verdict | null): verdict is Verdict => verdict !== null && verdict.confidence >= DEFAULT_DECISION_THRESHOLDS.choice

  /** Whether the Command acts on the pop-up itself: a ref in the dialog's layer, or Escape. */
  function actsOnDialog(command: Command, page: CommandPage): boolean {
    if (page.dialog === undefined) return false
    if (command.verb === 'press' && command.key === PRESS_KEYS.escape) return true
    return command.target !== null && page.dialog.refs.includes(command.target)
  }

  /**
   * Step Aside (#354): the Dismissal Ladder for the pop-up a sure "in the
   * way" was read over — the consent policy's control, the one Jev chose,
   * one labelled as a close, Escape — when the Task has not stepped past
   * this Obstacle before; null otherwise, and the wall stands. Stepping
   * past it notes the Obstacle and sets aside the target that raised it,
   * so the next reading is not offered the same door.
   */
  function stepAside(task: Task, page: CommandPage, chosen: DismissChoice | null): Command[] | null {
    const obstacle = obstacleOf(page)
    const ladder = dismissalLadder(page, chosen, DEFAULT_DECISION_THRESHOLDS.choice)
    if (obstacle === null || ladder.length === 0 || task.obstacles.includes(obstacle)) return null
    task.obstacles.push(obstacle)
    const raised = task.raised
    if (raised !== undefined) {
      const aside = setAsideOf(raised.command, raised.page)
      if (aside !== null) task.setAside.push(aside)
    }
    return ladder
  }

  /**
   * Whether the page has moved since it was read: another address or
   * title, a pop-up opened or closed, or a different count of refs. Live
   * labels (a counter, an age) change on their own, so they are not compared.
   */
  async function pageMoved(read: CommandPage): Promise<boolean> {
    const now = await collectPage(null)
    return now.url !== read.url || now.title !== read.title || (now.dialog !== undefined) !== (read.dialog !== undefined) || now.refs.length !== read.refs.length
  }

  function visit(task: Task, url: string): void {
    if (url !== '' && url !== 'about:blank' && task.visited.at(-1) !== url) task.visited.push(url)
  }

  /** Whether a later submission (a Command, an Early Fire) or an abort has superseded the Task. */
  const superseded = (task: Task): boolean => task.submission !== submitted

  /** How a continuing hop's action came out, for the Task (#328): its end, or null when it goes on. */
  function endedByAction(task: Task, outcome: FireOutcome): TaskEnded | null {
    if (outcome === 'superseded' || superseded(task)) return 'superseded'
    if (outcome === 'wall' || outcome === 'stayed') return 'wall'
    if (task.stalled >= MAX_STALLED_HOPS) return 'unchanged'
    return task.actions.length >= MAX_TASK_ACTIONS ? 'cap' : null
  }

  /**
   * A hop's record before it fires (#328): written now when nothing it does
   * can change it — a Task that ends on a verb that leaves no page. A hop
   * whose verb lands is written by {@link settleHop}, with its landing.
   */
  function recordBeforeFiring(record: DecisionRecord, ending: TaskEnded | null, command: Command): void {
    if (ending !== null && !recordedAfterFiring(command.verb)) log({ ...record, ended: ending })
  }

  /**
   * A hop has fired (#328): its record is written with how its navigation
   * landed and, when the Task ends here, how. A Task goes on from a
   * Jev-read hop that landed, under the cap; resolves to its end, or null.
   * `stepAside`: a Step Aside's dismissal (#354), which the next hop's
   * Progress Noul does not judge (#373).
   */
  function settleHop(task: Task, record: DecisionRecord, ending: TaskEnded | null, command: Command, page: CommandPage, fired: FireResult, stepAside = false): TaskEnded | null {
    const landed = {
      ...(fired.landing !== undefined ? { landing: fired.landing } : {}),
      ...(fired.video !== undefined ? { video: fired.video } : {}),
      ...(fired.pick !== undefined ? { pick: fired.pick } : {}),
      ...(fired.error !== undefined ? { error: fired.error } : {}),
    }
    if (ending !== null) {
      if (recordedAfterFiring(command.verb)) log({ ...record, ...landed, ended: ending })
      return ending
    }
    // The line is provisional: the next hop, reading the page the action left, tells it in facts.
    task.actions.push(doneLine(command, page, doneResult(page, fired)))
    task.pending = { command, page, fired, ...(stepAside ? { stepAside: true as const } : {}) }
    if (command.site !== undefined) task.searched.push(command.site)
    if ((command.verb === 'search' || command.verb === 'type') && command.slot !== null && command.slot !== '') task.terms.push(command.slot)
    if (fired.unchanged === true) {
      // A hop that changed nothing (#336): its action is not offered again, and a second strike in a row ends the Task. One that changed something is struck or cleared by the next hop's Progress Noul (#373).
      task.stalled += 1
      const aside = setAsideOf(command, page)
      if (aside !== null) task.setAside.push(aside)
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

  /**
   * The line a Task's end says (#399): "Done." after more than one action,
   * and that it could not finish at the cap or when Jev did not answer past
   * hop 0; null for every other end, which is silent or has said its own.
   * A Step with Steps still to come is not done saying: its line goes on.
   * A Task a later Command came over while it closed (the cap's close) says
   * nothing: the later Command stands.
   */
  function endLineOf(task: Task, ended: TaskEnded, hops: number): { text: string; failure: boolean } | null {
    if (superseded(task)) return null
    if (ended === 'done') return task.actions.length > 1 && (task.step === undefined || task.step.step === task.step.of) ? { text: DONE_LINE, failure: false } : null
    if (ended === 'cap' || (ended === 'unavailable' && hops > 1)) return { text: SPOKEN_FAILURES.notFinished, failure: true }
    return null
  }

  /**
   * A Task's end (#328): the `task` span, from its Endpoint, on hop 0's
   * turn, and its end line spoken (#399) — on the turn last answered, whose
   * Card the Feed already shows, so the line adds no entry of its own.
   */
  function endTask(task: Task, ended: TaskEnded, hops: number): TaskEnded {
    try {
      tracer?.span(task.id, 'task', Math.max(0, monotonic() - task.endpointAt), { ended, hops, actions: task.actions.length, source: task.source })
    } catch (error) {
      reportFault('run.commandRunner.taskSpan', error, { turnId: task.id })
    }
    summarize(task.id)
    const line = endLineOf(task, ended, hops)
    if (line !== null && deps.speech !== undefined) {
      task.saidEnd = true
      void say(deps.speech, answeredTurn ?? task.id, line.text, { failure: line.failure })
    }
    return ended
  }

  /** A hop that fires nothing: its words greyed in the Feed with what it came to, and its turn closed. */
  function dropHop(turnId: string, task: Task, place: TaskHop, action: string, outcome: 'done' | 'cancelled', firedAt: number): void {
    publish({ type: 'command', turnId, text: task.text, action, dropped: true, task: place, at: firedAt })
    publish({ type: 'done', turnId, outcome, at: at() })
  }

  /**
   * A Web Engine's landing once it shows a result among its refs
   * ({@link RESULTS_WAIT_MS}): read again each poll until one does, the
   * wait runs out, or the Task is superseded. Any other page — a site's
   * own, a landing with a dialog over it — is taken as it stands.
   */
  async function withResults(task: Task, page: CommandPage): Promise<CommandPage> {
    let current = page
    for (let polls = Math.floor(RESULTS_WAIT_MS / RESULTS_POLL_MS); polls > 0; polls -= 1) {
      if (!isWebEngineSearch(current.url) || !isSearchLanding(current.url) || current.dialog !== undefined || resultRefsOf(current.refs, current.url).length > 0) break
      await sleep(RESULTS_POLL_MS)
      if (superseded(task)) break
      current = await collectPage(null)
    }
    return current
  }

  /**
   * A page once it has drawn ({@link MOUNTING_WAIT_MS}): read again each
   * poll while it is still mounting, until it is not, the wait runs out or
   * the Task is superseded. A page that has drawn is taken as it stands.
   */
  async function drawn(task: Task, page: CommandPage): Promise<CommandPage> {
    let current = page
    for (let polls = Math.floor(MOUNTING_WAIT_MS / RESULTS_POLL_MS); polls > 0 && isMounting(current); polls -= 1) {
      await sleep(RESULTS_POLL_MS)
      if (superseded(task)) break
      current = await collectPage(null)
    }
    return current
  }

  /** Whether a dialog is open over the page now, read in place where the browser can; a page that cannot be read is taken as clear. */
  async function dialogOpenNow(): Promise<boolean> {
    try {
      return browser.dialogOpen !== undefined ? await browser.dialogOpen() : (await browser.collectPage()).dialogOpen
    } catch (error) {
      reportFault('run.commandRunner.dialogOpenNow', error)
      return false
    }
  }

  /** A page's whole-page links (#328), where what is below the fold is (owner's rule 2026-10-19: on every page); none when they cannot be read. */
  async function wholePageLinks(turnId: string): Promise<readonly PageLink[]> {
    try {
      return (await browser.pageLinks()) ?? []
    } catch (error) {
      reportFault('run.commandRunner.pageLinks', error, { turnId })
      return []
    }
  }

  /** The Escape a dead end closes what it opened with (#363). */
  const ESCAPE: Command = { verb: 'press', target: null, slot: 'escape', key: PRESS_KEYS.escape, times: 1 }

  /** A dead end as its hop read it (#363): the reading and its record, the page, the words it looked for, and its turn. */
  interface DeadEnd {
    readonly read: Reading
    readonly record: DecisionRecord
    readonly page: CommandPage
    readonly words: string
    readonly turnId: string
    readonly firedAt: number
  }

  /**
   * Close what an action opened (#363): Escape, then — a click toggling
   * what it opened — the opener clicked again while it is still open; a
   * right-click's menu takes Escape alone, as a second right-click would
   * open it again. Each is the runner's own move, told in "Done so far" and
   * counted among the Task's actions, so closing spends the cap as any
   * action does. Resolves to the page it leaves and the last move's record,
   * not yet written — whoever ends the Task writes its end on it — or to
   * how the Task ended when a move was superseded or met a wall.
   */
  async function closeOpened(task: Task, hop: number, read: Reading, opened: Opened, page: CommandPage): Promise<{ page: CommandPage; last: DecisionRecord } | { ended: TaskEnded }> {
    let now = page
    const opener = opened.command.verb === 'click' ? opened.page.refs.find((ref) => ref.ref === opened.command.target) : undefined
    const steps: (() => Command | null)[] = [
      () => ESCAPE,
      ...(opener !== undefined ? [() => clickOn(refNamed(now, refIdentityOf(opener, opened.page)))] : []),
    ]
    let last: DecisionRecord | null = null
    for (const step of steps) {
      const command = step()
      if (command === null) break
      const stepTurnId = tracer?.mintTurnId() ?? `${task.id}-hop${hop}-undo`
      const stepAt = at()
      if (last !== null) log(last)
      last = { ...recordOf(stepTurnId, stepAt, task.source, task.text, read, command, null, false), task: hopOf(task, hop), undo: true }
      const fired = await fire(stepTurnId, task.text, task.source, command, now, 'jev', null, stepAt, { react: () => {}, settled: () => summarize(stepTurnId), ownMove: true }, hopOf(task, hop))
      const ended: TaskEnded | null = fired.outcome === 'superseded' || superseded(task) ? 'superseded' : fired.outcome === 'wall' ? 'wall' : null
      if (ended !== null) {
        log({ ...last, ended })
        return { ended }
      }
      const after = await collectPage(null)
      const stillOpen = after.refs.some((ref) => opened.appeared.includes(ref.label))
      task.actions.push(`${doneAction(command, now)} (${stillOpen ? 'it is still open' : 'what it opened closed'})`)
      now = after
      if (!stillOpen) break
    }
    return { page: now, last: last! }
  }

  /** A click on a ref the page still shows; null when it shows none. */
  const clickOn = (ref: { readonly ref: number } | null): Command | null => (ref === null ? null : { verb: 'click', target: ref.ref, slot: null })

  /** A Task that looked again and found nothing (#363): its last record carries the end, and the line names the words on a turn of its own. */
  function endNotFound(task: Task, hop: number, words: string, last: DecisionRecord, endTurnId: string, endAt: number): { ended: TaskEnded; hop: number } {
    log({ ...last, ended: 'not_found' })
    answerFailure(endTurnId, notHereLine(words))
    dropHop(endTurnId, task, hopOf(task, hop), "couldn't find it here", 'done', endAt)
    return { ended: 'not_found', hop }
  }

  /** Whether a dead end may try a runner-up (#363): the first time the Task looks again, the opener acted on a ref, and the cap leaves room. */
  function mayTryRunnerUp(task: Task, opened: Opened): boolean {
    const { verb, target } = opened.command
    return task.lookedAgain !== true && task.reading !== undefined && target !== null && (verb === 'click' || verb === 'menu') && task.actions.length < MAX_TASK_ACTIONS
  }

  /**
   * Look then act (#363, ADR 0079): a dead end at this hop. Past a hop that
   * opened something on the same page, that is closed ({@link closeOpened});
   * then, the first time, the runner-up of the reading that fired the
   * opener is fired as the next hop. Once the Task has looked again, a dead
   * end with nothing open ends `not_found` at once, the line naming the
   * words. Resolves to how it ended, or to the hop the runner-up fired as.
   */
  async function lookAgain(task: Task, hop: number, dead: DeadEnd): Promise<{ ended: TaskEnded | null; hop: number }> {
    const opened = task.opened
    task.opened = undefined
    if (opened === undefined) return endNotFound(task, hop, dead.words, dead.record, dead.turnId, dead.firedAt)
    log(dead.record)
    dropHop(dead.turnId, task, hopOf(task, hop), 'not here: closing what it opened', 'done', dead.firedAt)
    const closed = await closeOpened(task, hop, dead.read, opened, dead.page)
    if ('ended' in closed) return { ended: closed.ended, hop }
    const tryRunnerUp = mayTryRunnerUp(task, opened)
    const reading = task.reading
    task.lookedAgain = true
    task.reading = undefined
    const named = tryRunnerUp && reading !== undefined ? runnerUpOf(reading.action, reading.page, opened.command.target!, task.setAside, opened.command.verb === 'menu' ? 'menu' : 'click') : null
    const target = named === null ? null : refNamed(closed.page, named)
    if (target === null) return endNotFound(task, hop, dead.words, closed.last, tracer?.mintTurnId() ?? `${task.id}-hop${hop}-end`, at())
    log(closed.last)
    const upHop = hop + 1
    const upTurnId = tracer?.mintTurnId() ?? `${task.id}-hop${upHop}`
    const upAt = at()
    const runnerUp: Command = { verb: opened.command.verb, target: target.ref, slot: null }
    const upRecord: DecisionRecord = { ...recordOf(upTurnId, upAt, task.source, task.text, dead.read, runnerUp, null, false), task: hopOf(task, upHop), runnerUp: true }
    const fired = await fire(upTurnId, task.text, task.source, runnerUp, closed.page, 'jev', null, upAt, { react: () => {}, settled: () => summarize(upTurnId), ownMove: true }, hopOf(task, upHop))
    const ended = settleHop(task, upRecord, null, runnerUp, closed.page, fired)
    if (ended === 'cap') await closeAtCap(task, upHop, dead.read)
    return { ended, hop: upHop }
  }

  /**
   * A Task ending at the cap closes what its last action opened (#363): the
   * Task never ends with a menu of its own making left open over the page.
   * Its end is already on the last hop's record; the closing moves follow it.
   */
  async function closeAtCap(task: Task, hop: number, read: Reading): Promise<void> {
    const last = task.pending
    if (last === undefined || superseded(task)) return
    const now = await collectPage(null)
    const opened = openedBy(last.command, last.page, now)
    if (opened === undefined) return
    const closed = await closeOpened(task, hop, read, opened, now)
    if (!('ended' in closed)) log(closed.last)
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
      // A re-read (the page moved under the reading) comes back here too, so it waits for the page to draw as the hop did.
      const page = superseded(task) ? blankPage(browser) : await drawn(task, await withResults(task, await collectPage(null)))
      visit(task, page.url)
      if (task.pending !== undefined) {
        // The last action's "Done so far" line, in the facts of the page it left: what it did to its target, what appeared, and whether a pop-up covers it.
        const { command: last, page: before, fired, told, stepAside } = task.pending
        const found = doneFacts(before, page, doneResult(before, fired), last.target)
        // Told again after a re-read (post mortem 2026-10-19): the pop-up the line named over a clear page is gone — closed by the collect's consent dismissal or by the page — and the line says so, or Jev reads a wall over a page with nothing in the way.
        const retold = told?.dialog !== undefined && before.dialog === undefined && page.dialog === undefined && found.changed
        const facts: DoneResult = retold ? { ...found, covered: true, closed: true } : found
        task.actions[task.actions.length - 1] = doneLine(last, before, facts)
        task.pending = undefined
        task.last = { command: last, page: before, fired, ...(stepAside === true ? { stepAside } : {}) }
        // The action that raised a pop-up over a clear page (#354): set aside if the Task steps past it.
        task.raised = facts.changed && facts.covered === true ? { command: last, page: before } : undefined
        task.opened = facts.changed ? openedBy(last, before, page) : undefined
      }
      const links = !superseded(task) ? await wholePageLinks(turnId) : []
      const context: HopContext = { hop, visited: [...task.visited], actions: [...task.actions], links, setAside: [...task.setAside], searched: [...task.searched], terms: [...task.terms] }
      const model = deps.decisionModel()
      const heard = hearingOf(task.text, page, spoken)
      const questions = hopQuestions(task.text, page, context, { appliance: appliance(), heard })
      const result = superseded(task) || model === null ? null : await askJev(model, 'hop', turnId, commandState(task.text, page, context, task.step, undefined, questions, heard), questions)
      if (reading?.turnId === turnId) reading = null
      const firedAt = at()
      const base = { type: 'decision' as const, turnId, at: firedAt, source: task.source, transcript: task.text, reading: 'jev' as const, task: hopOf(task, hop) }
      const none = { verb: 'none' as const, target: null, slot: null }

      if (result === null || result.status !== 'answered') {
        const jev = result === null ? {} : { jev: { model: result.model, latencyMs: result.latencyMs, reason: result.reason }, ask: result.askId }
        const ended: TaskEnded = superseded(task) ? 'superseded' : 'unavailable'
        log({ ...base, ...none, jevAsked: result !== null, ...jev, ended })
        dropHop(turnId, task, hopOf(task, hop), ended === 'superseded' ? abandonedAction(task.submission) : 'not read', ended === 'superseded' ? 'cancelled' : 'done', firedAt)
        return endTask(task, ended, hop + 1)
      }

      // Progress (#373, ADR 0080): the Noul judges the last action; a sure
      // yes keeps the end whatever it says, and an action that changed
      // nothing was struck when it settled, so it is judged once. Sure it
      // did not help, the action is set aside by its card label from this
      // very reading on: the card asked on this call is read without it.
      const progress = readProgress(result.answers)
      const verdict = readVerdict(result.answers)
      const sureYes = sure(verdict) && verdict.outcome === 'yes'
      // A Step Aside's dismissal is the runner's own move over a pop-up, never the card's: it is not judged.
      const judged = task.last !== undefined && task.last.fired.unchanged !== true && task.last.stepAside !== true && !sureYes ? task.last : null
      const stalled = judged !== null && progress !== null && progress <= PROGRESS_FLOOR
      const aside = stalled ? setAsideOf(judged.command, judged.page) : null
      const placed: TaskHop = { ...hopOf(task, hop), ...(progress !== null ? { progress } : {}) }
      const read: Reading = {
        command: readCommandAnswers(result.answers, task.text, page, aside !== null ? { ...context, setAside: [...task.setAside, aside] } : context),
        page,
        reading: 'jev',
        jevAsked: true,
        jev: jevDetailOf(result.answers, result.latencyMs, result.model),
        ask: result.askId,
      }
      const { command, matched } = matchName(read.command, page, spoken)
      const record = { ...recordOf(turnId, firedAt, task.source, task.text, read, command, matched, false), task: placed }
      if (superseded(task)) {
        // A later Command, Escape or the Abort Head came while this hop was read: the reading is data, nothing fires.
        log({ ...record, ended: 'superseded' })
        dropHop(turnId, task, placed, abandonedAction(task.submission), 'cancelled', firedAt)
        return endTask(task, 'superseded', hop + 1)
      }
      // The Verdict decides the end (ADR 0076): a sure "in the way" is a
      // wall unless the action is on the pop-up itself, or is the Player's,
      // which never touches the page (#374); a sure yes ends the Task
      // done whatever the verb, before it fires (#369); and a reading with
      // no next step and no sure yes ends unsure, said so.
      // Either end is read against the page as it is now: a page that moved
      // under the reading is read again, once.
      const inTheWay = sure(verdict) && verdict.outcome === 'in_the_way' && !actsOnDialog(command, page) && command.verb !== 'play'
      // A second strike in a row (#336, #373) leaves the reading no next step: it ends unsure as `none` does, through Look then act.
      const struckOut = stalled && !inTheWay && task.stalled + 1 >= MAX_STALLED_HOPS
      const ends = sureYes || command.verb === 'none' || struckOut
      if ((inTheWay || ends) && !task.rechecked && (await pageMoved(page))) {
        if (superseded(task)) {
          log({ ...record, ended: 'superseded' })
          dropHop(turnId, task, placed, abandonedAction(task.submission), 'cancelled', firedAt)
          return endTask(task, 'superseded', hop + 1)
        }
        task.rechecked = true
        // The last action's line is told again against the page the re-read collects.
        if (task.last !== undefined) task.pending = { ...task.last, told: page }
        log(record)
        dropHop(turnId, task, placed, 'the page moved: read again', 'done', firedAt)
        continue
      }
      // The strike lands once the reading stands (a re-read judges again).
      // Over a pop-up in the way the Step Aside moves next, not the card,
      // so it neither strikes nor clears; a judged action that helped, or
      // whose help was unsure, clears the run.
      if (judged !== null && !inTheWay) {
        if (!stalled) task.stalled = 0
        else {
          task.stalled += 1
          if (aside !== null) task.setAside.push(aside)
        }
      }
      if (inTheWay) {
        const ladder = stepAside(task, page, readDismissChoice(result.answers, page))
        if (ladder !== null) {
          // Step Aside (#354): the runner closes the pop-up as this hop, rung by rung down the Dismissal Ladder until it closes, and the Task goes on from the page it leaves.
          let ended: TaskEnded | null = null
          for (let rung = 0; rung < ladder.length; rung += 1) {
            const aside = ladder[rung]!
            const rungTurnId = rung === 0 ? turnId : (tracer?.mintTurnId() ?? `${task.id}-hop${hop}`)
            const rungAt = rung === 0 ? firedAt : at()
            const stepped: DecisionRecord = { ...recordOf(rungTurnId, rungAt, task.source, task.text, read, aside, null, false), task: hopOf(task, hop), stepAside: true }
            // Another rung follows while the cap leaves room for it: a dialog still open after this one is not yet the failure.
            const more = rung + 1 < ladder.length && task.actions.length + 1 < MAX_TASK_ACTIONS
            const reacting: Reacting = { react: () => {}, settled: () => summarize(rungTurnId), ...(more ? { deferStay: true as const } : {}) }
            const fired = await fire(rungTurnId, task.text, task.source, aside, page, 'jev', null, rungAt, reacting, hopOf(task, hop))
            if (fired.outcome === 'stayed') {
              // The pop-up stayed: this rung is an action taken, said so in "Done so far", and the next fires.
              task.actions.push(doneLine(aside, page, { changed: false }))
              log(stepped)
              hop += 1
              continue
            }
            // The pop-up closed is the runner's move: the next hop does not judge it, and one that changed the page clears the run.
            ended = settleHop(task, stepped, null, aside, page, fired, true)
            if (fired.unchanged !== true) task.stalled = 0
            break
          }
          if (ended !== null) return endTask(task, ended, hop + 1)
          continue
        }
        log({ ...record, ended: 'wall' })
        answerFailure(turnId, SPOKEN_FAILURES[page.dialog !== undefined ? 'popup' : 'blocked'])
        dropHop(turnId, task, placed, 'in the way', 'done', firedAt)
        return endTask(task, 'wall', hop + 1)
      }
      if (ends) {
        const ended: TaskEnded = sureYes ? 'done' : 'unsure'
        if (ended === 'unsure' && (task.opened !== undefined || task.lookedAgain === true)) {
          // Look then act (#363): a dead end closes what the last hop opened and tries the reading before's runner-up, once.
          // It starts the run afresh (#373), or a struck-out Task would end on the runner-up's settle with what it opened left open.
          task.stalled = 0
          const looked = await lookAgain(task, hop, { read, record, page, words: slotWords(result.answers.slot, task.text), turnId, firedAt })
          if (looked.ended !== null) return endTask(task, looked.ended, looked.hop + 1)
          hop = looked.hop
          continue
        }
        log({ ...record, ended })
        if (ended === 'unsure') answerFailure(turnId, SPOKEN_FAILURES.unsure)
        dropHop(turnId, task, placed, ended === 'done' ? 'done' : 'not sure this is it', 'done', firedAt)
        return endTask(task, ended, hop + 1)
      }
      const ending = endedByReading('jev', command.verb)
      recordBeforeFiring(record, ending, command)
      task.reading = { action: result.answers.action, page }
      const fired = await fire(turnId, task.text, task.source, command, page, 'jev', matched, firedAt, { react: () => {}, settled: () => summarize(turnId) }, placed)
      const ended = settleHop(task, record, ending, command, page, fired)
      if (ended === 'cap') await closeAtCap(task, hop, read)
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
  /** Their asks' ids (#338), so a partial that fired nothing is still reached from the record its Endpoint writes. */
  let partialAskIds: string[] = []

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
    /** Jev's action card answer, when Jev read the partial (#363, #370): the runner-up a dead end may try. */
    readonly action?: DecisionChoiceAnswer
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
  function closeEarly(fired: EarlyFired, endpoint: { transcript: string; at: number; truncated: boolean } | null, ended: TaskEnded | 'deferred' = endedByReading(fired.record.reading, fired.record.verb) ?? 'superseded'): DecisionRecord {
    early = null
    if (endpoint !== null) fired.endpointAt = endpoint.at
    const record: DecisionRecord = {
      ...fired.record,
      ...(endpoint !== null ? { transcript: endpoint.transcript } : {}),
      ...(endpoint?.truncated ? { truncated: true } : {}),
      earlyFire: { partial: fired.partial, ...(endpoint !== null ? { leadMs: leadOf(fired) } : {}), ...(fired.noul !== undefined ? { noul: fired.noul } : {}) },
      ...(partialCalls > 0 ? { partialCalls } : {}),
      ...(partialAskIds.length > 0 ? { partialAsks: [...partialAskIds] } : {}),
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
    partialAskIds = []
  }

  /** A partial's reading, when it settles a Command that may fire before the Endpoint. */
  async function readPartial(words: string, stale: () => boolean): Promise<(Reading & { noul?: number }) | null> {
    const quick = localMatch(words, [])
    // "scroll" may yet be "scroll up": the words are known to be unfinished, so no one is asked.
    // A "stop" that may be "stop looping" (#343) still fires at once when there is something to stop: it is only an abort then.
    const stopsSomething = quick?.verb === 'stop' && !idle()
    if (headsAnotherVerb(words) && !stopsSomething) return null
    // An exact Player line (#343) is the grammar's: it waits for its Endpoint, and Jev is never asked about it.
    if (quick?.verb === 'play') return null
    const dismissed = await dismissPage(words, quick, prepared)
    if (stale()) return null
    // A dismiss phrase over a pop-up waits for its Endpoint, where the Dismissal Ladder is read with Jev's choice on it and walked rung by rung.
    if (dismissed?.dialog !== undefined) return null
    if (pageFree(quick) && firesEarly(quick)) return { command: quick, page: blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = dismissed ?? (await collectPage(prepared))
    if (stale()) return null
    const local = localMatch(words, page.refs, page.url)
    if (local !== null && firesEarly(local)) return { command: local, page, reading: 'local_match', jevAsked: false }
    const model = deps.decisionModel()
    if (model === null) return null
    partialCalls += 1
    const askedIn = utterance
    const heard = hearingOf(words, page, true)
    const questions = partialQuestions(words, page, { appliance: appliance(), heard })
    const result = await askJev(model, 'partial', null, commandState(words, page, undefined, undefined, undefined, questions, heard), questions)
    // Kept for its own Utterance's record: one whose Endpoint came while it was read has written its record already.
    if (askedIn === utterance) partialAskIds.push(result.askId)
    // Jev unavailable on a partial: nothing fires, and the Endpoint reads as before.
    if (stale() || result.status !== 'answered') return null
    const noul = result.answers.complete.noul
    if (noul < DEFAULT_DECISION_THRESHOLDS.noul) return null
    const command = readCommandAnswers(result.answers, words, page)
    if (command.verb === 'none') return null
    // A song to play waits for its Endpoint, as an exact `play` does: "play daft" may yet be "play daft punk" (ADR 0079).
    if (command.music?.kind === 'search') return null
    return { command, page, reading: 'jev', jevAsked: true, jev: jevDetailOf(result.answers, result.latencyMs, result.model), ask: result.askId, action: result.answers.action, noul }
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
      ...(found.action !== undefined ? { action: found.action } : {}),
      outcome: Promise.resolve({ outcome: 'landed' }),
      endpointAt: null,
      effect: null,
      settled: false,
    }
    early = fired
    fired.outcome = fire(turnId, words, 'spoken', command, found.page, found.reading, matched, firedAt, reactingEarly(fired), hop0)
    return { action: fired.outcome.then(() => {}) }
  }

  /** A line given at an Endpoint, or typed (#364): what every Step of it shares. */
  interface Line {
    readonly text: string
    readonly source: CommandSource
    readonly endpointAt: number
    readonly truncated: boolean
    readonly submission: number
    /** When it was given (#330). */
    readonly givenAt: number
  }

  /** How a Step's Task came out (#364): how it ended, how its hop 0's action came out when one fired, and what it did, for the next Step's "Done so far". */
  interface StepEnd {
    readonly ended: TaskEnded
    readonly outcome?: FireOutcome
    readonly did: string
    /** Whether its end said a line of its own (#399). */
    readonly said?: true
  }

  /**
   * One Task from its hop 0 (#328): the words read, fired, and gone on
   * from until it ends. A line is one, or, read as Steps, one per Step
   * (#364): each Step's hop 0 carries the record's extra fields only when
   * it is the first, and only the first measures the line's Reaction;
   * every Step's Task carries the line's id (`taskId`).
   */
  async function runStep(line: Line, turnId: string, words: string, first: Reading, extra: Partial<DecisionRecord>, options: { measured: boolean; step?: StepContext; taskId?: string }): Promise<StepEnd> {
    const { source, endpointAt, truncated, submission, givenAt } = line
    const task: Task = { id: options.taskId ?? turnId, submission, text: words, source, endpointAt, visited: [], actions: [], setAside: [], stalled: 0, searched: [], terms: [], rechecked: false, obstacles: [], ...(options.step !== undefined ? { step: options.step } : {}) }
    const hop0 = hopOf(task, 0)
    let heard = first
    // The Where Ask's reading, when one was made: a line that ends on none says it, whether a Mark Ask followed or not.
    let whereRead: Reading | null = null
    // The line's extra fields go on hop 0's first record: the first reading's, when another reading followed it.
    let extraLogged = false
    if (asksWhere(first) && submission === submitted) {
      // A none at hop 0 asks where (#379, ADR 0082): its record stays, and the Where Ask's reading is hop 0's, with a record of its own.
      log({ ...recordOf(turnId, at(), source, words, first, first.command, null, truncated), ...extra, task: hop0 })
      extraLogged = true
      reading = { turnId, submission }
      heard = await readWhere(turnId, words, first, options.step, hearingOf(words, first.page, source === 'spoken'))
      whereRead = heard
      if (asksMarks(whereRead) && submission === submitted) {
        // The Where Ask read none too (#382, ADR 0084): a card with a Textless Ref is asked once more with the marked page, and its record stays.
        const marked = await readMarks(turnId, words, first, whereRead, options.step, hearingOf(words, whereRead.page, source === 'spoken'))
        if (marked !== null) {
          log({ ...recordOf(turnId, at(), source, words, whereRead, whereRead.command, null, truncated), task: hop0 })
          heard = marked
        }
      }
      if (reading?.turnId === turnId) reading = null
    } else if (submission === submitted && guessesTextless(first, words)) {
      // An unsure click on a Textless Ref (owner ruling 2026-10-22, ADR 0084 amended): the Mark Ask is asked before the guess fires.
      // Its answer is hop 0's reading, the guess keeping its record; no answer, or no capture, leaves the guess to fire as read.
      reading = { turnId, submission }
      const marked = await readMarks(turnId, words, first, first, options.step, hearingOf(words, first.page, source === 'spoken'))
      if (reading?.turnId === turnId) reading = null
      if (marked?.reading === 'jev') {
        log({ ...recordOf(turnId, at(), source, words, first, first.command, null, truncated), ...extra, task: hop0 })
        extraLogged = true
        heard = marked
      } else if (marked !== null) {
        log({ ...recordOf(turnId, at(), source, words, marked, marked.command, null, truncated), task: hop0 })
      }
    }
    const firedAt = at()
    if (heard.action !== undefined) task.reading = { action: heard.action, page: heard.page }
    visit(task, heard.page.url || (browser.state().url ?? ''))
    const { command, matched } = matchName(heard.command, heard.page, source === 'spoken')
    const record: DecisionRecord = { ...recordOf(turnId, firedAt, source, words, heard, command, matched, truncated), ...(extraLogged ? {} : extra), task: hop0 }
    const did = (): string => task.actions.join('; ') || describeCommand(command, heard.page)

    if (submission !== submitted) {
      // A later Command (or an abort) arrived while this one was being
      // read: the later one stands. The reading is data; nothing fires.
      log({ ...record, ended: 'superseded' })
      publish({ type: 'command', turnId, text: line.text, action: abandonedAction(submission), dropped: true, task: hop0, at: givenAt })
      publish({ type: 'done', turnId, outcome: 'cancelled', at: at() })
      return { ended: endTask(task, 'superseded', 1), did: '' }
    }

    // A reading that ends the Task before it fires is recorded so now; a hop that goes on, once its action has landed.
    // An address with words past it goes on to hop 1 (#341); an Early Fire never fires an open on the Local Match, so only this path sees one.
    const wordsPast = command.verb === 'navigate' && carriesWordsPastAddress(words)
    const ending = endedByReading(heard.reading, command.verb, wordsPast)
    recordBeforeFiring(record, ending, command)
    if (command.verb === 'none') {
      // An Utterance read as no Command — never as the page already being what was asked (#370), whatever a Where Ask's Verdict says (#394):
      // a greyed entry of the words, and "No response." with the reason under it — never a silent fade (owner ruling 2026-10-19).
      publish({ type: 'command', turnId, text: line.text, dropped: true, task: hop0, at: firedAt })
      // After a Where Ask, both readings are the reason; a Mark Ask's none adds nothing to them.
      const where = whereRead !== null ? { where: whereRead.jev } : heard.markAsk === true ? { marked: heard.jev } : {}
      answer(turnId, noResponseAnswer({ grammarError: grammarErrorOf(words), jevAsked: first.jevAsked, jev: first.jev, ...where }), 'muted')
      publish({ type: 'done', turnId, outcome: 'done', at: at() })
      return { ended: endTask(task, ending!, 1), did: '' }
    }
    if (heard.whereAsk === true && sure(heard.verdict ?? null) && heard.verdict!.outcome === 'yes') {
      // The Where Ask would act, and the Verdict beside it is sure the page already shows what the words ask for (#394):
      // the Task ends done on the page as it is, as a later hop's sure yes does, and the action is never fired.
      log({ ...record, ended: 'done' })
      dropHop(turnId, task, hop0, 'done', 'done', firedAt)
      return { ended: endTask(task, 'done', 1), did: '' }
    }

    const ladder = heard.ladder ?? []
    let result = await fire(
      turnId,
      line.text,
      source,
      command,
      heard.page,
      heard.reading,
      matched,
      firedAt,
      {
        react: (detail, endedAt) => {
          if (options.measured) span(turnId, endedAt - endpointAt, detail)
        },
        settled: () => summarize(turnId),
        ...(ladder.length > 0 ? { deferStay: true as const } : {}),
        ...(command.verb === 'navigate' && ending !== null ? { tellsPopup: true as const } : {}),
      },
      hop0,
    )
    // A dismiss phrase's Dismissal Ladder (owner's rule 2026-10-19): while the pop-up stays, the next rung fires, each its own turn; the last says the failure.
    for (let rung = 0; rung < ladder.length && result.outcome === 'stayed'; rung += 1) {
      const next = ladder[rung]!
      const rungTurnId = tracer?.mintTurnId() ?? `${turnId}-rung${rung + 1}`
      const rungAt = at()
      log({ ...recordOf(rungTurnId, rungAt, source, words, heard, next, null, truncated), task: hop0, ended: 'local_match' })
      result = await fire(rungTurnId, line.text, source, next, heard.page, heard.reading, null, rungAt, {
        react: () => {},
        settled: () => summarize(rungTurnId),
        ownMove: true,
        ...(rung + 1 < ladder.length ? { deferStay: true as const } : {}),
      }, hop0)
    }
    const ended = settleHop(task, record, ending, command, heard.page, result)
    const outcome = result.outcome
    const end = ended !== null ? endTask(task, ended, 1) : await continueTask(task, 1)
    return { ended: end, outcome, did: did(), ...(task.saidEnd === true ? { said: true as const } : {}) }
  }

  /** Whether a Step's Task ended done (#364): a sure yes, the page already what was asked, or a one-Command Task whose action landed. */
  function stepDone(end: StepEnd): boolean {
    if (end.ended === 'done') return true
    return (end.ended === 'local_match' || end.ended === 'terminal') && end.outcome === 'landed'
  }

  /** The endings a Task comes to without saying a failure of its own: a Step that ends so stops its line in words (#364). */
  const ENDS_UNSAID: ReadonlySet<TaskEnded> = new Set(['unchanged', 'cap', 'unavailable'])

  /**
   * A Step that did not end done stops its line (#364): the next Step is a
   * greyed line of the line's Entry, and a Step that ended with nothing
   * said — it changed nothing twice, hit the cap, or Jev did not answer —
   * says the line is not done; one that met a wall, ended unsure or said
   * its Task's end line (#399) already said so. A superseded line says
   * nothing: the later Command stands.
   */
  function stopSteps(line: Line, lineId: string, end: StepEnd, next: number, of: number): void {
    if (end.ended === 'superseded' || line.submission !== submitted) return
    const turnId = tracer?.mintTurnId() ?? `${lineId}-step${next}`
    publish({ type: 'command', turnId, text: line.text, action: `Step ${next} not run`, dropped: true, task: { id: lineId, hop: 0, step: next, of }, at: at() })
    if (ENDS_UNSAID.has(end.ended) && end.said !== true) answerFailure(turnId, SPOKEN_FAILURES.unsure)
    publish({ type: 'done', turnId, outcome: 'done', at: at() })
  }

  /**
   * A line Jev read as Steps (#364, ADR 0076 "a line is Steps"): each
   * Step's words are read as a fresh hop 0 — the grammar first, then Jev,
   * never split again — and run as its own Task, in order, on the page the
   * last one left, told the line and what the Steps before it did. A later
   * Step runs only once the one before ended done: a Step that ends
   * otherwise stops the line, having said its own failure, and a later
   * Command or an abort supersedes every Step still to come. The first
   * Step's record names the ask that split the line.
   */
  async function runSteps(line: Line, turnId: string, whole: Reading, words: readonly string[], pending: PreparedPage | null, extra: Partial<DecisionRecord>): Promise<void> {
    const done: string[] = []
    for (let index = 0; index < words.length; index += 1) {
      if (line.submission !== submitted) return
      const first = index === 0
      const step: StepContext = { line: line.text, step: index + 1, of: words.length, done: [...done] }
      const stepTurnId = first ? turnId : (tracer?.mintTurnId() ?? `${turnId}-step${index + 1}`)
      reading = { turnId: stepTurnId, submission: line.submission }
      // The first Step's turn already holds the split's ask: its own reading's ask is named apart.
      const heard = await read(stepTurnId, words[index]!, first ? pending : null, line.source === 'spoken', { split: false, step, ...(first ? { askId: `${turnId}-step1` } : {}) })
      if (reading?.turnId === stepTurnId) reading = null
      const split = first && whole.ask !== undefined && whole.jev !== undefined && 'confidence' in whole.jev ? { split: { ask: whole.ask, jev: whole.jev, steps: words, line: line.text } } : {}
      const end = await runStep(line, stepTurnId, words[index]!, heard, first ? { ...extra, ...split } : {}, { measured: first, step, taskId: turnId })
      if (!stepDone(end)) {
        stopSteps(line, turnId, end, index + 2, words.length)
        return
      }
      done.push(`Step ${index + 1} ${JSON.stringify(words[index])}: ${end.did}`)
    }
  }

  return {
    getState: () => (idle() ? 'idle' : 'running'),

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
        const ending = endedByReading(fired.record.reading, fired.record.verb)
        // A hop 0 whose verb lands is recorded once it has, with its landing.
        const lands = ending === null || CONTINUING.has(fired.command.verb)
        const record = closeEarly(fired, { transcript: trimmed, at: endpointAt, truncated }, lands ? 'deferred' : ending)
        nextUtterance()
        if (options?.turnId !== undefined) summarize(options.turnId)
        const task: Task = { id: fired.turnId, submission: fired.submission, text: trimmed, source, endpointAt, visited: [], actions: [], setAside: [], stalled: 0, searched: [], terms: [], rechecked: false, obstacles: [] }
        visit(task, fired.page.url)
        if (fired.action !== undefined) task.reading = { action: fired.action, page: fired.page }
        const ended = lands ? settleHop(task, record, ending, fired.command, fired.page, await fired.outcome) : ending
        if (ended !== null) endTask(task, ended, 1)
        else await continueTask(task, 1)
        return true
      }
      // A spoken Endpoint of another Utterance: the Early Fire never reached its own. A typed line leaves it waiting for its Endpoint.
      if (fired !== null && source === 'spoken') closeEarly(fired, null)
      const calls = source === 'spoken' ? partialCalls : 0
      const callAsks = source === 'spoken' ? partialAskIds : []
      // An Endpoint (or a typed line) ends the Utterance: a partial still being read fires nothing.
      if (source === 'spoken') nextUtterance()

      const turnId = options?.turnId ?? tracer?.mintTurnId() ?? `turn-${at().toString(36)}`
      // When it was given (#330): an abandoned reading is filed here, however late its reading ends.
      const givenAt = at()
      // A new Utterance soon after a Jev-read hop fired: the Task overran (#328).
      overrun(turnId)
      // This submission: a reading still under way for an earlier one is stale now.
      const wasIdle = idle()
      submitted += 1
      const submission = submitted
      if (wasIdle) idleAt = submission
      reading = { turnId, submission }
      // The prepared page is this Command's, whether it needs it or not.
      const pending = prepared
      prepared = null

      const perform = async (): Promise<void> => {
        const heard = await read(turnId, trimmed, pending, source === 'spoken')
        if (reading !== null && reading.submission === submission) reading = null
        if (source === 'spoken') observeTerms(trimmed)
        const line: Line = { text: trimmed, source, endpointAt, truncated, submission, givenAt }
        const extra = { ...(calls > 0 ? { partialCalls: calls } : {}), ...(callAsks.length > 0 ? { partialAsks: callAsks } : {}) }
        if (heard.steps !== undefined && submission === submitted) await runSteps(line, turnId, heard, heard.steps, pending, extra)
        else await runStep(line, turnId, trimmed, heard, extra, { measured: true })
      }
      await (deps.subspans?.runInTurn(turnId, perform) ?? perform())
      return true
    },
  }
}
