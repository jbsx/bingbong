import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import { DEFAULT_DECISION_THRESHOLDS, type DecisionModel } from '../../core/ports/decisionModel'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandRunState } from '../../core/pipeline/runState'
import type { PageSnapshot } from '../../core/browser/snapshot'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { commandRefOf, describeCommand, type Command, type CommandPage } from '../../core/command/command'
import { COMMAND_HELP } from '../../core/command/help'
import { bestGuess, headsAnotherVerb, localMatch } from '../../core/command/localMatch'
import { commandQuestions, commandState, partialQuestions, readCommandAnswers } from '../../core/command/jevReading'
import { isAddressShaped, openAddress } from '../../core/command/openAddress'
import { nameMatch, soundsAlike } from '../../core/command/nameMatch'
import { jevDetailOf, misfireSignal, type CommandLogRecord, type CommandReading, type CommandSource, type DecisionRecord, type NameSource } from '../../core/command/decisionRecord'
import { pageTermsOf } from '../../core/voice/pageTerms'
import { pageReadPart, pageReadText } from '../../core/browser/pageText'
import { SPOKEN_FAILURES, spokenFailureOf, type SpokenFailure } from '../../core/command/spokenFailure'
import type { SpeakOutcome, TtsSpeaker } from '../../core/ports/tts'
import { reportFault } from '../../core/trace/fault'
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
// Action Outcome class, speaks one fixed line (spokenFailure.ts). Every
// other action stays silent.

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
  screenshotDir(): string
  saveScreenshot(path: string, bytes: Uint8Array): Promise<void>
  /** The Learned Terms (ADR 0077); absent reads names off the page alone and learns nothing. */
  terms?: CommandTerms
  /** The voice (#327): a Page Read and a failure's line are spoken through it; absent keeps every Command silent. */
  speech?: Pick<TtsSpeaker, 'speak' | 'stop'>
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

function pageOf(snapshot: PageSnapshot): CommandPage {
  return {
    url: snapshot.url,
    title: snapshot.title,
    refs: snapshot.refs.map(commandRefOf),
    terms: pageTermsOf({ title: snapshot.title, labels: snapshot.refs.map((ref) => ref.label), text: snapshot.viewportText }),
  }
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
  /** The Command being read, if one is — so abort reaches it and the state says running. */
  let reading: { turnId: string; submission: number } | null = null
  let screenshotCount = 0
  /** The page collected at speech start, waiting for the Endpoint's Command. */
  let prepared: PreparedPage | null = null
  /** The Command that last fired, for the Misfire signal. */
  let previous: { turnId: string; verb: Command['verb']; key?: Command['key']; at: number } | null = null
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
    return snapshot === null ? blankPage(browser) : pageOf(snapshot)
  }

  /** End the Command in flight: its turn ends cancelled now, and whatever its action answers later reaches nothing. */
  function cancelInFlight(): boolean {
    if (inFlight === null) return false
    const { turnId } = inFlight
    inFlight = null
    publish({ type: 'status', turnId, status: 'cancelled', at: at() })
    publish({ type: 'done', turnId, outcome: 'cancelled', at: at() })
    return true
  }

  /** Speak a Command's text (#327): one `speak` event carries it, and it counts as the runner's until it ends. */
  function say(speech: Pick<TtsSpeaker, 'speak'>, turnId: string, text: string, onFirstSound?: () => void): Promise<SpeakOutcome> {
    publish({ type: 'speak', turnId, text, at: at() })
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
        const outcome = await say(speech, turnId, words || SPOKEN_FAILURES.empty, first ? onFirstSound : undefined)
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

  /** A failure's one line, not waited on: the turn ends now, and the next Command silences it. */
  function sayFailure(turnId: string, failure: SpokenFailure | null): void {
    if (deps.speech === undefined || failure === null) return
    void say(deps.speech, turnId, SPOKEN_FAILURES[failure])
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

  /** The Local Match first; else one Jev call; else the best guess. A spoken Slot that could carry a name waits for the page, so the Name Match can read it against the Page Terms. */
  async function read(text: string, pending: PreparedPage | null, spoken: boolean): Promise<Reading> {
    const quick = localMatch(text, [])
    if (pageFree(quick) && !(spoken && slotIsNameable(quick))) return { command: quick, page: blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = await collectPage(pending)
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

  /** The chosen ref lights as the action lands — after it, never before: the flash is a DOM change of our own making, and must not be the effect the Reaction closes on. */
  function flash(ref: number): void {
    void browser.showRef(ref).catch((error: unknown) => reportFault('run.commandRunner.showRef', error))
  }

  async function perform(command: Command): Promise<string> {
    switch (command.verb) {
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
        return ''
    }
  }

  /** What the Feed shows of a result: a Page Read, a screenshot's path, the help — never an action's outcome line. */
  function cardOf(command: Command, result: string): string | null {
    if (command.verb !== 'read' && command.verb !== 'screenshot' && command.verb !== 'help') return null
    const shown = result.length > DISPLAY_LIMIT ? `${result.slice(0, DISPLAY_LIMIT)}\n…` : result
    return shown === '' ? 'done' : shown
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
    const targetLabel = command.target === null ? undefined : read.page.refs.find((ref) => ref.ref === command.target)?.label
    return {
      type: 'decision',
      turnId,
      at: firedAt,
      source,
      transcript,
      reading: read.reading,
      verb: command.verb,
      target: command.target,
      ...(targetLabel !== undefined ? { targetLabel } : {}),
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
  async function fire(turnId: string, text: string, source: CommandSource, command: Command, page: CommandPage, readingKind: CommandReading, matched: NameMatched | null, firedAt: number, reacting: Reacting): Promise<void> {
    // The Misfire signal (ADR 0076): this Command as the recovery of the one that fired before it.
    if (previous !== null) {
      const signal = misfireSignal(previous, { verb: command.verb, key: command.key, at: firedAt })
      if (signal !== null) log({ type: 'misfire', turnId: previous.turnId, at: firedAt, signal, signalTurnId: turnId, withinMs: firedAt - previous.at })
    }
    previous = { turnId, verb: command.verb, key: command.key, at: firedAt }
    if (source === 'spoken') learnFrom(command, matched, firedAt)

    // A later Command supersedes the one in flight, and silences what it was saying; `stop` is only that.
    cancelInFlight()
    silence()
    generation += 1
    const mine = generation
    inFlight = { turnId, generation: mine }
    const current = (): boolean => inFlight !== null && inFlight.generation === mine

    publish({ type: 'command', turnId, text, action: describeCommand(command, page), at: firedAt })
    if (command.verb === 'stop') {
      inFlight = null
      publish({ type: 'done', turnId, outcome: 'done', at: at() })
      return
    }
    publish({ type: 'status', turnId, status: 'acting', at: at() })
    const callId = `${turnId}-1`
    const { name, args } = toolOf(command)
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
    try {
      const result = await perform(command)
      if (!current()) return
      const card = cardOf(command, result)
      if (speech === undefined) react(card !== null && command.verb === 'read' ? 'display' : 'settled')
      publish({ type: 'tool_result', turnId, callId, name, ok: true, result, at: at() })
      if (card !== null) publish({ type: 'display', turnId, text: card, at: at() })
      if (speech !== undefined) {
        const shownAt = monotonic()
        publish({ type: 'status', turnId, status: 'speaking', at: at() })
        await speakPageRead(speech, turnId, result, current, () => {
          if (current()) react('spoken')
        })
        if (!current()) return
        // Nothing was spoken (the voice failed, or was cut first): the Card was the effect.
        react('display', shownAt)
      } else {
        const state = browser.state()
        sayFailure(turnId, spokenFailureOf({ tool: name, outcome: { ok: true, result }, ...(state.url ? { url: state.url } : {}), ...(state.title ? { title: state.title } : {}) }))
      }
      inFlight = null
      publish({ type: 'done', turnId, outcome: 'done', at: at() })
    } catch (error) {
      if (!current()) return
      react('failed')
      const message = error instanceof Error ? error.message : String(error)
      publish({ type: 'tool_result', turnId, callId, name, ok: false, error: message, at: at() })
      sayFailure(turnId, 'failed')
      inFlight = null
      publish({ type: 'done', turnId, outcome: 'failed', at: at() })
    } finally {
      release?.()
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
   */
  function closeEarly(fired: EarlyFired, endpoint: { transcript: string; at: number; truncated: boolean } | null): void {
    early = null
    if (endpoint !== null) fired.endpointAt = endpoint.at
    log({
      ...fired.record,
      ...(endpoint !== null ? { transcript: endpoint.transcript } : {}),
      ...(endpoint?.truncated ? { truncated: true } : {}),
      earlyFire: { partial: fired.partial, ...(endpoint !== null ? { leadMs: leadOf(fired) } : {}), ...(fired.noul !== undefined ? { noul: fired.noul } : {}) },
      ...(partialCalls > 0 ? { partialCalls } : {}),
    })
    if (endpoint !== null && fired.effect !== null) {
      span(fired.turnId, Math.max(0, fired.effect.at - endpoint.at), { ...fired.effect.detail, earlyFire: true, leadMs: leadOf(fired) })
    }
    if (fired.settled) summarize(fired.turnId)
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
    if (pageFree(quick) && firesEarly(quick)) return { command: quick, page: blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = await collectPage(prepared)
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
    // An Early Fire is a submission: a reading still under way for an earlier Command is stale now.
    submitted += 1
    const turnId = tracer?.mintTurnId() ?? `turn-${at().toString(36)}`
    const firedAt = at()
    const { command, matched } = matchName(found.command, found.page, true)
    const fired: EarlyFired = {
      utterance: mine,
      turnId,
      partial: words,
      firedMono: monotonic(),
      record: recordOf(turnId, firedAt, 'spoken', words, found, command, matched, false),
      ...(found.noul !== undefined ? { noul: found.noul } : {}),
      endpointAt: null,
      effect: null,
      settled: false,
    }
    early = fired
    return { action: fire(turnId, words, 'spoken', command, found.page, found.reading, matched, firedAt, reactingEarly(fired)) }
  }

  return {
    getState: () => (inFlight === null && reading === null && sounding === 0 ? 'idle' : 'running'),

    abort() {
      const had = reading !== null || inFlight !== null || sounding > 0
      // A reading under way is stale from here: when its answer comes, it fires nothing.
      submitted += 1
      reading = null
      cancelInFlight()
      silence()
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

      // The Endpoint of an Utterance a partial already fired on only closes it (#326): the final transcript is not read.
      const fired = early
      if (fired !== null && source === 'spoken' && fired.utterance === utterance) {
        observeTerms(trimmed)
        prepared = null
        closeEarly(fired, { transcript: trimmed, at: endpointAt, truncated })
        nextUtterance()
        if (options?.turnId !== undefined) summarize(options.turnId)
        return true
      }
      // A spoken Endpoint of another Utterance: the Early Fire never reached its own. A typed line leaves it waiting for its Endpoint.
      if (fired !== null && source === 'spoken') closeEarly(fired, null)
      const calls = source === 'spoken' ? partialCalls : 0
      // An Endpoint (or a typed line) ends the Utterance: a partial still being read fires nothing.
      if (source === 'spoken') nextUtterance()

      const turnId = options?.turnId ?? tracer?.mintTurnId() ?? `turn-${at().toString(36)}`
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

      const { command, matched } = matchName(heard.command, heard.page, source === 'spoken')
      log({ ...recordOf(turnId, firedAt, source, trimmed, heard, command, matched, truncated), ...(calls > 0 ? { partialCalls: calls } : {}) })

      if (submission !== submitted) {
        // A later Command (or an abort) arrived while this one was being
        // read: the later one stands. The reading is data; nothing fires.
        publish({ type: 'command', turnId, text: trimmed, action: 'abandoned', dropped: true, at: firedAt })
        publish({ type: 'done', turnId, outcome: 'cancelled', at: at() })
        return true
      }

      if (command.verb === 'none') {
        // An Utterance read as no Command: one greyed entry of the words, nothing else.
        publish({ type: 'command', turnId, text: trimmed, dropped: true, at: firedAt })
        publish({ type: 'done', turnId, outcome: 'done', at: at() })
        return true
      }

      await fire(turnId, trimmed, source, command, heard.page, heard.reading, matched, firedAt, {
        react: (detail, endedAt) => span(turnId, endedAt - endpointAt, detail),
        settled: () => summarize(turnId),
      })
      return true
    },
  }
}
