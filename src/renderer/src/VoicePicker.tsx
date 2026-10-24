import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TTS_VOICE, type TtsVoiceEntry } from '../../core/tts/ttsVoices'

/**
 * Settings › Voice › TTS voice (#412): the Kokoro voices, then the
 * installed Piper ones, a radio each, chosen by Save like every setting.
 * Beside each voice its synthesis cost as a bar, a percentage of the most
 * expensive listed (no seconds: they mean nothing on another machine), and
 * a ▶ that plays it saying the sample line; one preview at a time, and
 * leaving the page stops it.
 */
export function VoicePicker({ voices, value, onChange }: { voices: readonly TtsVoiceEntry[]; value: string; onChange: (voiceId: string) => void }) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const playingRef = useRef<string | null>(null)

  useEffect(() => () => window.bingbong.tts.stopPreview(), [])

  const preview = (voiceId: string): void => {
    if (playingRef.current === voiceId) {
      window.bingbong.tts.stopPreview()
      return
    }
    playingRef.current = voiceId
    setPlaying(voiceId)
    setPreviewError(null)
    void window.bingbong.tts
      .preview(voiceId)
      .then((outcome) => {
        if (!outcome.ok) setPreviewError(outcome.error)
      })
      .catch((error: unknown) => setPreviewError(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        if (playingRef.current !== voiceId) return
        playingRef.current = null
        setPlaying(null)
      })
  }

  const defaultVoice = voices.find((voice) => voice.id === DEFAULT_TTS_VOICE)
  const known = value === '' || voices.some((voice) => voice.id === value)
  const groups = [
    { title: 'Kokoro', voices: voices.filter((voice) => voice.engine === 'kokoro') },
    { title: 'Piper (installed)', voices: voices.filter((voice) => voice.engine === 'piper') },
  ]

  const row = (id: string, voiceId: string, label: React.ReactNode, voice: TtsVoiceEntry | undefined) => (
    <div className="voice-row" key={id} data-voice={id} data-selected={value === id}>
      <label className="voice-choice">
        <input type="radio" name="tts-voice" value={id} checked={value === id} onChange={() => onChange(id)} />
        <span className="voice-name">{label}</span>
      </label>
      {voice === undefined ? null : (
        <span className="voice-cost" title="Synthesis cost, against the most expensive voice listed" aria-label={`cost ${voice.costPercent}%`}>
          <span className="voice-cost-bar">
            <span className="voice-cost-fill" style={{ width: `${voice.costPercent}%` }} />
          </span>
          <span className="voice-cost-percent">{voice.costPercent}%</span>
        </span>
      )}
      {voice === undefined ? null : (
        <button
          type="button"
          className="voice-preview"
          aria-label={playing === voiceId ? `Stop ${voice.label}` : `Preview ${voice.label}`}
          aria-pressed={playing === voiceId}
          onClick={() => preview(voiceId)}
        >
          {playing === voiceId ? '■' : '▶'}
        </button>
      )}
    </div>
  )

  return (
    <div className="voice-picker" role="radiogroup" aria-label="TTS voice">
      {row(
        '',
        DEFAULT_TTS_VOICE,
        <>
          Default <span className="voice-detail">Kokoro {defaultVoice?.label ?? 'Heart'}</span>
        </>,
        defaultVoice,
      )}
      {groups.map((group) =>
        group.voices.length === 0 ? null : (
          <div className="voice-group" key={group.title} role="group" aria-label={group.title}>
            <div className="voice-group-title">{group.title}</div>
            {group.voices.map((voice) =>
              row(
                voice.id,
                voice.id,
                <>
                  {voice.label}
                  {voice.detail === undefined ? null : <span className="voice-detail">{voice.detail}</span>}
                </>,
                voice,
              ),
            )}
          </div>
        ),
      )}
      {known ? null : (
        <div className="voice-row voice-row--stale" data-voice={value} data-selected>
          <label className="voice-choice">
            <input type="radio" name="tts-voice" value={value} checked disabled />
            <span className="voice-name">Previously selected voice ({value}, not installed)</span>
          </label>
        </div>
      )}
      {previewError === null ? null : (
        <p className="settings-note voice-preview-error" role="status">
          Preview: {previewError}
        </p>
      )}
    </div>
  )
}
