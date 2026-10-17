import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import type { DecisionModel } from '../../core/ports/decisionModel'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandRunState } from '../../core/pipeline/runState'
import type { PageSnapshot } from '../../core/browser/snapshot'
import type { PerfTracer } from '../../core/perf/perfTracer'
import { commandRefOf, describeCommand, type Command, type CommandPage } from '../../core/command/command'
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
   * flight is superseded: its late result reaches nothing. Resolves false
   * for a blank line — nothing is published then.
   */
  run(text: string, options?: CommandRunOptions): Promise<boolean>
  getState(): CommandRunState
  /** Interrupt the Command in flight (Escape, the Abort Head). Returns whether one was. */
  abort(): boolean
  /**
   * Speech started (#324): collect the page's refs now, in parallel with
   * the speech, so the list is in hand at the Endpoint. The next Command
   * reads against it.
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

const HELP_TEXT = [
  'say or type a command: open <site or words>, search for <words>, click <label or ref>, type <text> in <field>,',
  'scroll up|down, back, forward, press enter|escape|space|up|down|left|right, read, clear, stop',
  'the CLI grammar still works: navigate <url>, read, click <ref>, type <ref> <text>, scroll up|down, press <key> [n], screenshot [path], back',
].join('\n')

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

export function createCommandRunner(deps: CommandRunnerDeps): CommandRunner {
  const { browser, publish, tracer } = deps
  /** The Command whose action is in flight, if one is. */
  let inFlight: { turnId: string; generation: number } | null = null
  let generation = 0
  let screenshotCount = 0
  /** The page collected at speech start, waiting for the Endpoint's Command. */
  let prepared: Promise<PageSnapshot | null> | null = null
  /** The Command before, for the Misfire signal. */
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

  /** The page the Command is read against: the one collected at speech start, else one collected now. */
  async function collectPage(): Promise<CommandPage> {
    const pending = prepared
    prepared = null
    const snapshot = pending !== null ? await pending : await browser.collectPage().catch((error: unknown) => {
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
  async function read(text: string): Promise<Reading> {
    const quick = localMatch(text, [])
    if (pageFree(quick)) return { command: quick, page: blankPage(browser), reading: 'local_match', jevAsked: false }
    const page = await collectPage()
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

  async function perform(command: Command): Promise<string> {
    switch (command.verb) {
      case 'open':
        return browser.navigate(openAddress(command.slot ?? '', command.search === true))
      case 'click': {
        const click = browser.click(command.target ?? 0)
        // The chosen ref lights as the click lands: in parallel, never before it.
        void browser.showRef(command.target ?? 0).catch((error: unknown) => reportFault('run.commandRunner.showRef', error))
        return click
      }
      case 'type': {
        const typed = browser.type(command.target ?? 0, command.slot ?? '')
        void browser.showRef(command.target ?? 0).catch((error: unknown) => reportFault('run.commandRunner.showRef', error))
        return typed
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
        return HELP_TEXT
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
    getState: () => (inFlight === null ? 'idle' : 'running'),

    abort: () => cancelInFlight(),

    prepare() {
      prepared = browser.collectPage().catch((error: unknown) => {
        reportFault('run.commandRunner.prepare', error)
        return null
      })
    },

    async run(text, options) {
      const trimmed = text.trim()
      if (trimmed === '') return false
      const turnId = options?.turnId ?? tracer?.mintTurnId() ?? `turn-${at().toString(36)}`
      const source: CommandSource = options?.source ?? 'typed'
      const endpointAt = options?.endpointAt ?? monotonic()

      const { command, page, reading, jevAsked, jev } = await read(trimmed)
      const firedAt = at()

      // The Misfire signal (ADR 0076): this Command as the recovery of the one before.
      if (previous !== null) {
        const signal = misfireSignal(previous, { verb: command.verb, key: command.key, at: firedAt })
        if (signal !== null) log({ type: 'misfire', turnId: previous.turnId, at: firedAt, signal, signalTurnId: turnId, withinMs: firedAt - previous.at })
      }
      const targetLabel = command.target === null ? undefined : page.refs.find((ref) => ref.ref === command.target)?.label
      log({
        type: 'decision',
        turnId,
        at: firedAt,
        source,
        transcript: trimmed,
        reading,
        verb: command.verb,
        target: command.target,
        ...(targetLabel !== undefined ? { targetLabel } : {}),
        slot: command.slot,
        jevAsked,
        ...(jev !== undefined ? { jev } : {}),
        ...(options?.truncated ? { truncated: true } : {}),
      } as DecisionRecord)
      previous = { turnId, verb: command.verb, key: command.key, at: firedAt }

      if (command.verb === 'none') {
        // An Utterance read as no Command: one greyed entry of the words, nothing else.
        publish({ type: 'command', turnId, text: trimmed, dropped: true, at: firedAt })
        publish({ type: 'done', turnId, outcome: 'done', at: at() })
        return true
      }

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
        span(turnId, monotonic() - endpointAt, { verb: command.verb, effect, reading, source })
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
