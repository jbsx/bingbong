import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../core/settings/settings'
import { PAUSE_CAP_MS_MAX, PAUSE_CAP_MS_MIN, HOT_LISTEN_SILENCE_MS_MAX, HOT_LISTEN_SILENCE_MS_MIN, RESUMPTION_MERGE_MS_MAX, RESUMPTION_MERGE_MS_MIN, WEB_ZOOM_PERCENT_MAX, WEB_ZOOM_PERCENT_MIN, WAKE_WORD_THRESHOLD_MAX, WAKE_WORD_THRESHOLD_MIN, asAppearance, asSttModel } from '../../core/settings/settings'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'
import { UsageMetricsSettings } from './UsageSettings'
import { IDLE_CARD_IDS, type IdleCardId } from '../../core/idle/slots'
import type { ScaleStatus } from '../../core/scale/ipcChannels'
import type { BodyProfile } from '../../core/scale/bodyComposition'
import { JAISH, weighInsOf, type Person } from '../../core/scale/people'
import { defaultWeightSettings, EMPTY_BODY, POPUP_LINGER_MS_MAX, POPUP_LINGER_MS_MIN, WEIGHT_CARD_RANGES, withoutPerson, type WeightSettings } from '../../core/scale/weightSettings'
import { reportRendererFault } from './diagnostics'
import { useScaleStatus, useWeighIns } from './useWeight'

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
/** The sections this viewer left open, kept across visits; storage that cannot be read keeps every one shut. */
const OPEN_SECTIONS_KEY = 'bingbong.settings.openSections'

function openSections(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OPEN_SECTIONS_KEY) ?? '[]')
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  } catch (error) {
    reportRendererFault('settings.openSections', error)
    return new Set()
  }
}

function rememberOpen(id: string, open: boolean): void {
  try {
    const ids = openSections()
    if (open) ids.add(id)
    else ids.delete(id)
    localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify([...ids]))
  } catch (error) {
    // A per-viewer convenience: without storage the section still opens, only not remembered.
    reportRendererFault('settings.rememberOpen', error)
  }
}

/**
 * One settings section that folds shut under its heading (owner ruling
 * 2026-10-19): shut, it shows its title and a line of what it holds; which
 * ones are open is remembered for the next visit.
 */
function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => openSections().has(id))
  return (
    <section className="settings-section settings-section--fold" aria-label={id}>
      <details
        open={open}
        onToggle={(event) => {
          const now = event.currentTarget.open
          setOpen(now)
          rememberOpen(id, now)
        }}
      >
        <summary className="settings-summary">
          <h2>{title}</h2>
          <span className="settings-hint">{hint}</span>
        </summary>
        <div className="settings-section-body">{children}</div>
      </details>
    </section>
  )
}

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
    <Section id="learned terms" title="Speech vocabulary" hint={terms.length === 0 ? 'Nothing learned yet' : `${terms.length} learned ${terms.length === 1 ? 'word' : 'words'}`}>
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
    </Section>
  )
}

const IDLE_CARD_NAMES: Record<IdleCardId, string> = { weather: 'Weather', usage: 'AI usage', calendar: 'Calendar', lastPage: 'Last Page', music: 'Now Playing', news: 'News', weight: 'Weight' }

/**
 * The Idle Screen's pinned cards (core/idle/slots): a checkbox shows a card,
 * the arrows move a shown one earlier or later in the order the screen
 * reads. The cards not shown follow, in the default order. Now Playing is
 * a chip in the dock, under every card: it is shown or not, never moved.
 */
function IdleCardsSection({ cards, onChange }: { cards: readonly IdleCardId[]; onChange: (cards: IdleCardId[]) => void }) {
  const docked = (id: IdleCardId): boolean => id === 'music'
  const ordered = cards.filter((id) => !docked(id))
  const rows = [...ordered, ...IDLE_CARD_IDS.filter((id) => !cards.includes(id) && !docked(id)), ...IDLE_CARD_IDS.filter(docked)]
  const move = (index: number, by: number): void => {
    const next = [...ordered]
    const [id] = next.splice(index, 1)
    next.splice(index + by, 0, id)
    onChange([...next, ...cards.filter(docked)])
  }
  const shownCount = cards.filter((id) => !docked(id)).length
  return (
    <Section id="idle screen cards" title="Cards" hint={`${shownCount} of ${IDLE_CARD_IDS.filter((id) => !docked(id)).length} shown${cards.includes('music') ? ', and Now Playing' : ''}`}>
      {rows.map((id) => {
        const index = ordered.indexOf(id)
        const shown = cards.includes(id)
        return (
          <Field key={id} label={IDLE_CARD_NAMES[id]}>
            <span className="settings-card-row">
              <input
                type="checkbox"
                checked={shown}
                aria-label={`Show ${IDLE_CARD_NAMES[id]}`}
                onChange={(event) => onChange(event.target.checked ? [...cards, id] : cards.filter((card) => card !== id))}
              />
              {docked(id) ? (
                <span className="settings-hint">in the dock, under the cards</span>
              ) : (
                <>
                  <button type="button" className="settings-button" aria-label={`Move ${IDLE_CARD_NAMES[id]} earlier`} disabled={!shown || index === 0} onClick={() => move(index, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="settings-button"
                    aria-label={`Move ${IDLE_CARD_NAMES[id]} later`}
                    disabled={!shown || index === ordered.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
            </span>
          </Field>
        )
      })}
      <p className="settings-note">
        The cards the idle screen shows, in the order they fill its columns. A card with nothing to show right now — the calendar with no events this month — yields its room to the others. Now Playing shows in the dock under the cards.
      </p>
    </Section>
  )
}

/** The Scale Listener's state in words, for the Weight section's status line. */
function scaleStatusLine(status: ScaleStatus | null): string {
  if (status === null) return 'Bluetooth: checking…'
  switch (status.state) {
    case 'searching':
      return 'Bluetooth: listening for the scale — step on it to wake it'
    case 'connected':
      return `Bluetooth: connected to the scale (${status.detail})`
    case 'unavailable':
      return status.detail
    case 'stand-in':
      return 'Bluetooth: replaced by the test stand-in scale'
  }
}

/**
 * One Person in the Weight section: their name, Body Profile and "guess
 * me", and — for anyone but Jaish — a Remove that asks first, since it
 * deletes their Weigh-ins with them, and then acts at once.
 */
function PersonFields({ person, weighIns, onChange, onRemove }: { person: Person; weighIns: number; onChange: (person: Person) => void; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const { body } = person
  const setBody = (next: Partial<BodyProfile>): void => onChange({ ...person, body: { ...body, ...next } })
  return (
    <div className="settings-person" data-person={person.id} role="group" aria-label={person.name}>
      <Field label="Name">
        <input type="text" value={person.name} aria-label="Name" onChange={(event) => onChange({ ...person, name: event.target.value })} />
      </Field>
      <Field label="Height (cm)">
        <input
          type="number"
          min={50}
          max={250}
          value={body.heightCm ?? ''}
          placeholder="e.g. 180"
          aria-label="Height in cm"
          onChange={(event) => setBody({ heightCm: event.target.value === '' ? null : Number(event.target.value) })}
        />
      </Field>
      <Field label="Date of birth">
        <input type="date" value={body.birthDate ?? ''} aria-label="Date of birth" onChange={(event) => setBody({ birthDate: event.target.value === '' ? null : event.target.value })} />
      </Field>
      <Field label="Sex">
        <select value={body.sex ?? ''} aria-label="Sex" onChange={(event) => setBody({ sex: event.target.value === 'male' || event.target.value === 'female' ? event.target.value : null })}>
          <option value="">Not set</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </Field>
      <Field label="Guess me">
        <input type="checkbox" checked={person.guess} aria-label="Guess me" onChange={(event) => onChange({ ...person, guess: event.target.checked })} />
      </Field>
      {person.id === JAISH ? null : confirming ? (
        <span className="settings-card-row settings-person-confirm" role="alertdialog" aria-label={`Remove ${person.name}?`}>
          <span>
            Remove {person.name} and {weighIns === 1 ? 'their one Weigh-in' : `their ${weighIns} Weigh-ins`}?
          </span>
          <button type="button" className="settings-button settings-person-remove-yes" onClick={onRemove}>
            Remove
          </button>
          <button type="button" className="settings-button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="settings-card-row">
          <button type="button" className="settings-button settings-person-remove" aria-label={`Remove ${person.name}`} onClick={() => setConfirming(true)}>
            Remove
          </button>
        </span>
      )}
    </div>
  )
}

/**
 * The Weight section (CONTEXT.md), replacing #350's Body section: the
 * People — each with a Body Profile and "guess me", added by name,
 * renamed, removed; the scale the Scale Listener remembered, its Forget
 * and the Bluetooth status; the Weight card's People, figures and range;
 * and the Weigh-in pop-up's on/off and linger. Forget and Remove act at
 * once (main writes both); everything else saves with the page. Kilograms
 * only.
 */
function WeightSection({
  weight,
  scale,
  onChange,
  onForget,
  onRemovePerson,
}: {
  weight: WeightSettings
  scale: AppSettings['scale']
  onChange: (weight: WeightSettings) => void
  onForget: () => void
  onRemovePerson: (person: string) => void
}) {
  const status = useScaleStatus()
  const weighIns = useWeighIns() ?? []
  const [newName, setNewName] = useState('')
  const { people, card, popup } = weight
  const setPerson = (next: Person): void => onChange({ ...weight, people: people.map((person) => (person.id === next.id ? next : person)) })
  const setCard = (next: Partial<WeightSettings['card']>): void => onChange({ ...weight, card: { ...card, ...next } })
  const add = (): void => {
    const name = newName.trim()
    if (name === '') return
    onChange({ ...weight, people: [...people, { id: `p-${Date.now().toString(36)}`, name, body: EMPTY_BODY, guess: true }] })
    setNewName('')
  }
  return (
    <Section id="weight" title="Weight" hint={`${people.map((person) => person.name).join(', ') || 'Nobody yet'} · ${scale.address === '' ? 'no scale yet' : 'scale remembered'}`}>
      <h3 className="settings-subhead">People</h3>
      {people.map((person) => (
        <PersonFields key={person.id} person={person} weighIns={weighInsOf(weighIns, people, person.id).length} onChange={setPerson} onRemove={() => onRemovePerson(person.id)} />
      ))}
      <span className="settings-card-row">
        <input type="text" value={newName} placeholder="Name" aria-label="New person’s name" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => (event.key === 'Enter' ? add() : undefined)} />
        <button type="button" className="settings-button settings-person-add" disabled={newName.trim() === ''} onClick={add}>
          Add person
        </button>
      </span>
      <p className="settings-note">
        A Weigh-in goes to whoever’s last Weigh-in is nearest — never someone with “guess me” off or with no Weigh-in yet, and Jaish when nobody fits — and a tap on the pop-up or on the Weight page moves it. The scale
        measures weight and impedance; body fat, water, muscle, bone, lean mass and BMR are worked out from them with each Person’s Body Profile. BMI needs the height; the rest need all three. Changing a Body Profile recomputes
        their every Weigh-in.
      </p>

      <h3 className="settings-subhead">Scale</h3>
      <Field label="Scale">
        <span className="settings-card-row">
          <span className="settings-scale-address">{scale.address === '' ? 'None yet — the first QN scale seen is remembered' : scale.address}</span>
          {scale.address === '' ? null : (
            <button type="button" className="settings-button" aria-label="Forget the scale" onClick={onForget}>
              Forget
            </button>
          )}
        </span>
      </Field>
      <p className={status?.state === 'unavailable' ? 'settings-role-status settings-role-status--off settings-scale-status' : 'settings-role-status settings-scale-status'} role="status">
        {scaleStatusLine(status)}
      </p>

      <h3 className="settings-subhead">Weight card</h3>
      {people.map((person) => (
        <Field key={person.id} label={`Show ${person.name}`}>
          <input
            type="checkbox"
            checked={!card.hidden.includes(person.id)}
            aria-label={`Show ${person.name} on the Weight card`}
            onChange={(event) => setCard({ hidden: event.target.checked ? card.hidden.filter((id) => id !== person.id) : [...card.hidden, person.id] })}
          />
        </Field>
      ))}
      <Field label="Change since the last Weigh-in">
        <input type="checkbox" checked={card.change} aria-label="Show the change" onChange={(event) => setCard({ change: event.target.checked })} />
      </Field>
      <Field label="Body fat">
        <input type="checkbox" checked={card.fat} aria-label="Show the body fat" onChange={(event) => setCard({ fat: event.target.checked })} />
      </Field>
      <Field label="Line">
        <input type="checkbox" checked={card.line} aria-label="Show the line" onChange={(event) => setCard({ line: event.target.checked })} />
      </Field>
      <Field label="Line’s range">
        <select value={card.rangeDays} aria-label="Line range" onChange={(event) => setCard({ rangeDays: WEIGHT_CARD_RANGES.find((days) => days === Number(event.target.value)) ?? defaultWeightSettings().card.rangeDays })}>
          {WEIGHT_CARD_RANGES.map((days) => (
            <option key={days} value={days}>
              {days} days
            </option>
          ))}
        </select>
      </Field>

      <h3 className="settings-subhead">Weigh-in pop-up</h3>
      <Field label="Show the pop-up">
        <input type="checkbox" checked={popup.on} aria-label="Show the Weigh-in pop-up" onChange={(event) => onChange({ ...weight, popup: { ...popup, on: event.target.checked } })} />
      </Field>
      <Field label={`Linger after stepping off (${String(popup.lingerMs / 1000)} s)`}>
        <input
          type="range"
          min={POPUP_LINGER_MS_MIN}
          max={POPUP_LINGER_MS_MAX}
          step={1000}
          value={popup.lingerMs}
          aria-label="Pop-up linger in ms"
          onChange={(event) => onChange({ ...weight, popup: { ...popup, lingerMs: Number(event.target.value) } })}
        />
      </Field>
      <p className="settings-note">Kilograms only.</p>
    </Section>
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

  const dirty = !sameSettings({ ...draft, scale: settings.scale }, settings)
  const micKnown = draft.micId === 'default' || mics.some((mic) => mic.deviceId === draft.micId)
  const voiceKnown = draft.ttsVoice === '' || voices.includes(draft.ttsVoice)

  const submit = async () => {
    // The remembered scale is main's to write (Forget saves at once): a draft never carries an older one back.
    await onSave({ ...draft, scale: settings.scale })
    setSavedAt(Date.now())
  }

  return (
    <section className="settings-page" aria-label="settings">
      <div className="settings-scroll">
        <h2 className="settings-group">General</h2>
        <Section id="voice" title="Voice" hint="Microphone, wake word, pauses, speech model and voice">
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
          <Field label={`Pause cap — ${(draft.pauseCapMs / 1000).toFixed(1)} s`}>
            <input
              type="range"
              min={PAUSE_CAP_MS_MIN}
              max={PAUSE_CAP_MS_MAX}
              step={100}
              value={draft.pauseCapMs}
              aria-label="Pause cap"
              onChange={(event) => setDraft({ ...draft, pauseCapMs: Number(event.target.value) })}
            />
          </Field>
          <p className="settings-note">
            The longest pause before your turn ends. A pause after a finished sentence ends it
            sooner; one mid-thought waits up to this. Applies to the next utterance, no restart.
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
        </Section>

        <LearnedTermsSection />

        <Section id="appearance" title="Appearance" hint={draft.appearance === 'system' ? 'Matches this computer' : draft.appearance === 'light' ? 'Light' : 'Dark'}>
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
        </Section>

        <Section id="browsing" title="Browsing" hint={`Ad blocking ${draft.adblockEnabled ? 'on' : 'off'} · web zoom ${draft.webZoomPercent}%`}>
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
        </Section>

        <h2 className="settings-group">Idle screen</h2>
        <IdleCardsSection cards={draft.idleCards} onChange={(idleCards) => setDraft({ ...draft, idleCards })} />

        <Section id="weather" title="Weather" hint={draft.weather.city.trim() === '' ? 'No city set' : `${draft.weather.city.trim()} · ${draft.weather.units === 'imperial' ? '°F' : '°C'}`}>
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
        </Section>

        <WeightSection
          weight={draft.weight}
          scale={settings.scale}
          onChange={(weight) => setDraft({ ...draft, weight })}
          onForget={() => void onSave({ ...settings, scale: { address: '' } })}
          onRemovePerson={(person) => {
            // Main removes them from the saved settings with their Weigh-ins; the draft drops them too, keeping any other edit.
            setDraft({ ...draft, weight: withoutPerson(draft.weight, person) })
            window.bingbong.weight.removePerson(person).catch((error: unknown) => reportRendererFault('weight.removePerson', error))
          }}
        />

        <Section id="ai usage" title="AI usage" hint={draft.usageDashboard.url.trim() === '' ? 'No dashboard — the card is hidden' : draft.usageDashboard.url.trim()}>
          <Field label="Dashboard">
            <input
              type="text"
              value={draft.usageDashboard.url}
              placeholder="e.g. http://192.168.1.73:4321"
              aria-label="Usage dashboard URL"
              onChange={(event) => setDraft({ ...draft, usageDashboard: { ...draft.usageDashboard, url: event.target.value } })}
            />
          </Field>
          <p className="settings-note">
            The usage dashboard whose gauges and history the idle screen shows. Leave empty to hide the card; save a new address to list its metrics.
          </p>
          <UsageMetricsSettings
            savedUrl={settings.usageDashboard.url}
            value={draft.usageDashboard}
            onChange={(prefs) => setDraft({ ...draft, usageDashboard: { ...draft.usageDashboard, ...prefs } })}
          />
        </Section>

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
