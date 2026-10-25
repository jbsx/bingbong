import { useEffect, useState } from 'react'
import type { OrbStatus } from './useAssistant'
import { runProgressParts, type RunProgress } from '../../core/pipeline/runProgress'
import type { TaskProgress } from '../../core/pipeline/taskProgress'

/**
 * The Task's progress bar (#375): a track along the capsule's foot that
 * moves with each hop's Progress Noul (#373) as it arrives — forward on a
 * hop that helped, held in the middle, back on one that did not, full on
 * a sure yes — drawn in the theme's bar idiom (ADR 0078). The fill and the
 * moves ride the element as data: the e2e's observation point.
 */
export function TaskBar({ progress }: { progress: TaskProgress }) {
  const percent = Math.round(progress.filled * 100)
  return (
    <span
      className={`task-bar task-bar--${progress.moves.at(-1) ?? 'held'}`}
      role="progressbar"
      aria-label="task progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-filled={percent}
      data-moves={progress.moves.join(' ')}
    >
      <span className="task-bar-fill" style={{ width: `${percent}%` }} />
    </span>
  )
}

export function StatusOrb({ status }: { status: OrbStatus }) {
  return <div className={`status-orb status-orb--${status}`} aria-label={`assistant ${status}`} />
}

/**
 * The state names the pill can show (#50) — calm text beside the dot.
 * Awake and waiting is "Ready", never "Idle" — the Idle Screen is another
 * state — and a Stop, the user's own act, is "Stopped" (#334).
 */
const PILL_LABELS: Record<OrbStatus, string> = {
  idle: 'Ready',
  thinking: 'Thinking…',
  acting: 'Acting…',
  loading: 'Loading…',
  speaking: 'Speaking…',
  cancelled: 'Stopped',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
}

/**
 * The capsule's tone (ADR 0078): quiet while Ready or Stopped, peach while
 * Bing Bong works — thinking, acting, transcribing, speaking — or listens.
 */
export function capsuleTone(status: OrbStatus): 'ready' | 'working' | 'listening' | 'stopped' {
  if (status === 'idle') return 'ready'
  if (status === 'cancelled') return 'stopped'
  if (status === 'listening') return 'listening'
  return 'working'
}

/** The listening waveform: an indicator of an open ear, drawn, not measured. */
export function VoiceWave({ bars }: { bars: number }) {
  return (
    <span className="voice-wave" aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  )
}

/**
 * The status pill (#50): the state, named in text beside the still orb —
 * readable from across the room without any motion.
 */
export function StatusPill({ status }: { status: OrbStatus }) {
  return (
    <span className={`status-pill status-pill--${status}`} role="status">
      {PILL_LABELS[status]}
    </span>
  )
}

/**
 * The Toolbar's live progress line (#43): what the stage is on and the
 * seconds in it (#428) — the Hop past the first, a stuck stage named —
 * the stage too when the pill shows another state (#331), rendered from
 * event timestamps with a renderer-side tick — no heartbeat IPC. A long
 * detail ellipsizes and the seconds stay in sight; a genuine hang reads as
 * an honestly climbing number, and Stop stays the only escape.
 */
export function RunHint({ progress, status }: { progress: RunProgress; status: OrbStatus }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const parts = runProgressParts(progress, now, status)

  return (
    <span className="run-hint" role="status">
      {parts.named !== '' ? <span className="run-hint-tail">{parts.named}</span> : null}
      {parts.detail !== null ? <span className="run-hint-detail">{parts.detail}</span> : null}
      <span className="run-hint-tail">
        {parts.detail !== null ? ' · ' : ''}
        {parts.tail}
      </span>
    </span>
  )
}
