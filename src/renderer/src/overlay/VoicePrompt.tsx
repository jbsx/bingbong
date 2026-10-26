import { useEffect, useRef, useState } from 'react'
import type { VoicePartialEvent, VoiceState } from '../../../core/voice/ipcChannels'
import { PAUSE_CAP_MS_DEFAULT } from '../../../core/settings/settings'
import { REST_HINT } from '../../../core/voice/voiceHint'
import { earPhase, partialSpans, quietLine, wordlessLine } from '../../../core/voice/voicePrompt'
import { EarWait, VoiceWave } from '../AssistantPanel'
import { useSettings } from '../useSettings'
import { PromptBar } from './PromptBar'

/**
 * The voice state and the live words, as main publishes them to this view
 * (#359), and the Utterance's last words, kept past the Endpoint's clear
 * for its read to name (#442) until the next one's speech starts.
 */
function useVoiceFeed(): { state: VoiceState | null; partial: VoicePartialEvent | null; lastWords: string } {
  const [state, setState] = useState<VoiceState | null>(null)
  const [partial, setPartial] = useState<VoicePartialEvent | null>(null)
  const [lastWords, setLastWords] = useState('')
  const hearing = useRef(false)

  useEffect(() => {
    const applyState = (next: VoiceState): void => {
      if (next.hearing && !hearing.current) setLastWords('')
      hearing.current = next.hearing
      setState(next)
    }
    void window.bingbong.voice.getState().then(applyState)
    const unsubState = window.bingbong.voice.onState(applyState)
    const unsubPartial = window.bingbong.voice.onPartial((event) => {
      setPartial(event)
      if (event.text !== '') setLastWords(event.text)
    })
    return () => {
      unsubState()
      unsubPartial()
    }
  }, [])

  return { state, partial, lastWords }
}

/**
 * The Voice Prompt (ADR 0078, #359): the Prompt Bar's F1 form in the
 * panel's footer — the orb, the hint, and the voice state. While an
 * Utterance is taken it says LISTENING over a waveform, "…" from the
 * frame speech starts (#441), then the live words with any Page Term in
 * peach, and what ends it (the turn check, or
 * the Pause cap of quiet). Typing works the same in every state: the field is
 * always the Prompt Bar, and Stop sits beside it while a run is live.
 */
export function VoicePrompt({ runActive }: { runActive: boolean }) {
  const { state, partial, lastWords } = useVoiceFeed()
  const { settings } = useSettings()
  // The ear's real state (CONTEXT.md): waiting for the wake word, or the microphone off — said, not hidden.
  const ear = earPhase(state)
  const phase = ear === 'off' ? 'rest' : ear
  const earOff = ear === 'off'
  const live = phase === 'listening' || phase === 'hearing'
  // A wait (#442): the ear loading, a line it holds, or the words being read, named with its seconds.
  const waiting = phase === 'starting' || phase === 'transcribing'
  const words = live ? (partial?.text ?? '') : ''
  const placeholder =
    phase === 'starting'
      ? 'Not hearing yet — type a command'
      : phase !== 'rest'
        ? quietLine(settings?.pauseCapMs ?? PAUSE_CAP_MS_DEFAULT)
        : runActive
          ? 'Type a command'
          : earOff
            ? 'Microphone off — type a command'
            : REST_HINT

  return (
    <div className={`voice-prompt voice-prompt--${phase}`}>
      {phase !== 'rest' ? (
        <>
          <div className="voice-prompt-head">
            <span className="voice-orb" aria-hidden="true" />
            {live ? <VoiceWave bars={14} /> : null}
            <span className="voice-prompt-state" role="status">
              {live ? 'Listening' : phase === 'starting' ? 'Starting' : 'Transcribing'}
            </span>
            {phase !== 'starting' ? <span className="voice-prompt-hint">{state?.reason === 'wake' ? 'after “Bing Bong”' : 'after Ctrl+Space'}</span> : null}
          </div>
          <p className={`voice-prompt-said${words === '' && phase === 'listening' ? ' voice-prompt-said--waiting' : ''}`} aria-live="polite">
            {waiting ? (
              <EarWait phase={phase} voice={{ partial: lastWords, transcribing: state?.transcribing === true, ...(state?.since !== undefined ? { since: state.since } : {}) }} />
            ) : words === '' ? (
              wordlessLine(phase)
            ) : (
              partialSpans(words, partial?.terms ?? []).map((span, index) => (span.term ? <em key={index}>{span.text}</em> : <span key={index}>{span.text}</span>))
            )}
            {live ? <span className="voice-prompt-caret" aria-hidden="true" /> : null}
          </p>
        </>
      ) : null}
      <div className="prompt-row">
        {phase === 'rest' ? <span className={`voice-orb${earOff ? ' voice-orb--off' : ''}`} aria-hidden="true" /> : null}
        <PromptBar placeholder={placeholder} />
        {/* Stop's slot is held while nothing runs (#438): Run never moves when Stop appears. */}
        {runActive ? (
          <button type="button" className="panel-stop" onClick={() => void window.bingbong.assistant.abort()} aria-label="Stop active command">
            <span className="panel-stop-mark" aria-hidden="true" />
            Stop
          </button>
        ) : (
          <span className="panel-stop-slot" aria-hidden="true">
            <span className="panel-stop-mark" />
            Stop
          </span>
        )}
      </div>
    </div>
  )
}
