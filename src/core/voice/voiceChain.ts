import type { BiasPhraseSet } from '../moonshine/contextualBiasing'
import type { CommandRunState } from '../pipeline/runState'
import type { PerfTracer } from '../perf/perfTracer'
import type { Clock } from '../ports/clock'
import type { Transcriber, TurnDetector, VadScorer } from '../ports/stt'
import type { WakeWordDetector } from '../ports/wake'
import type { WakeGateCount } from '../perf/lifecycleTelemetry'
import { HOT_LISTEN_SILENCE_MS_DEFAULT } from '../settings/settings'
import { reportFault, type FaultReport } from '../trace/fault'
import type { VoiceHeardEvent, VoiceState } from './ipcChannels'
import type { UtteranceDumper } from './utteranceDump'
import type { UtteranceEndpointerConfig } from './vadEndpointing'
import { createVoiceSession, type SubmittedCommand, type VoiceSession } from './voiceSession'
import type { OverSpeech } from './ownVoice'

// The voice chain off the main thread (#430): the voice session — the VAD,
// the endpointer, the wake trio, Smart Turn and the STT engine — runs in a
// process of its own, and Electron's main thread only routes. The mic's
// frames cross in by message with what the session reads off the app beside
// each one (a line playing, a Command running, the live Settings); the
// session's results cross out the same way: its state, partials, the words
// to submit, perf spans, faults and model loads. The host is the voice
// process's half, the client main's, and the client is a VoiceSession, so
// nothing above the seam changed. A voice process that exits is a fault and
// is started again, the ear down meanwhile.

/** What the session reads off the app, as fresh as the frame it rides with. */
export interface VoiceChainContext {
  /** A line is playing (the speaking gate, #326). */
  speaking: boolean
  /** What the app is saying now (#490): the app's own words, told from the person's over them. */
  speech?: string
  /** What the app's voice sounded in the last echo window (#490): the words its own voice in the mic can have just said. */
  sounded?: string
  /** What speech over the app's voice is, inside a listen (#490); absent is `off`. */
  overSpeech?: OverSpeech
  runState: CommandRunState
  /** The wake threshold Setting. */
  wakeThreshold: number
  /** The pause cap and resumption merge Settings (#37, #60). */
  endpointerConfig?: Partial<UtteranceEndpointerConfig>
  /** The Hot Listen's closing silence Setting (#326). */
  hotListenSilenceMs?: number
}

/** The bias the decoder reads (ADR 0022, 0077): one phrase list, or the Bias Lexicon and the Page Terms as sets. */
export type ChainBias = readonly string[] | readonly BiasPhraseSet[]

/** How the voice process starts: its models' config, and the app as it stands. */
export interface VoiceChainInit<C> {
  config: C
  context: VoiceChainContext
  bias: ChainBias | null
  /**
   * The epoch ms (high resolution) of main's perf tracer's zero, so the
   * process's monotonic readings are main's (the Endpoint's clock reading
   * opens the Reaction, #324); null leaves the session uninstrumented.
   */
  tracerEpochMs: number | null
}

export type ToVoiceChain<C = unknown> =
  | { type: 'init'; init: VoiceChainInit<C> }
  | { type: 'audio'; seq: number; chunk: Float32Array; context: VoiceChainContext }
  | { type: 'context'; context: VoiceChainContext }
  | { type: 'bias'; bias: ChainBias | null }
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'monitoring'; on: boolean }
  | { type: 'interrupt' }
  | { type: 'closeHotListen' }
  | { type: 'taskEnded'; id: number }
  | { type: 'prepare' }

/** A model load timed in the voice process, recorded in main's perf log. */
export interface ChainModelLoad {
  model: string
  durMs: number
  failed: boolean
  /** The voice process's RSS when the load ended, in MB (#451). */
  rssMb?: number
  /** What the voice process's RSS grew by over the load, in MB (#451). */
  rssDeltaMb?: number
}

export type FromVoiceChain =
  | { type: 'ready' }
  /** `wake`: the wake chunks heard and scored since the last reply (#435), when any were heard. */
  | { type: 'scored'; seq: number; wake?: WakeGateCount }
  | { type: 'state'; state: VoiceState; hot: boolean }
  | { type: 'partial'; text: string }
  | { type: 'speechStart' }
  | { type: 'utteranceDropped' }
  | { type: 'submit'; id: number; text: string; submitted: SubmittedCommand }
  | { type: 'heard'; event: VoiceHeardEvent }
  | { type: 'error'; message: string }
  | { type: 'abort' }
  | { type: 'ttsStop' }
  /** The app's voice drops to its floor, or comes back (#490). */
  | { type: 'ttsDuck'; on: boolean }
  | { type: 'chime' }
  | { type: 'span'; turnId: string; stage: string; durMs: number; detail?: Record<string, unknown> }
  | { type: 'prepared'; ok: boolean }
  | { type: 'fault'; report: FaultReport }
  | { type: 'modelLoad'; load: ChainModelLoad }

/** The models a voice process builds from its config. */
export interface VoiceChainModels {
  vad: VadScorer
  transcriber: Transcriber
  turn?: TurnDetector
  /** Absent means hotkey-only. */
  wake?: WakeWordDetector | null
  dumper?: UtteranceDumper
}

export interface VoiceChainHostDeps<C> {
  send(message: FromVoiceChain): void
  /** Builds the models; the live bias getter rides through to the decoder. */
  build(config: C, bias: () => ChainBias | null): Promise<VoiceChainModels>
  /** Epoch ms, high resolution: `performance.timeOrigin + performance.now()`. */
  epochNow(): number
  clock?: Clock
}

export interface VoiceChainHost<C> {
  receive(message: ToVoiceChain<C>): void
}

const systemTimer: Clock = {
  now: () => Date.now(),
  setTimer: (ms, fn) => {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  },
}

/**
 * The voice process's half: builds the models at `init`, runs the voice
 * session over them, and answers every message; whatever arrives before
 * the models are in waits for them, in order.
 */
export function createVoiceChainHost<C>(deps: VoiceChainHostDeps<C>): VoiceChainHost<C> {
  const clock = deps.clock ?? systemTimer
  let context: VoiceChainContext = { speaking: false, runState: 'idle', wakeThreshold: 0.5 }
  let bias: ChainBias | null = null
  let session: VoiceSession | null = null
  let building = false
  const waiting: ToVoiceChain<C>[] = []
  let idleWaiters: (() => void)[] = []
  let submitSeq = 0
  const tasks = new Map<number, () => void>()
  // The wake chunks since the last reply: the gate-open share rides the next `scored` (#435).
  let wakeGate: WakeGateCount = { heard: 0, scored: 0 }

  function setContext(next: VoiceChainContext): void {
    context = next
    if (!next.speaking && idleWaiters.length > 0) {
      const waiters = idleWaiters
      idleWaiters = []
      for (const resolve of waiters) resolve()
    }
  }

  function tracerFor(epochMs: number | null): PerfTracer | undefined {
    if (epochMs === null) return undefined
    let seq = 0
    return {
      // Its own sequence, apart from main's: the ids only need to be unique in the run.
      mintTurnId: () => `turn-${Date.now().toString(36)}-v${(++seq).toString(36)}`,
      now: () => deps.epochNow() - epochMs,
      span: (turnId, stage, durMs, detail) => deps.send({ type: 'span', turnId, stage, durMs, ...(detail !== undefined ? { detail } : {}) }),
      // Main's tracer closes turns; nothing is tallied here.
      summarize: () => null,
    }
  }

  async function start(init: VoiceChainInit<C>): Promise<void> {
    setContext(init.context)
    bias = init.bias
    const models = await deps.build(init.config, () => bias)
    const wake = models.wake ?? null
    session = createVoiceSession({
      vad: models.vad,
      transcriber: models.transcriber,
      ...(models.turn ? { turn: models.turn } : {}),
      clock,
      tts: { stop: () => deps.send({ type: 'ttsStop' }), duck: (on) => deps.send({ type: 'ttsDuck', on }) },
      ...(wake
        ? {
            wake: {
              detector: wake,
              getThreshold: () => context.wakeThreshold,
              chime: () => deps.send({ type: 'chime' }),
            },
          }
        : {}),
      getEndpointerConfig: () => context.endpointerConfig ?? {},
      getHotListenSilenceMs: () => context.hotListenSilenceMs ?? HOT_LISTEN_SILENCE_MS_DEFAULT,
      getOverSpeech: () => context.overSpeech ?? 'off',
      speaking: {
        isSpeaking: () => context.speaking,
        speechText: () => (context.speaking ? (context.speech ?? '') : ''),
        soundedText: () => context.sounded ?? '',
        waitIdle: () => (context.speaking ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve()),
      },
      tracer: tracerFor(init.tracerEpochMs),
      ...(models.dumper ? { dumper: models.dumper } : {}),
      onSubmitCommand: (text, submitted) => {
        submitSeq += 1
        const id = submitSeq
        const ended = new Promise<void>((resolve) => tasks.set(id, resolve))
        deps.send({ type: 'submit', id, text, submitted })
        return ended
      },
      onSpeechStart: () => deps.send({ type: 'speechStart' }),
      onPartial: (text) => deps.send({ type: 'partial', text }),
      onUtteranceDropped: () => deps.send({ type: 'utteranceDropped' }),
      getRunState: () => context.runState,
      onWakeChunk: (scored) => {
        wakeGate.heard += 1
        if (scored) wakeGate.scored += 1
      },
      onAbort: () => deps.send({ type: 'abort' }),
      onStateChange: (state) => deps.send({ type: 'state', state, hot: session?.isHotListenOpen() ?? false }),
      onHeard: (event) => deps.send({ type: 'heard', event }),
      onError: (message) => deps.send({ type: 'error', message }),
    })
    deps.send({ type: 'ready' })
  }

  function handle(message: ToVoiceChain<C>, live: VoiceSession): void {
    switch (message.type) {
      case 'audio': {
        setContext(message.context)
        const { seq } = message
        void live.pushAudio(message.chunk).then(() => {
          const wake = wakeGate
          if (wake.heard === 0) {
            deps.send({ type: 'scored', seq })
            return
          }
          wakeGate = { heard: 0, scored: 0 }
          deps.send({ type: 'scored', seq, wake })
        })
        return
      }
      case 'context':
        setContext(message.context)
        return
      case 'bias':
        bias = message.bias
        return
      case 'arm':
        live.arm()
        return
      case 'disarm':
        live.disarm()
        return
      case 'monitoring':
        if (message.on) live.enableWakeMonitoring()
        else live.disableWakeMonitoring()
        return
      case 'interrupt':
        live.interrupt('abort')
        return
      case 'closeHotListen':
        live.closeHotListen()
        return
      case 'taskEnded': {
        const resolve = tasks.get(message.id)
        tasks.delete(message.id)
        resolve?.()
        return
      }
      case 'prepare':
        live.prepareTranscriber().then(
          () => deps.send({ type: 'prepared', ok: true }),
          (error: unknown) => {
            // The first line retries the load; this one is only told.
            reportFault('voice.chain.prepare', error)
            deps.send({ type: 'prepared', ok: false })
          },
        )
        return
      case 'init':
        return
    }
  }

  return {
    receive(message) {
      if (message.type === 'init') {
        if (building || session !== null) return
        building = true
        start(message.init).then(
          () => {
            const live = session!
            for (const queued of waiting.splice(0)) handle(queued, live)
          },
          (error: unknown) => {
            reportFault('voice.chain.build', error)
            deps.send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
          },
        )
        return
      }
      if (session === null) {
        // Before the models are in, a frame or a press waits for them, in order.
        waiting.push(message)
        return
      }
      handle(message, session)
    },
  }
}

/** The link to one voice process: messages in, and its end. */
export interface VoiceChainLink<C> {
  post(message: ToVoiceChain<C>): void
  /** Ends the process on purpose: its exit is no fault and starts nothing. */
  stop(): void
}

/** What a started process tells the client. */
export interface VoiceChainEvents {
  message(message: FromVoiceChain): void
  /** The process ended; `detail` says how (an exit code, a thrown error). */
  exit(detail: string): void
}

/** What the session tells the app, as createVoiceSession's deps name it. */
export interface VoiceChainCallbacks {
  stopSpeech(): void
  /** The app's voice ducks under speech over it, or comes back (#490). */
  duckSpeech?(on: boolean): void
  chime(): void
  onSubmitCommand(text: string, submitted: SubmittedCommand): void | Promise<unknown>
  onSpeechStart?(): void
  onPartial?(text: string): void
  onUtteranceDropped?(): void
  onAbort(): void
  onStateChange(state: VoiceState): void
  onHeard(event: VoiceHeardEvent): void
  onError(message: string): void
}

export interface VoiceChainClientDeps<C> {
  /** Starts one voice process. */
  start(events: VoiceChainEvents): VoiceChainLink<C>
  /** The models' config, sent at every start. */
  config: C
  /** What the session reads off the app now. */
  context(): VoiceChainContext
  /** The bias now; identity-stable until it changes, so only a change is sent. */
  bias?(): ChainBias | null
  /** Resolves when no line is playing: the idle edge is sent at once, frames or none. */
  waitIdle?(): Promise<void>
  /** Main's tracer: the voice process's spans land in it. */
  tracer?: Pick<PerfTracer, 'span'>
  /** The epoch ms of the tracer's zero (see VoiceChainInit). */
  tracerEpochMs?: number
  callbacks: VoiceChainCallbacks
  /** A model load the voice process timed. */
  onModelLoad?(load: ChainModelLoad): void
  /** A fault the voice process reported. */
  onFault?(report: FaultReport): void
  /** The wake chunks the ear heard and scored (#435), as each batch comes back. */
  onWakeGate?(count: WakeGateCount): void
  clock?: Clock
  /** The wait before the first restart, doubled for each that follows in quick succession; 1 s by default. */
  restartDelayMs?: number
}

export interface VoiceChainClient extends VoiceSession {
  /** Ends the voice process for good (quit, window closed). */
  stop(): void
}

const IDLE_STATE: VoiceState = { listening: false, reason: null, monitoring: false, transcribing: false, hearing: false }
/** The longest wait between restarts. */
const MAX_RESTART_DELAY_MS = 30_000
/** A process that stayed up this long resets the backoff. */
const STABLE_MS = 60_000

/** Main's half: a VoiceSession whose session runs in the voice process. */
export function createVoiceChainClient<C>(deps: VoiceChainClientDeps<C>): VoiceChainClient {
  const clock = deps.clock ?? systemTimer
  const baseDelay = deps.restartDelayMs ?? 1_000
  let link: VoiceChainLink<C> | null = null
  // Bumped at every start: replies meant for a process that has gone are dropped.
  let generation = 0
  let stopped = false
  let state: VoiceState = IDLE_STATE
  let hot = false
  let seq = 0
  const pending = new Map<number, () => void>()
  let monitoringWanted = false
  let prepareWanted = false
  let prepareWaiters: { resolve(): void; reject(error: Error): void }[] = []
  let sentBias: ChainBias | null | undefined
  let waitingIdle = false
  let failures = 0
  let startedAt = 0
  let cancelRestart: (() => void) | null = null

  function post(message: ToVoiceChain<C>): void {
    link?.post(message)
  }

  function syncBias(): void {
    if (!deps.bias) return
    const bias = deps.bias()
    if (bias === sentBias) return
    sentBias = bias
    post({ type: 'bias', bias })
  }

  /** The context now; a line playing also sends its end the moment it comes. */
  function contextNow(): VoiceChainContext {
    const context = deps.context()
    if (context.speaking && !waitingIdle && deps.waitIdle) {
      waitingIdle = true
      void deps.waitIdle().then(() => {
        waitingIdle = false
        post({ type: 'context', context: deps.context() })
      })
    }
    return context
  }

  function setState(next: VoiceState): void {
    state = next
    deps.callbacks.onStateChange(next)
  }

  function onMessage(message: FromVoiceChain, gen: number): void {
    if (gen !== generation) return
    switch (message.type) {
      case 'ready':
        return
      case 'scored':
        if (message.wake) deps.onWakeGate?.(message.wake)
        pending.get(message.seq)?.()
        pending.delete(message.seq)
        return
      case 'state': {
        hot = message.hot
        // The monitoring said at once comes back from the process: no second change.
        const same = (Object.keys(message.state) as (keyof VoiceState)[]).every((key) => message.state[key] === state[key])
        if (!same) setState(message.state)
        return
      }
      case 'partial':
        deps.callbacks.onPartial?.(message.text)
        return
      case 'speechStart':
        deps.callbacks.onSpeechStart?.()
        return
      case 'utteranceDropped':
        deps.callbacks.onUtteranceDropped?.()
        return
      case 'submit': {
        const { id } = message
        const ended = (): void => {
          if (gen === generation) post({ type: 'taskEnded', id })
        }
        const task = deps.callbacks.onSubmitCommand(message.text, message.submitted)
        if (task === undefined) ended()
        else void task.then(ended, ended)
        return
      }
      case 'heard':
        deps.callbacks.onHeard(message.event)
        return
      case 'error':
        deps.callbacks.onError(message.message)
        return
      case 'abort':
        deps.callbacks.onAbort()
        return
      case 'ttsStop':
        deps.callbacks.stopSpeech()
        return
      case 'ttsDuck':
        deps.callbacks.duckSpeech?.(message.on)
        return
      case 'chime':
        deps.callbacks.chime()
        return
      case 'span':
        try {
          deps.tracer?.span(message.turnId, message.stage, message.durMs, message.detail)
        } catch (error) {
          reportFault('voice.chain.span', error)
        }
        return
      case 'prepared': {
        const waiters = prepareWaiters
        prepareWaiters = []
        for (const waiter of waiters) {
          if (message.ok) waiter.resolve()
          else waiter.reject(new Error('the STT engine failed to load'))
        }
        return
      }
      case 'fault':
        deps.onFault?.(message.report)
        return
      case 'modelLoad':
        deps.onModelLoad?.(message.load)
        return
    }
  }

  function settlePending(): void {
    for (const resolve of pending.values()) resolve()
    pending.clear()
  }

  function onExit(detail: string, gen: number): void {
    if (gen !== generation || stopped) return
    link = null
    generation += 1
    settlePending()
    reportFault('voice.chain.exit', new Error(`the voice process ended: ${detail}`))
    // The ear is down until the process is back.
    hot = false
    setState(IDLE_STATE)
    deps.callbacks.onError('The voice process stopped; starting it again.')
    if (clock.now() - startedAt >= STABLE_MS) failures = 0
    failures += 1
    const delay = Math.min(MAX_RESTART_DELAY_MS, baseDelay * 2 ** (failures - 1))
    cancelRestart = clock.setTimer(delay, () => {
      cancelRestart = null
      if (!stopped) launch()
    })
  }

  function launch(): void {
    const gen = generation
    startedAt = clock.now()
    sentBias = undefined
    link = deps.start({
      message: (message) => onMessage(message, gen),
      exit: (detail) => onExit(detail, gen),
    })
    const bias = deps.bias ? deps.bias() : null
    sentBias = bias
    post({ type: 'init', init: { config: deps.config, context: contextNow(), bias, tracerEpochMs: deps.tracerEpochMs ?? null } })
    if (monitoringWanted) post({ type: 'monitoring', on: true })
    if (prepareWanted) post({ type: 'prepare' })
  }

  launch()

  return {
    arm: () => post({ type: 'arm' }),
    disarm: () => post({ type: 'disarm' }),
    // The ear's monitoring is said at once, as an in-process session said it: the
    // dashboard opens the mic on it while the voice process is still starting.
    enableWakeMonitoring() {
      monitoringWanted = true
      post({ type: 'monitoring', on: true })
      if (link !== null && !state.monitoring) setState({ ...state, monitoring: true })
    },
    disableWakeMonitoring() {
      monitoringWanted = false
      post({ type: 'monitoring', on: false })
      if (state.monitoring) setState({ ...state, monitoring: false })
    },
    getState: () => state,
    pushAudio(chunk) {
      if (link === null) return Promise.resolve()
      seq += 1
      const id = seq
      const scored = new Promise<void>((resolve) => pending.set(id, resolve))
      syncBias()
      post({ type: 'audio', seq: id, chunk, context: contextNow() })
      return scored
    },
    interrupt() {
      const live = deps.context().runState !== 'idle' || hot
      post({ type: 'interrupt' })
      return live
    },
    closeHotListen() {
      if (!hot) return false
      hot = false
      post({ type: 'closeHotListen' })
      return true
    },
    isHotListenOpen: () => hot,
    prepareTranscriber() {
      prepareWanted = true
      const loaded = new Promise<void>((resolve, reject) => prepareWaiters.push({ resolve, reject }))
      post({ type: 'prepare' })
      return loaded
    },
    stop() {
      if (stopped) return
      stopped = true
      cancelRestart?.()
      settlePending()
      link?.stop()
      link = null
    },
  }
}
