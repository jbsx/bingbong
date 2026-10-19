import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../core/settings/settings'
import { ENDPOINT_DELAY_MS_MAX, ENDPOINT_DELAY_MS_MIN, HOT_LISTEN_SILENCE_MS_MAX, HOT_LISTEN_SILENCE_MS_MIN, RESUMPTION_MERGE_MS_MAX, RESUMPTION_MERGE_MS_MIN, WEB_ZOOM_PERCENT_MAX, WEB_ZOOM_PERCENT_MIN, WAKE_WORD_THRESHOLD_MAX, WAKE_WORD_THRESHOLD_MIN, asAppearance, asSttModel } from '../../core/settings/settings'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'

/** Select value for "the saved mic is not plugged in right now". */
const STALE_MIC_VALUE = '__stale__'
/** Select value for "the saved voice is not installed right now". */
const STALE_VOICE_VALUE = '__stale__'

function sameSettings(a: AppSettings, b: AppSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface MicOption {
  deviceId: string
  label: string
}

function useMicrophones(): MicOption[] {
  const [mics, setMics] = useState<MicOption[]>([])

  useEffect(() => {
    let cancelled = false
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (cancelled) return
        const inputs = devices.filter((device) => device.kind === 'audioinput')
        setMics(
          inputs.map((device, index) => ({
            deviceId: device.deviceId,
            // Labels stay empty until mic permission is granted (T9).
            label: device.label || `Microphone ${index + 1}`,
          })),
        )
      })
      .catch(() => setMics([]))
    return () => {
      cancelled = true
    }
  }, [])

  return mics
}

function useTtsVoices(): string[] {
  const [voices, setVoices] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void window.bingbong.tts
      .listVoices()
      .then((installed) => {
        if (!cancelled) setVoices(installed)
      })
      .catch(() => setVoices([]))
    return () => {
      cancelled = true
    }
  }, [])

  return voices
}

/**
 * Learned Terms (ADR 0022): the lexicon's one human surface. The list
 * grows itself from repeated mishear repairs; this section is for looking
 * and the occasional manual fix — removing a word keeps it out (the ledger
 * remembers the rejection), adding one puts it straight in.
 */
function LearnedTermsSection() {
  const [terms, setTerms] = useState<readonly string[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void window.bingbong.learnedTerms
        .list()
        .then((list) => {
          if (!cancelled) setTerms(list)
        })
        .catch(() => undefined)
    }
    load()
    const unsubscribe = window.bingbong.learnedTerms.onChanged((list) => setTerms(list))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const add = async () => {
    const term = draft.trim()
    if (term === '') return
    const added = await window.bingbong.learnedTerms.add(term).catch(() => false)
    if (added) setDraft('')
  }

  return (
    <section className="settings-section" aria-label="learned terms">
      <h2>Speech vocabulary</h2>
      <p className="settings-note">
        Words the assistant learned to hear better — added automatically when the same corrected
        mishear shows up twice. Removing one keeps it out.
      </p>
      {terms.length === 0 ? (
        <p className="settings-note">Nothing learned yet.</p>
      ) : (
        <ul className="settings-terms">
          {terms.map((term) => (
            <li key={term} className="settings-term">
              <span>{term}</span>
              <button
                type="button"
                className="settings-term-remove"
                aria-label={`Remove ${term}`}
                onClick={() => void window.bingbong.learnedTerms.remove(term)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <Field label="Add a word">
        <input
          type="text"
          value={draft}
          placeholder="e.g. linus tech tips"
          aria-label="Add a learned word"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
      </Field>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      {children}
    </label>
  )
}

export function SettingsPage({
  settings,
  onSave,
  onClose,
}: {
  settings: AppSettings
  onSave: (next: AppSettings) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const mics = useMicrophones()
  const voices = useTtsVoices()
  const lastSynced = useRef<AppSettings>(settings)

  // Follow external changes (another window's save, or our own sanitized
  // result) — but never clobber an in-progress edit.
  useEffect(() => {
    setDraft((current) => {
      const untouched = sameSettings(current, lastSynced.current)
      lastSynced.current = settings
      return untouched ? settings : current
    })
  }, [settings])

  const dirty = !sameSettings(draft, settings)
  const micKnown = draft.micId === 'default' || mics.some((mic) => mic.deviceId === draft.micId)
  const voiceKnown = draft.ttsVoice === '' || voices.includes(draft.ttsVoice)

  const submit = async () => {
    await onSave(draft)
    setSavedAt(Date.now())
  }

  return (
    <section className="settings-page" aria-label="settings">
      <div className="settings-scroll">
        <section className="settings-section">
          <h2>Voice</h2>
          <Field label="Microphone">
            <select
              value={micKnown ? draft.micId : STALE_MIC_VALUE}
              aria-label="Microphone"
              onChange={(event) => setDraft({ ...draft, micId: event.target.value })}
            >
              <option value="default">System default</option>
              {mics.map((mic) => (
                <option key={mic.deviceId} value={mic.deviceId}>
                  {mic.label}
                </option>
              ))}
              {micKnown ? null : (
                <option value={STALE_MIC_VALUE} disabled>
                  Previously selected microphone (unavailable)
                </option>
              )}
            </select>
          </Field>
          <Field label={`Wake-word threshold — ${draft.wakeWordThreshold.toFixed(2)}`}>
            <input
              type="range"
              min={WAKE_WORD_THRESHOLD_MIN}
              max={WAKE_WORD_THRESHOLD_MAX}
              step={0.05}
              value={draft.wakeWordThreshold}
              aria-label="Wake-word threshold"
              onChange={(event) => setDraft({ ...draft, wakeWordThreshold: Number(event.target.value) })}
            />
          </Field>
          <Field label={`Endpoint delay — ${draft.endpointDelayMs} ms`}>
            <input
              type="range"
              min={ENDPOINT_DELAY_MS_MIN}
              max={ENDPOINT_DELAY_MS_MAX}
              step={50}
              value={draft.endpointDelayMs}
              aria-label="Endpoint delay"
              onChange={(event) => setDraft({ ...draft, endpointDelayMs: Number(event.target.value) })}
            />
          </Field>
          <p className="settings-note">
            How long a pause ends your turn — lower responds sooner, higher avoids cutting you
            off mid-thought. Applies to the next utterance, no restart.
          </p>
          <Field
            label={`Merge window — ${draft.resumptionMergeMs === 0 ? 'off' : `${draft.resumptionMergeMs} ms`}`}
          >
            <input
              type="range"
              min={RESUMPTION_MERGE_MS_MIN}
              max={RESUMPTION_MERGE_MS_MAX}
              step={100}
              value={draft.resumptionMergeMs}
              aria-label="Merge window"
              onChange={(event) => setDraft({ ...draft, resumptionMergeMs: Number(event.target.value) })}
            />
          </Field>
          <p className="settings-note">
            After that pause, how long speech may resume and still join the same turn — 0 submits
            immediately. Applies to the next utterance, no restart.
          </p>
          <Field label={`Hot Listen silence — ${(draft.hotListenSilenceMs / 1000).toFixed(1)} s`}>
            <input
              type="range"
              min={HOT_LISTEN_SILENCE_MS_MIN}
              max={HOT_LISTEN_SILENCE_MS_MAX}
              step={500}
              value={draft.hotListenSilenceMs}
              aria-label="Hot Listen silence"
              onChange={(event) => setDraft({ ...draft, hotListenSilenceMs: Number(event.target.value) })}
            />
          </Field>
          <p className="settings-note">
            After the wake word, the mic stays open for the next command until this much silence
            follows the last one. Applies at once, no restart.
          </p>
          <Field label="STT model">
            <select
              value={draft.sttModel}
              aria-label="STT model"
              onChange={(event) => setDraft({ ...draft, sttModel: asSttModel(event.target.value) })}
            >
              <option value="base">Base — fastest, lowest accuracy</option>
              <option value="small">Small — default</option>
              <option value="medium">Medium — highest accuracy, ~380 MB download</option>
            </select>
          </Field>
          <p className="settings-note">
            Larger speech models trade a heavier download and decoding for accuracy — Small fits the
            4 GB hardware floor; Medium is for capable hardware. Each loads the next time the app
            starts.
          </p>
          <Field label="TTS voice">
            <select
              value={voiceKnown ? draft.ttsVoice : STALE_VOICE_VALUE}
              aria-label="TTS voice"
              onChange={(event) => setDraft({ ...draft, ttsVoice: event.target.value })}
            >
              <option value="">Default ({DEFAULT_PIPER_VOICE})</option>
              {voices.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
              {voiceKnown ? null : (
                <option value={STALE_VOICE_VALUE} disabled>
                  Previously selected voice ({draft.ttsVoice}, not installed)
                </option>
              )}
            </select>
          </Field>
        </section>

        <section className="settings-section">
          <h2>Appearance</h2>
          <Field label="Theme">
            <select
              value={draft.appearance}
              aria-label="Appearance"
              onChange={(event) => {
                setDraft({ ...draft, appearance: asAppearance(event.target.value) })
              }}
            >
              <option value="system">Match this computer</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
          <p className="settings-note">
            Applies to the app and its panels immediately; websites follow their own dark-mode support.
          </p>
        </section>

        <section className="settings-section">
          <h2>Browsing</h2>
          <Field label="Block ads, trackers and malware domains">
            <input
              type="checkbox"
              checked={draft.adblockEnabled}
              aria-label="Block ads, trackers and malware domains"
              onChange={(event) => setDraft({ ...draft, adblockEnabled: event.target.checked })}
            />
          </Field>
          <p className="settings-note">Kill switch for the built-in blocker — takes effect without a restart.</p>
          <Field label={`Web zoom — ${draft.webZoomPercent}%`}>
            <input
              type="range"
              min={WEB_ZOOM_PERCENT_MIN}
              max={WEB_ZOOM_PERCENT_MAX}
              step={5}
              value={draft.webZoomPercent}
              aria-label="Web zoom percent"
              onChange={(event) => setDraft({ ...draft, webZoomPercent: Number(event.target.value) })}
            />
          </Field>
          <p className="settings-note">
            How large webpages render in the browser pane — applied on every page load. Manual zoom resets on the next navigation.
          </p>
        </section>

        <section className="settings-section">
          <h2>Weather</h2>
          <Field label="City">
            <input
              type="text"
              value={draft.weather.city}
              placeholder="e.g. Berlin"
              aria-label="Weather city"
              onChange={(event) => setDraft({ ...draft, weather: { ...draft.weather, city: event.target.value } })}
            />
          </Field>
          <Field label="Units">
            <select
              value={draft.weather.units}
              aria-label="Weather units"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  weather: { ...draft.weather, units: event.target.value === 'imperial' ? 'imperial' : 'metric' },
                })
              }
            >
              <option value="metric">Metric (°C)</option>
              <option value="imperial">Imperial (°F)</option>
            </select>
          </Field>
        </section>

        <section className="settings-section">
          <h2>AI usage</h2>
          <Field label="Dashboard">
            <input
              type="text"
              value={draft.usageDashboard.url}
              placeholder="e.g. http://192.168.1.73:4321"
              aria-label="Usage dashboard URL"
              onChange={(event) => setDraft({ ...draft, usageDashboard: { url: event.target.value } })}
            />
          </Field>
          <p className="settings-note">
            The usage dashboard whose Codex and Claude gauges and history the idle screen shows. Leave empty to hide the card.
          </p>
        </section>

        <LearnedTermsSection />
      </div>

      <div className="settings-actions">
        <button type="button" className="settings-button" onClick={onClose}>
          Back
        </button>
        <span className="settings-status" role="status">
          {savedAt !== null && !dirty ? 'Saved — applies to the next command.' : ''}
        </span>
        <button
          type="button"
          className="settings-button settings-button--primary"
          disabled={!dirty}
          onClick={() => void submit()}
        >
          Save
        </button>
      </div>
    </section>
  )
}
