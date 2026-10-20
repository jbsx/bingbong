import { useEffect, useState } from 'react'
import type { OrbStatus } from './useAssistant'
import { describeRunProgress, type RunProgress } from '../../core/pipeline/runProgress'

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
