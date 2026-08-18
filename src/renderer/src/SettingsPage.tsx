import { useEffect, useRef, useState } from 'react'
import type { AppSettings, RoleRoutingSettings } from '../../core/settings/settings'
import type { AgentRole } from '../../core/agent/modelRouting'
import { WAKE_WORD_THRESHOLD_MAX, WAKE_WORD_THRESHOLD_MIN } from '../../core/settings/settings'
import type { UsageSummary } from '../../core/agent/spendEstimate'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'

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
  onChange,
}: {
  label: string
  value: RoleRoutingSettings
  onChange: (next: RoleRoutingSettings) => void
}) {
  return (
    <fieldset className="settings-role">
      <legend>{label}</legend>
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
              onChange={(next) =>
                setDraft({ ...draft, modelRouting: { ...draft.modelRouting, [role]: next } })
              }
            />
          ))}
        </section>

        <UsageSection />
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
