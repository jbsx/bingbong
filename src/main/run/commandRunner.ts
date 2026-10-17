import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import type { DecisionModel } from '../../core/ports/decisionModel'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandRunState } from '../../core/pipeline/runState'
import type { PageSnapshot } from '../../core/browser/snapshot'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { commandRefOf, describeCommand, type Command, type CommandPage } from '../../core/command/command'
import { COMMAND_HELP } from '../../core/command/help'
import { bestGuess, localMatch } from '../../core/command/localMatch'
import { commandQuestions, commandState, readCommandAnswers } from '../../core/command/jevReading'
import { openAddress } from '../../core/command/openAddress'
import { jevDetailOf, misfireSignal, type CommandLogRecord, type CommandReading, type CommandSource, type DecisionRecord } from '../../core/command/decisionRecord'
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
   * reads against it; a Command that needs no page lets it go.
   */
  prepare(): void
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
}

/** How much of a Page Read the Feed card shows. */
const DISPLAY_LIMIT = 4_000

/**
 * How long a page collected at speech start stays good for: an Utterance
 * can be at most this long, so a prepared page older than this belongs to
 * speech the VAD let go, and the page may have moved on since.
 */
const PREPARED_MAX_AGE_MS = 30_000

/** The page the reading sees when none can be collected: the address alone, no refs. */
function blankPage(browser: BrowserController): CommandPage {
  const state = browser.state()
  return { url: state.url ?? '', title: state.title ?? '', refs: [] }
}

function pageOf(snapshot: PageSnapshot): CommandPage {
  return { url: snapshot.url, title: snapshot.title, refs: snapshot.refs.map(commandRefOf) }
}

/** Whether the Local Match's page-free reading settles the line without the page's refs. */
function pageFree(command: Command | null): command is Command {
  if (command === null) return false
  if (command.verb === 'click' || command.verb === 'type') return false
  // "open <label>" clicks the ref that carries the label (localMatch): the page decides.
  if (command.verb === 'open' && !command.search) return false
  return true
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

  interface Reading {
    command: Command
    page: CommandPage
    reading: CommandReading
    jevAsked: boolean
    jev?: DecisionRecord['jev']
  }

  /** The Local Match first; else one Jev call; else the best guess. */
  async function read(text: string, pending: PreparedPage | null): Promise<Reading> {
    const quick = localMatch(text, [])
    if (pageFree(quick)) return { command: quick, page: blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = await collectPage(pending)
    const local = localMatch(text, page.refs)
    if (local !== null) return { command: local, page, reading: 'local_match', jevAsked: false }
    const model = deps.decisionModel()
    if (model === null) return { command: bestGuess(text, page.refs), page, reading: 'best_guess', jevAsked: false }
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
      command: bestGuess(text, page.refs),
      page,
      reading: 'best_guess',
      jevAsked: true,
      jev: { model: result.model, latencyMs: result.latencyMs, reason: result.reason },
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

  return {
    getState: () => (inFlight === null && reading === null ? 'idle' : 'running'),

    abort() {
      const had = reading !== null || inFlight !== null
      // A reading under way is stale from here: when its answer comes, it fires nothing.
      submitted += 1
      reading = null
      cancelInFlight()
      return had
    },

    prepare() {
      prepared = {
        at: monotonic(),
        snapshot: browser.collectPage().catch((error: unknown) => {
          reportFault('run.commandRunner.prepare', error)
          return null
        }),
      }
    },

    async run(text, options) {
      const trimmed = text.trim()
      if (trimmed === '') return false
      const turnId = options?.turnId ?? tracer?.mintTurnId() ?? `turn-${at().toString(36)}`
      const source: CommandSource = options?.source ?? 'typed'
      const endpointAt = options?.endpointAt ?? monotonic()
      // This submission: a reading still under way for an earlier one is stale now.
      submitted += 1
      const submission = submitted
      reading = { turnId, submission }
      // The prepared page is this Command's, whether it needs it or not.
      const pending = prepared
      prepared = null

      const { command, page, reading: readingKind, jevAsked, jev } = await read(trimmed, pending)
      if (reading !== null && reading.submission === submission) reading = null
      const firedAt = at()

      const targetLabel = command.target === null ? undefined : page.refs.find((ref) => ref.ref === command.target)?.label
      const record: DecisionRecord = {
        type: 'decision',
        turnId,
        at: firedAt,
        source,
        transcript: trimmed,
        reading: readingKind,
        verb: command.verb,
        target: command.target,
        ...(targetLabel !== undefined ? { targetLabel } : {}),
        slot: command.slot,
        jevAsked,
        ...(jev !== undefined ? { jev } : {}),
        ...(options?.truncated ? { truncated: true } : {}),
      }
      log(record)

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

      // The Misfire signal (ADR 0076): this Command as the recovery of the one that fired before it.
      if (previous !== null) {
        const signal = misfireSignal(previous, { verb: command.verb, key: command.key, at: firedAt })
        if (signal !== null) log({ type: 'misfire', turnId: previous.turnId, at: firedAt, signal, signalTurnId: turnId, withinMs: firedAt - previous.at })
      }
      previous = { turnId, verb: command.verb, key: command.key, at: firedAt }

      // A later Command supersedes the one in flight; `stop` is only that.
      cancelInFlight()
      generation += 1
      const mine = generation
      inFlight = { turnId, generation: mine }
      const current = (): boolean => inFlight !== null && inFlight.generation === mine

      publish({ type: 'command', turnId, text: trimmed, action: describeCommand(command, page), at: firedAt })
      if (command.verb === 'stop') {
        inFlight = null
        publish({ type: 'done', turnId, outcome: 'done', at: at() })
        return true
      }
      publish({ type: 'status', turnId, status: 'acting', at: at() })
      const callId = `${turnId}-1`
      const { name, args } = toolOf(command)
      publish({ type: 'tool_call', turnId, callId, name, args, at: at() })

      // The Reaction (CONTEXT.md): Endpoint to the action's first observable effect.
      let reacted = false
      const react = (effect: string): void => {
        if (reacted) return
        reacted = true
        span(turnId, monotonic() - endpointAt, { verb: command.verb, effect, reading: readingKind, source })
      }
      const release = deps.onEffect?.((effect) => {
        if (current()) react(effect)
      })
      try {
        const result = await perform(command)
        if (!current()) return true
        const card = cardOf(command, result)
        react(card !== null && command.verb === 'read' ? 'display' : 'settled')
        publish({ type: 'tool_result', turnId, callId, name, ok: true, result, at: at() })
        if (card !== null) publish({ type: 'display', turnId, text: card, at: at() })
        inFlight = null
        publish({ type: 'done', turnId, outcome: 'done', at: at() })
      } catch (error) {
        if (!current()) return true
        react('failed')
        const message = error instanceof Error ? error.message : String(error)
        publish({ type: 'tool_result', turnId, callId, name, ok: false, error: message, at: at() })
        inFlight = null
        publish({ type: 'done', turnId, outcome: 'failed', at: at() })
      } finally {
        release?.()
        try {
          tracer?.summarize(turnId)
        } catch (error) {
          reportFault('run.commandRunner.summarize', error, { turnId })
        }
      }
      return true
    },
  }
}
