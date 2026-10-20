import { useEffect, useState } from 'react'
import type { VoicePartialEvent, VoiceState } from '../../../core/voice/ipcChannels'
import { PAUSE_CAP_MS_DEFAULT } from '../../../core/settings/settings'
import { earPhase, partialSpans, quietLine } from '../../../core/voice/voicePrompt'
import { VoiceWave } from '../AssistantPanel'
import { useSettings } from '../useSettings'
import { PromptBar } from './PromptBar'

/** The voice state and the live words, as main publishes them to this view (#359). */
function useVoiceFeed(): { state: VoiceState | null; partial: VoicePartialEvent | null } {
  const [state, setState] = useState<VoiceState | null>(null)
  const [partial, setPartial] = useState<VoicePartialEvent | null>(null)

  useEffect(() => {
    void window.bingbong.voice.getState().then(setState)
    const unsubState = window.bingbong.voice.onState(setState)
    const unsubPartial = window.bingbong.voice.onPartial(setPartial)
    return () => {
      unsubState()
      unsubPartial()
    }
  }, [])

  return { state, partial }
}

/**
 * The Voice Prompt (ADR 0078, #359): the Prompt Bar's F1 form in the
 * panel's footer — the orb, the hint, and the voice state. While an
 * Utterance is taken it says LISTENING over a waveform, shows the live
 * words with any Page Term in peach, and what ends it (the turn check, or
 * the Pause cap of quiet). Typing works the same in every state: the field is
 * always the Prompt Bar, and Stop sits beside it while a run is live.
 */
export function VoicePrompt({ runActive }: { runActive: boolean }) {
  const { state, partial } = useVoiceFeed()
  const { settings } = useSettings()
  // The ear's real state (CONTEXT.md): waiting for the wake word, or the microphone off — said, not hidden.
  const ear = earPhase(state)
  const phase = ear === 'off' ? 'rest' : ear
  const earOff = ear === 'off'
  const words = phase === 'rest' ? '' : (partial?.text ?? '')
  const placeholder =
    phase !== 'rest' ? quietLine(settings?.pauseCapMs ?? PAUSE_CAP_MS_DEFAULT) : runActive ? 'Type a command' : earOff ? 'Microphone off — type a command' : 'Say “Bing Bong” or type a command'

  return (
    <div className={`voice-prompt voice-prompt--${phase}`}>
      {phase !== 'rest' ? (
        <>
          <div className="voice-prompt-head">
            <span className="voice-orb" aria-hidden="true" />
            {phase === 'listening' ? <VoiceWave bars={14} /> : null}
            <span className="voice-prompt-state" role="status">
              {phase === 'listening' ? 'Listening' : 'Transcribing'}
            </span>
            <span className="voice-prompt-hint">{state?.reason === 'wake' ? 'after “Bing Bong”' : 'after Ctrl+Space'}</span>
          </div>
          <p className={`voice-prompt-said${words === '' ? ' voice-prompt-said--waiting' : ''}`} aria-live="polite">
            {words === ''
              ? 'say a command'
              : partialSpans(words, partial?.terms ?? []).map((span, index) => (span.term ? <em key={index}>{span.text}</em> : <span key={index}>{span.text}</span>))}
            {phase === 'listening' ? <span className="voice-prompt-caret" aria-hidden="true" /> : null}
          </p>
        </>
      ) : null}
      <div className="prompt-row">
        {phase === 'rest' ? <span className={`voice-orb${earOff ? ' voice-orb--off' : ''}`} aria-hidden="true" /> : null}
        <PromptBar placeholder={placeholder} />
        {runActive ? (
          <button type="button" className="panel-stop" onClick={() => void window.bingbong.assistant.abort()} aria-label="Stop active command">
            <span className="panel-stop-mark" aria-hidden="true" />
            Stop
          </button>
        ) : null}
      </div>
    </div>
  )
}
