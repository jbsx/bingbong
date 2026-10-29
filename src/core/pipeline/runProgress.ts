import type { PipelineEvent, PipelineStatus } from './events'
import { stageWord } from './stageWords'
import type { EarPhase } from '../voice/voicePrompt'
import { songWaitParts, type SongWait } from '../music/songWait'

// Progress projection: the header hint's state, as a pure function over the
// pipeline event stream. The stage and its start come from status events.
// Elapsed time is computed by the caller's clock — the renderer ticks over
// the event timestamps, so there is no per-second heartbeat IPC.

/** What the header hint renders for the active run. */
export interface RunProgress {
  stage: PipelineStatus
  /** Wall-clock `at` of the stage's status event — the elapsed anchor, so the seconds are this stage's own (#428). */
  startedAt: number
  /** What the stage is on (#428): the heard words while hop 0 thinks, the action's object while it acts and while its page loads (#438). */
  detail?: string
  /** Acting's own word for the action (#438), carried into its Loading: the word the pill says while it acts. */
  word?: string
  /** The Hop the stage is in (#428). */
  hop?: number
  /** A song waiting to sound (#507): the hint then says the wait's words on the wait's clock, as the Wait Card does. */
  wait?: SongWait
}

/**
 * The stage a `status` event enters, from the last stage held (#428, #438):
 * the same action's Loading, carried from its own turn into the next hop's,
 * keeps its start so its seconds go on climbing; a Loading with no detail of
 * its own is on what the action was on, its word and object riding on — the
 * same hop only. One reading for every surface that shows a stage: the
 * Capsule's hint and the Ledger Strip (#475) read the same words and seconds.
 */
export function stageEntered(last: RunProgress | null, event: Extract<PipelineEvent, { type: 'status' }>): RunProgress {
  const sameHop = last !== null && last.hop === event.hop
  const goesOn = sameHop && event.status === 'loading' && last.stage === 'loading'
  const carried = sameHop && event.status === 'loading' && event.detail === undefined && (last.stage === 'acting' || last.stage === 'loading') ? last : null
  const detail = event.detail ?? carried?.detail
  const word = event.word ?? carried?.word
  return {
    stage: event.status,
    startedAt: goesOn ? last.startedAt : event.at,
    ...(word !== undefined ? { word } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(event.hop !== undefined ? { hop: event.hop } : {}),
    ...(event.wait !== undefined ? { wait: event.wait } : {}),
  }
}

/** Folds pipeline events into the current RunProgress. Pure and renderer-agnostic. */
export function createRunProgressTracker(): {
  onEvent(event: PipelineEvent): void
  current(): RunProgress | null
} {
  let progress: RunProgress | null = null
  // The turn of the last stage entered (#428): a line thinks before its
  // `command`, and each Hop is a turn of its own, so the stage leads.
  // Only that turn's `done` clears the hint, never a late one gone by.
  let activeTurn: string | null = null
  // The last stage entered, kept past its turn's `done`: an action's wait goes on into the next hop's turn (#428).
  let last: RunProgress | null = null

  return {
    onEvent(event) {
      switch (event.type) {
        case 'status': {
          activeTurn = event.turnId
          progress = stageEntered(last, event)
          last = progress
          return
        }
        case 'done':
          if (event.turnId !== activeTurn) return
          activeTurn = null
          progress = null
          return
        default:
          return
      }
    },
    current: () => progress,
  }
}

/** The state the Status Capsule's pill names: the voice states outrank the Command's stage. */
export type CapsuleStatus = 'idle' | 'starting' | 'earFailed' | 'listening' | 'transcribing' | PipelineStatus

/**
 * What the Status Capsule's pill names, from the ear's phase, the voice
 * state and the Command's stage. A cold ear outranks the ear's own states
 * (#442), and a line it holds outranks a Command; a typed Command's stage
 * still shows while the ear loads. Transcribing outranks listening (#38):
 * the endpoint fired, never claim the ear is open while it reads. A line
 * being heard outranks a stage, the receipt first (#441). An open ear that
 * has heard nothing yields to a running Command's stage (#472): a Hot
 * Listen stays open through its Task, and the screen says the work, the
 * waveform beside it saying the ear is open. The app's own voice after the
 * Task has ended is "Speaking…": most speech publishes no stage.
 */
export function capsuleStatus(ear: EarPhase, voice: { transcribing: boolean; speaking?: boolean }, run: CapsuleStatus): CapsuleStatus {
  if (ear === 'starting' && (voice.transcribing || run === 'idle')) return 'starting'
  if (ear === 'failed' && run === 'idle') return 'earFailed'
  if (voice.transcribing) return 'transcribing'
  if (ear === 'hearing') return 'listening'
  if (ear === 'listening' && (run === 'idle' || run === 'cancelled')) return 'listening'
  if (run === 'idle' && voice.speaking === true) return 'speaking'
  return run
}

/**
 * What a Loading stage loads, as its detail (#442): the host of the
 * address a navigation goes to — every navigation, by kind — with no
 * `www.`; none for an address that is not a web page.
 */
export function loadingDetail(url: string | null | undefined): string | undefined {
  if (url == null || !URL.canParse(url)) return undefined
  const { protocol, hostname } = new URL(url)
  return (protocol === 'http:' || protocol === 'https:') && hostname !== '' ? hostname.replace(/^www\./, '') : undefined
}

/**
 * How long each stage runs before the hint names the wait (#428, #442):
 * the stage's p95 on the dev PC (owner ruling 4 on #442). A GUESS until
 * the stage spans settle it: no log had a per-stage length when this was
 * set, so each is the dev `pnpm perf:report` p95 (2026-10-26, 84 files) of
 * the span that holds the stage — thinking and acting both fall inside
 * `reaction` (Endpoint to first effect, p95 1711 ms), loading inside
 * `task` (p95 7192 ms). Re-dated from the `stage-*` spans' p95, and then
 * from the kiosk baseline's (#439). Speaking names no wait.
 */
export const STUCK_STAGE_MS: Readonly<Record<PipelineStatus, number | null>> = {
  thinking: 1_711,
  acting: 1_711,
  loading: 7_192,
  speaking: null,
  cancelled: null,
}

/** The line a stage past its {@link STUCK_STAGE_MS} carries: which wait it is. */
const STUCK_LINES: Readonly<Record<PipelineStatus, string | null>> = {
  thinking: 'still thinking',
  acting: 'still acting',
  loading: 'page still loading',
  speaking: null,
  cancelled: null,
}

/**
 * The hint for an active Command, in parts (#428): the stage spelled out
 * only when the pill beside it shows another state (#331), what the stage
 * is on — the part a long line ellipsizes first — the stage's words: the
 * Hop past the first and a stuck stage named, which go next (#462) — and
 * the seconds in this stage, which climb as the honest-hang signal and are
 * never cut; Stop stays the only escape.
 */
export function runProgressParts(progress: RunProgress, now: number, pillStatus: CapsuleStatus): { named: string; detail: string | null; stage: string | null; seconds: string; tied?: true } {
  const named = pillStatus === progress.stage ? '' : `${stageWord(progress)} — `
  const hop = progress.hop !== undefined && progress.hop > 0 ? `hop ${progress.hop}` : null
  // A song's wait (#507, ruling 3): the song named, then the Wait Card's own words — which give way after the song does —
  // tied to its count, never cut. Never "stuck": a lookup is bounded by its own timeout, and the count down says when it ends.
  if (progress.wait !== undefined) {
    const { words, count } = songWaitParts(progress.wait, now)
    return { named, detail: `“${progress.wait.song.title}”`, stage: hop !== null ? `${hop} · ${words}` : words, seconds: count, tied: true }
  }
  const elapsed = Math.max(0, now - progress.startedAt)
  const seconds = Math.floor(elapsed / 1000)
  const threshold = STUCK_STAGE_MS[progress.stage]
  const stuck = threshold !== null && elapsed >= threshold ? STUCK_LINES[progress.stage] : null
  const detail = progress.detail === undefined || progress.detail === '' ? null : progress.stage === 'thinking' ? `“${progress.detail}”` : progress.detail
  const words = [hop, stuck].filter((part) => part !== null)
  return {
    named,
    detail,
    stage: words.length > 0 ? words.join(' · ') : null,
    seconds: `${seconds}s`,
  }
}

/** The hint as one line: {@link runProgressParts} joined. */
export function describeRunProgress(progress: RunProgress, now: number, pillStatus: CapsuleStatus): string {
  const { named, detail, stage, seconds, tied } = runProgressParts(progress, now, pillStatus)
  const words = [detail, stage].filter((part) => part !== null).join(' · ')
  return named + (words === '' ? seconds : `${words}${tied === true ? ' ' : ' · '}${seconds}`)
}
