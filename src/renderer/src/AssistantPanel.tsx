import { useEffect, useState } from 'react'
import type { OrbStatus } from './useAssistant'
import { describeRunProgress, type RunProgress } from '../../core/pipeline/runProgress'

export function StatusOrb({ status }: { status: OrbStatus }) {
  return <div className={`status-orb status-orb--${status}`} aria-label={`assistant ${status}`} />
}

/** The state names the pill can show (#50) — calm text beside the dot. */
const PILL_LABELS: Record<OrbStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  acting: 'Acting…',
  speaking: 'Speaking…',
  cancelled: 'Cancelled',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
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
 * The Toolbar's live progress line (#43): climbing elapsed counter (the
 * stage too when the pill shows another state, #331),
 * rendered from event timestamps with a renderer-side tick — no heartbeat
 * IPC. A genuine hang reads as an honestly climbing number; Stop stays the
 * only escape.
 */
export function RunHint({ progress, status }: { progress: RunProgress; status: OrbStatus }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className="run-hint" role="status">
      {describeRunProgress(progress, now, status)}
    </span>
  )
}
