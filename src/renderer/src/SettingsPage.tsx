import { useEffect, useRef, useState } from 'react'
import type { AppSettings, RoleRoutingSettings } from '../../core/settings/settings'
import type { AgentRole } from '../../core/agent/modelRouting'
import { ENDPOINT_DELAY_MS_MAX, ENDPOINT_DELAY_MS_MIN, MAX_TOOL_ROUNDS_MAX, MAX_TOOL_ROUNDS_MIN, RESUMPTION_MERGE_MS_MAX, RESUMPTION_MERGE_MS_MIN, WEB_ZOOM_PERCENT_MAX, WEB_ZOOM_PERCENT_MIN, WAKE_WORD_THRESHOLD_MAX, WAKE_WORD_THRESHOLD_MIN, asAppearance, asSttModel } from '../../core/settings/settings'
import type { UsageSummary } from '../../core/agent/spendEstimate'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'
import { useRoutingStatus } from './useSettings'

const ROLES: { role: AgentRole; label: string }[] = [
  { role: 'orchestrator', label: 'Orchestrator' },
  { role: 'subagent', label: 'Subagent' },
  { role: 'vision', label: 'Vision' },
]

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

function useTodayUsage(): UsageSummary | null {
  const [usage, setUsage] = useState<UsageSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    // Refreshed on open and every minute — the estimate grows while agents run.
    const load = () => {
      void window.bingbong.usage
        .getToday()
        .then((summary) => {
          if (!cancelled) setUsage(summary)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return usage
}

function UsageSection() {
  const usage = useTodayUsage()
  if (!usage) return null

  const roles = (['orchestrator', 'subagent', 'vision'] as const).filter((role) => usage.byRole[role])
  return (
    <section className="settings-section" aria-label="usage">
      <h2>Usage today</h2>
      <p className={`settings-usage${usage.overWarn ? ' settings-usage--warn' : ''}`} role="status">
        Estimated spend: ${usage.estimateUsd.toFixed(2)} across {usage.requests} model request
        {usage.requests === 1 ? '' : 's'} — warn-only, never blocking.
        {usage.overWarn ? ` Above your $${usage.warnUsd} daily estimate.` : ''}
      </p>
      {roles.length > 0 ? (
        <p className="settings-usage-detail">
          {roles
            .map((role) => {
              const entry = usage.byRole[role]!
              return `${role}: ${entry.requests} requests`
            })
            .join(' · ')}
        </p>
      ) : null}
    </section>
  )
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

function RoleRoutingFields({
  label,
  value,
  configured,
  onChange,
}: {
  label: string
  value: RoleRoutingSettings
  /** Null while the routing status loads; the main process resolves it (#76). */
  configured: boolean | null
  onChange: (next: RoleRoutingSettings) => void
}) {
  return (
    <fieldset className="settings-role">
      <legend>{label}</legend>
      {configured === null ? null : (
        <p className={`settings-role-status${configured ? '' : ' settings-role-status--off'}`}>
          {configured
            ? 'Configured — this role resolves and will serve requests.'
            : 'Not configured — set a base URL, model and API key here, or in .env / the environment.'}
        </p>
      )}
      <Field label="Base URL">
        <input
          type="text"
          value={value.baseUrl}
          placeholder="https://…/v1"
          spellCheck={false}
          onChange={(event) => onChange({ ...value, baseUrl: event.target.value })}
        />
      </Field>
      <Field label="Model">
        <input
          type="text"
          value={value.model}
          placeholder="model id"
          spellCheck={false}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
        />
      </Field>
      <Field label="API key override">
        <input
          type="password"
          value={value.apiKey}
          placeholder="falls back to the provider key"
          autoComplete="off"
          onChange={(event) => onChange({ ...value, apiKey: event.target.value })}
        />
      </Field>
    </fieldset>
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
  const routingStatus = useRoutingStatus()
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
          <h2>API keys</h2>
          <Field label="Z.AI API key">
            <input
              type="password"
              value={draft.apiKeys.zai ?? ''}
              autoComplete="off"
              aria-label="Z.AI API key"
              onChange={(event) =>
                setDraft({ ...draft, apiKeys: { ...draft.apiKeys, zai: event.target.value } })
              }
            />
          </Field>
          <Field label="DeepSeek API key">
            <input
              type="password"
              value={draft.apiKeys.deepseek ?? ''}
              autoComplete="off"
              aria-label="DeepSeek API key"
              onChange={(event) =>
                setDraft({ ...draft, apiKeys: { ...draft.apiKeys, deepseek: event.target.value } })
              }
            />
          </Field>
        </section>

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
          <h2>Agent</h2>
          <Field label={`Max tool rounds — ${draft.maxToolRounds}`}>
            <input
              type="range"
              min={MAX_TOOL_ROUNDS_MIN}
              max={MAX_TOOL_ROUNDS_MAX}
              step={10}
              value={draft.maxToolRounds}
              aria-label="Max tool rounds"
              onChange={(event) => setDraft({ ...draft, maxToolRounds: Number(event.target.value) })}
            />
          </Field>
          <p className="settings-note">
            How many tool rounds the assistant may chain per command — raise this if long browsing
            tasks hit the round limit. Applies to the next command, no restart.
          </p>
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
            How large webpages render in the browser pane and subagent tabs — applied on every page
            load. Manual zoom resets on the next navigation.
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
          <h2>Model routing</h2>
          {ROLES.map(({ role, label }) => (
            <RoleRoutingFields
              key={role}
              label={label}
              value={draft.modelRouting[role]}
              configured={routingStatus ? routingStatus[role] : null}
              onChange={(next) =>
                setDraft({ ...draft, modelRouting: { ...draft.modelRouting, [role]: next } })
              }
            />
          ))}
        </section>

        <UsageSection />

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
