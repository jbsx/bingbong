import { Fragment, useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../core/settings/settings'
import { isEnvKey, isSecretKey, type EnvFileView } from '../../core/settings/envEntries'
import type { HostFinding } from '../../core/settings/hostFindings'
import { PAUSE_CAP_MS_MAX, PAUSE_CAP_MS_MIN, HOT_LISTEN_SILENCE_MS_MAX, HOT_LISTEN_SILENCE_MS_MIN, RESUMPTION_MERGE_MS_MAX, RESUMPTION_MERGE_MS_MIN, WEB_ZOOM_PERCENT_MAX, WEB_ZOOM_PERCENT_MIN, WAKE_WORD_THRESHOLD_MAX, WAKE_WORD_THRESHOLD_MIN, asAppearance, asSttModel, IDLE_AFTER_MINUTES } from '../../core/settings/settings'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'
import { UsageMetricsSettings } from './UsageSettings'
import { IDLE_CARD_IDS, sanitizeIdleCards, type IdleCardId } from '../../core/idle/columns'
import { asDateFormat, asTimeFormat, dateOptions, timeOfDay } from '../../core/idle/timeFormat'
import { NIGHT_BRIGHTNESS_MAX, NIGHT_BRIGHTNESS_MIN, type NightDimMonitor } from '../../core/idle/nightDim'
import type { MonitorList } from '../../core/idle/monitorDim'
import { asWeekStart } from '../../core/calendar/month'
import { DEFAULT_IDLE_TIMEOUT_MS } from '../../core/app/launchConfig'
import { dateLabel } from './dateLabel'
import type { ScaleStatus } from '../../core/scale/ipcChannels'
import type { BodyProfile } from '../../core/scale/bodyComposition'
import { JAISH, weighInsOf, type Person } from '../../core/scale/people'
import { defaultWeightSettings, EMPTY_BODY, POPUP_LINGER_MS_MAX, POPUP_LINGER_MS_MIN, WEIGHT_CARD_RANGES, withoutPerson, type WeightSettings } from '../../core/scale/weightSettings'
import { reportRendererFault } from './diagnostics'
import { WeatherCityPicker } from './WeatherCityPicker'
import { markedSection } from './settingsIndexMark'
import { SETTINGS_INDEX } from '../../core/settings/sections'
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

function sectionElement(scroll: HTMLElement | null, id: string): HTMLElement | null {
  return scroll?.querySelector<HTMLElement>(`section[aria-label="${id}"]`) ?? null
}

/** A section opened under its heading and brought to the top: the index's click, and a Command that asks for it (#420). */
function revealSection(scroll: HTMLElement | null, id: string): void {
  const element = sectionElement(scroll, id)
  const details = element?.querySelector('details')
  if (details && !details.open) details.open = true
  element?.scrollIntoView({ block: 'start' })
}

/** The keys that scroll the page by hand, ending a click's hold on the index. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/**
 * The Settings index: a click opens its section and brings it to the top,
 * and that section stays marked until the page is scrolled by hand (the last
 * sections cannot reach the top, so the scroll that follows a click would
 * otherwise mark the one above); scrolled by hand, the section at the top is
 * marked, the last one once the scroll is at its end.
 */
function SettingsIndex({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const [current, setCurrent] = useState(SETTINGS_INDEX[0]!.sections[0]!.id)
  const chosen = useRef(false)

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const follow = (): void => {
      if (chosen.current) return
      const edge = scroll.getBoundingClientRect().top
      const tops = SETTINGS_INDEX.flatMap(({ sections }) =>
        sections.flatMap(({ id }) => {
          const element = sectionElement(scroll, id)
          return element ? [{ id, top: element.getBoundingClientRect().top - edge }] : []
        }),
      )
      const at = markedSection(tops, scroll)
      if (at !== undefined) setCurrent(at)
    }
    const byHand = (): void => {
      chosen.current = false
    }
    const byKey = (event: KeyboardEvent): void => {
      if (SCROLL_KEYS.has(event.key)) byHand()
    }
    scroll.addEventListener('scroll', follow, { passive: true })
    scroll.addEventListener('wheel', byHand, { passive: true })
    scroll.addEventListener('touchmove', byHand, { passive: true })
    scroll.addEventListener('pointerdown', byHand)
    scroll.addEventListener('keydown', byKey)
    return () => {
      scroll.removeEventListener('scroll', follow)
      scroll.removeEventListener('wheel', byHand)
      scroll.removeEventListener('touchmove', byHand)
      scroll.removeEventListener('pointerdown', byHand)
      scroll.removeEventListener('keydown', byKey)
    }
  }, [scrollRef])

  let number = 0
  return (
    <nav className="settings-index" aria-label="Settings sections">
      <h1>Settings</h1>
      {SETTINGS_INDEX.map(({ group, sections }) => (
        <Fragment key={group}>
          <p className="settings-index-group">{group}</p>
          {sections.map(({ id, title }) => {
            const shown = String(number++).padStart(2, '0')
            return (
              <button
                key={id}
                type="button"
                className="settings-index-link"
                aria-current={current === id ? 'true' : undefined}
                onClick={() => {
                  chosen.current = true
                  revealSection(scrollRef.current, id)
                  setCurrent(id)
                }}
              >
                <span className="settings-index-number">{shown}</span>
                {title}
              </button>
            )
          })}
        </Fragment>
      ))}
    </nav>
  )
}

/**
 * One settings section that folds shut under its heading (owner ruling
 * 2026-10-19): shut, it shows its title and a line of what it holds; which
 * ones are open is remembered for the next visit.
 */
function Section({ id, title, hint, children }: { id: string; title: string; hint: React.ReactNode; children: React.ReactNode }) {
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

/**
 * The `.env` (#76): every key the file sets, each one changed or removed on
 * the spot — written straight to the file, comments kept, as Speech
 * vocabulary acts without the page's Save. A secret shows only its last four
 * characters; typing replaces it whole.
 */
function EnvironmentSection() {
  const [file, setFile] = useState<EnvFileView | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    window.bingbong.settings
      .envFile()
      .then((view) => {
        if (!cancelled) setFile(view)
      })
      .catch((cause: unknown) => reportRendererFault('settings.envFile', cause))
    return () => {
      cancelled = true
    }
  }, [])

  const set = async (key: string, value: string | null): Promise<boolean> => {
    try {
      setFile(await window.bingbong.settings.setEnv(key, value))
      setDrafts(({ [key]: _written, ...rest }) => rest)
      setError('')
      return true
    } catch (cause) {
      reportRendererFault('settings.setEnv', cause)
      setError(`Could not write ${key} to the file.`)
      return false
    }
  }

  const add = async () => {
    const key = newKey.trim()
    if (!isEnvKey(key)) {
      setError('A name is letters, digits and underscores, not starting with a digit.')
      return
    }
    if (await set(key, newValue)) {
      setNewKey('')
      setNewValue('')
    }
  }

  const open = async () => {
    const failure = await window.bingbong.settings.openEnvFile().catch((cause: unknown) => String(cause))
    setError(failure === '' ? '' : `Could not open the file: ${failure}`)
    if (failure === '') setFile(await window.bingbong.settings.envFile())
  }

  const entries = file?.entries ?? []
  return (
    <Section id="environment" title="Environment" hint={file === null ? 'Reading the .env…' : !file.exists ? 'No .env yet' : `${entries.length} ${entries.length === 1 ? 'key' : 'keys'} in ${file.path}`}>
      <p className="settings-note">
        The keys and routing in the app&apos;s <code>.env</code>. A change is written to the file at once, its comments kept. The decision model and the news writer read it from the next command; voice, wake word and speech read it at the next start.
      </p>
      <span className="settings-card-row settings-env-open">
        <button type="button" className="settings-button" onClick={() => void open()}>
          Open in editor
        </button>
      </span>
      {entries.map((entry) => {
        const draft = drafts[entry.key]
        const changed = draft !== undefined && draft !== (entry.secret ? '' : entry.value)
        return (
          <Fragment key={entry.key}>
            <Field label={entry.key}>
              <span className="settings-env-row">
                <input
                  type={entry.secret ? 'password' : 'text'}
                  value={draft ?? (entry.secret ? '' : entry.value)}
                  placeholder={entry.secret ? (entry.value === '' ? 'hidden' : `hidden · …${entry.value}`) : '(empty)'}
                  aria-label={entry.key}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setDrafts({ ...drafts, [entry.key]: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && changed) void set(entry.key, draft)
                  }}
                />
                {changed ? (
                  <button type="button" className="settings-button settings-button--primary" onClick={() => void set(entry.key, draft)}>
                    Save
                  </button>
                ) : null}
                <button type="button" className="settings-term-remove" aria-label={`Remove ${entry.key}`} onClick={() => void set(entry.key, null)}>
                  Remove
                </button>
              </span>
            </Field>
            {entry.shadowed ? <p className="settings-note settings-env-shadowed">The app was started with {entry.key} set in its environment, which wins over this file.</p> : null}
          </Fragment>
        )
      })}
      <Field label="Add a key">
        <span className="settings-env-row">
          <input
            type="text"
            className="settings-env-key"
            value={newKey}
            placeholder="NAME"
            aria-label="New key name"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setNewKey(event.target.value)}
          />
          <input
            type={isSecretKey(newKey.trim()) ? 'password' : 'text'}
            value={newValue}
            placeholder="value"
            aria-label="New key value"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setNewValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add()
            }}
          />
          <button type="button" className="settings-button" disabled={newKey.trim() === ''} onClick={() => void add()}>
            Add
          </button>
        </span>
      </Field>
      {error === '' ? null : (
        <p className="settings-role-status settings-role-status--off" role="alert">
          {error}
        </p>
      )}
    </Section>
  )
}

const IDLE_CARD_NAMES: Record<IdleCardId, string> = { weather: 'Weather', usage: 'AI usage', calendar: 'Calendar', lastPage: 'Last Page', music: 'Now Playing', news: 'Top Repos', weight: 'Weight' }

/** Where each card lives on the Idle Screen, as the Cards section names it. */
const IDLE_CARD_HOMES: Record<IdleCardId, string> = {
  weather: 'down the left',
  calendar: 'top right',
  lastPage: 'a line under the clock',
  weight: 'right, under the Calendar',
  usage: 'middle, under the clock',
  news: 'bottom right',
  music: 'middle, over the AI usage',
}

/**
 * What the app needs from the machine and cannot ship (#419): aplay, a
 * microphone, a display — checked once at boot, each one missing a line
 * here and in the fault log.
 */
function HostSection() {
  const [findings, setFindings] = useState<readonly HostFinding[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.bingbong.settings
      .hostChecks()
      .then((found) => {
        if (!cancelled) setFindings(found)
      })
      .catch((cause: unknown) => reportRendererFault('settings.hostChecks', cause))
    return () => {
      cancelled = true
    }
  }, [])

  const hint = findings === null ? 'Checking…' : findings.length === 0 ? 'Sound out, microphone and display all found' : `${findings.length} missing`
  return (
    <Section id="this computer" title="This computer" hint={hint}>
      {findings !== null && findings.length === 0 ? (
        <p className="settings-note">At start the app found aplay to speak through, a microphone and a display.</p>
      ) : null}
      {(findings ?? []).map((finding) => (
        <p key={finding.check} className="settings-note settings-host-missing">
          {finding.message}
        </p>
      ))}
      <p className="settings-note">Checked once when the app starts; restart it after plugging something in.</p>
    </Section>
  )
}

/**
 * The Idle Screen's Pinned Cards (core/idle/columns): a checkbox shows a
 * card or hides it. Every card has its home in a Column, so there is no
 * order to choose; a hidden card's Column-mates take its room.
 */
function IdleCardsSection({ cards, onChange }: { cards: readonly IdleCardId[]; onChange: (cards: IdleCardId[]) => void }) {
  return (
    <Section id="idle screen cards" title="Cards" hint={`${cards.length} of ${IDLE_CARD_IDS.length} shown`}>
      {IDLE_CARD_IDS.map((id) => (
        <Field key={id} label={IDLE_CARD_NAMES[id]}>
          <span className="settings-card-row">
            <input
              type="checkbox"
              checked={cards.includes(id)}
              aria-label={`Show ${IDLE_CARD_NAMES[id]}`}
              onChange={(event) => onChange(sanitizeIdleCards(event.target.checked ? [...cards, id] : cards.filter((card) => card !== id)))}
            />
            <span className="settings-hint">{IDLE_CARD_HOMES[id]}</span>
          </span>
        </Field>
      ))}
      <p className="settings-note">
        The cards the idle screen shows. Each has its own place in one of the three columns; hide one and the cards beside it in its column take its room. The Last Page is a line under the clock.
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
    <Section id="weight" title="Weight" hint={
        <>
          {/* Each Person in their own colour, as the Weight card and page draw them (ADR 0078). */}
          {people.length === 0
            ? 'Nobody yet'
            : people.map((person, index) => (
                <Fragment key={person.id}>
                  {index > 0 ? ', ' : ''}
                  <span className="settings-hint-person" data-person={person.id}>
                    {person.name}
                  </span>
                </Fragment>
              ))}
          {` · ${scale.address === '' ? 'no scale yet' : 'scale remembered'}`}
          {/* The whole section's unit, said at its heading rather than under the last control. */}
          {' · kilograms only'}
        </>
      }>
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
    </Section>
  )
}

/** The AI usage heading's line: the providers the card shows, in words, as every other heading speaks (2026-10-22 audit); the address stays in its field. */
function usageHint(providers: readonly string[]): string {
  if (providers.length === 0) return 'No providers shown'
  const named = providers.length === 1 ? providers[0]! : `${providers.slice(0, -1).join(', ')} and ${providers.at(-1)!}`
  return `${named} shown`
}

/** The launch config's idle timeout in minutes — BINGBONG_IDLE_TIMEOUT_MS or 5 — which a timeout of 0 keeps; 5 where the page renders without the preload. */
function launchIdleMinutes(): number {
  const ms = typeof window === 'undefined' ? DEFAULT_IDLE_TIMEOUT_MS : window.bingbong.app.idleTimeoutMs
  return Math.round(ms / 60_000)
}

const monitorKey = (monitor: NightDimMonitor): string => `${monitor.model} · ${monitor.connector}`

/**
 * Which monitor Night Dim turns down over DDC/CI (#413), or the veil only:
 * the monitors ddcutil finds, listed again each time Settings opens, by
 * model and connector — never by bus, which renumbers.
 */
function NightDimMonitorField({ value, onChange }: { value: NightDimMonitor | null; onChange: (monitor: NightDimMonitor | null) => void }) {
  const [found, setFound] = useState<MonitorList | null>(null)

  useEffect(() => {
    let cancelled = false
    window.bingbong.settings
      .monitors()
      .then((list) => {
        if (!cancelled) setFound(list)
      })
      .catch((cause: unknown) => reportRendererFault('settings.monitors', cause))
    return () => {
      cancelled = true
    }
  }, [])

  const monitors = found?.monitors ?? []
  const missing = value !== null && found !== null && !monitors.some((monitor) => monitorKey(monitor) === monitorKey(value))
  const note = found === null ? 'Looking for monitors…' : missing ? `${monitorKey(value)} not found — the veil dims instead${found.note === '' ? '' : `. ${found.note}`}` : found.note
  return (
    <>
      <Field label="Monitor">
        <select
          value={value === null ? '' : monitorKey(value)}
          aria-label="Night Dim monitor"
          onChange={(event) => {
            const picked = [...monitors, ...(value === null ? [] : [value])].find((monitor) => monitorKey(monitor) === event.target.value)
            onChange(picked === undefined ? null : { model: picked.model, connector: picked.connector })
          }}
        >
          <option value="">Veil only</option>
          {monitors.map((monitor) => (
            <option key={monitorKey(monitor)} value={monitorKey(monitor)}>
              {monitorKey(monitor)}
            </option>
          ))}
          {missing ? <option value={monitorKey(value)}>{monitorKey(value)} (not found)</option> : null}
        </select>
      </Field>
      <p className="settings-note night-dim-monitor-note">
        {value === null ? 'A black veil darkens the picture; picking a monitor turns its own brightness down instead, which is darker and saves power.' : 'Its own brightness goes down at night and back up when you wake it; the veil only if it cannot.'}
        {note === '' ? null : ` ${note}`}
      </p>
    </>
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
  section,
}: {
  settings: AppSettings
  onSave: (next: AppSettings) => Promise<void>
  onClose: () => void
  /** The section a Command asked for (#420): opened and brought to the top, as the index's click does. */
  section?: { id: string; at: number } | null
}) {
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const mics = useMicrophones()
  const voices = useTtsVoices()
  const lastSynced = useRef<AppSettings>(settings)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (section) revealSection(scrollRef.current, section.id)
  }, [section])

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
    <section className="settings-page settings-page--indexed" aria-label="settings">
      <SettingsIndex scrollRef={scrollRef} />
      <div className="settings-scroll" ref={scrollRef}>
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
              value={draft.sttEngine}
              aria-label="STT model"
              onChange={(event) => setDraft({ ...draft, sttEngine: asSttModel(event.target.value) })}
            >
              <option value="parakeet">Parakeet — default, most accurate, ~660 MB download</option>
              <option value="medium">Moonshine Medium — lighter, ~380 MB download</option>
              <option value="small">Moonshine Small — lighter, fits the 4 GB hardware floor</option>
              <option value="base">Moonshine Base — lightest, lowest accuracy</option>
            </select>
          </Field>
          <p className="settings-note">
            Parakeet hears best. The Moonshine models are lighter, for a machine too slow for it.
            Each loads the next time the app starts.
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
          <Field label="Upload folder">
            <input
              type="text"
              value={draft.shelfFolder}
              placeholder="None — the downloads alone"
              aria-label="Upload folder"
              onChange={(event) => setDraft({ ...draft, shelfFolder: event.target.value })}
            />
            <button
              type="button"
              onClick={() => {
                void window.bingbong.settings
                  .pickFolder()
                  .then((folder) => {
                    if (folder !== '') setDraft((now) => ({ ...now, shelfFolder: folder }))
                  })
                  .catch(() => {})
              }}
            >
              Choose…
            </button>
          </Field>
          <p className="settings-note">
            An upload by voice offers the files in bingbong_downloads and in this folder, never its folders below. Their names go to the decision model.
          </p>
        </Section>

        <h2 className="settings-group">Idle screen</h2>
        <IdleCardsSection cards={draft.idleCards} onChange={(idleCards) => setDraft({ ...draft, idleCards })} />

        <Section id="clock" title="Clock" hint={`${draft.timeFormat === 'system' ? 'Matches this computer' : `${draft.timeFormat}-hour`} · ${timeOfDay(Date.now(), draft.timeFormat)}`}>
          <Field label="Time format">
            <select
              value={draft.timeFormat}
              aria-label="Time format"
              onChange={(event) => setDraft({ ...draft, timeFormat: asTimeFormat(event.target.value) })}
            >
              <option value="system">Match this computer</option>
              <option value="12">12-hour (9:05 pm)</option>
              <option value="24">24-hour (21:05)</option>
            </select>
          </Field>
          <p className="settings-note">Every time on the idle screen and the Weight page: the clock, the Timer, the calendar, the weather's hours.</p>
          <Field label="Show seconds">
            <input type="checkbox" checked={draft.clockSeconds} aria-label="Show seconds" onChange={(event) => setDraft({ ...draft, clockSeconds: event.target.checked })} />
          </Field>
          <Field label="Date">
            <select value={draft.dateFormat} aria-label="Date format" onChange={(event) => setDraft({ ...draft, dateFormat: asDateFormat(event.target.value) })}>
              {(['long', 'long-year', 'short', 'numeric'] as const).map((format) => (
                <option key={format} value={format}>
                  {dateLabel(Date.now(), dateOptions(format))}
                </option>
              ))}
            </select>
          </Field>
          <Field label="First day of the week">
            <select value={draft.weekStart} aria-label="First day of the week" onChange={(event) => setDraft({ ...draft, weekStart: asWeekStart(event.target.value) })}>
              <option value="system">Match this computer</option>
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
              <option value="saturday">Saturday</option>
            </select>
          </Field>
        </Section>

        <Section
          id="screen"
          title="Screen"
          hint={`On after ${draft.idleAfterMinutes === 0 ? 'the default' : `${draft.idleAfterMinutes} min`} · ${draft.nightDim.enabled ? `dims ${draft.nightDim.from}–${draft.nightDim.to}` : 'no night dimming'}`}
        >
          <Field label="Comes on after">
            <select
              value={draft.idleAfterMinutes}
              aria-label="Idle screen after"
              onChange={(event) => setDraft({ ...draft, idleAfterMinutes: Number(event.target.value) })}
            >
              {IDLE_AFTER_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? `Default (${launchIdleMinutes()} min)` : minutes === 1 ? '1 minute' : `${minutes} minutes`}
                </option>
              ))}
            </select>
          </Field>
          <p className="settings-note">How long the dashboard waits without a tap, a key or a command before the idle screen comes on. Holds from the next activity.</p>
          <Field label="Dim at night">
            <input
              type="checkbox"
              checked={draft.nightDim.enabled}
              aria-label="Dim at night"
              onChange={(event) => setDraft({ ...draft, nightDim: { ...draft.nightDim, enabled: event.target.checked } })}
            />
          </Field>
          {draft.nightDim.enabled ? (
            <>
              <Field label="From">
                <input
                  type="time"
                  value={draft.nightDim.from}
                  aria-label="Dim from"
                  onChange={(event) => event.target.value !== '' && setDraft({ ...draft, nightDim: { ...draft.nightDim, from: event.target.value } })}
                />
              </Field>
              <Field label="Until">
                <input
                  type="time"
                  value={draft.nightDim.to}
                  aria-label="Dim until"
                  onChange={(event) => event.target.value !== '' && setDraft({ ...draft, nightDim: { ...draft.nightDim, to: event.target.value } })}
                />
              </Field>
              <Field label={`Brightness — ${draft.nightDim.brightnessPercent}%`}>
                <input
                  type="range"
                  min={NIGHT_BRIGHTNESS_MIN}
                  max={NIGHT_BRIGHTNESS_MAX}
                  step={5}
                  value={draft.nightDim.brightnessPercent}
                  aria-label="Night brightness"
                  onChange={(event) => setDraft({ ...draft, nightDim: { ...draft.nightDim, brightnessPercent: Number(event.target.value) } })}
                />
              </Field>
              <NightDimMonitorField value={draft.nightDim.monitor} onChange={(monitor) => setDraft({ ...draft, nightDim: { ...draft.nightDim, monitor } })} />
              <p className="settings-note">The idle screen only; the dashboard stays at full brightness while you use it.</p>
            </>
          ) : null}
        </Section>

        <Section id="weather" title="Weather" hint={draft.weather.city.trim() === '' ? `Detected · ${draft.weather.units === 'imperial' ? '°F' : '°C'}` : `${draft.weather.city.trim()} · ${draft.weather.units === 'imperial' ? '°F' : '°C'}`}>
          <Field label="City">
            <WeatherCityPicker
              value={draft.weather}
              onPick={({ city, ...coordinates }) => setDraft({ ...draft, weather: { city, units: draft.weather.units, ...coordinates } })}
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

        <Section id="ai usage" title="AI usage" hint={draft.usageDashboard.url.trim() === '' ? 'No dashboard — the card is hidden' : usageHint(draft.usageDashboard.providers)}>
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

        <h2 className="settings-group">System</h2>
        <EnvironmentSection />
        <HostSection />
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
