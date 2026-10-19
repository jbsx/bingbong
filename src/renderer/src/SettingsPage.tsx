import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../core/settings/settings'
import { ENDPOINT_DELAY_MS_MAX, ENDPOINT_DELAY_MS_MIN, HOT_LISTEN_SILENCE_MS_MAX, HOT_LISTEN_SILENCE_MS_MIN, RESUMPTION_MERGE_MS_MAX, RESUMPTION_MERGE_MS_MIN, WEB_ZOOM_PERCENT_MAX, WEB_ZOOM_PERCENT_MIN, WAKE_WORD_THRESHOLD_MAX, WAKE_WORD_THRESHOLD_MIN, asAppearance, asSttModel } from '../../core/settings/settings'
import { DEFAULT_PIPER_VOICE } from '../../core/tts/piperVoices'
import { UsageMetricsSettings } from './UsageSettings'
import { IDLE_CARD_IDS, type IdleCardId } from '../../core/idle/slots'
import { defaultNewsFeeds, type NewsFeed } from '../../core/news/feeds'
import { defaultInterestProfile, type InterestProfile, type NewsTopic } from '../../core/news/interestProfile'

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

const IDLE_CARD_NAMES: Record<IdleCardId, string> = { weather: 'Weather', usage: 'AI usage', calendar: 'Calendar', lastPage: 'Last Page', music: 'Now Playing', news: 'News' }

/**
 * The Idle Screen's pinned cards (core/idle/slots): a checkbox shows a card,
 * the arrows move a shown one earlier or later in the order the screen
 * reads. The cards not shown follow, in the default order.
 */
function IdleCardsSection({ cards, onChange }: { cards: readonly IdleCardId[]; onChange: (cards: IdleCardId[]) => void }) {
  const rows = [...cards, ...IDLE_CARD_IDS.filter((id) => !cards.includes(id))]
  const move = (index: number, by: number): void => {
    const next = [...cards]
    const [id] = next.splice(index, 1)
    next.splice(index + by, 0, id)
    onChange(next)
  }
  return (
    <section className="settings-section" aria-label="idle screen cards">
      <h2>Idle screen</h2>
      {rows.map((id) => {
        const index = cards.indexOf(id)
        const shown = index >= 0
        return (
          <Field key={id} label={IDLE_CARD_NAMES[id]}>
            <span className="settings-card-row">
              <input
                type="checkbox"
                checked={shown}
                aria-label={`Show ${IDLE_CARD_NAMES[id]}`}
                onChange={(event) => onChange(event.target.checked ? [...cards, id] : cards.filter((card) => card !== id))}
              />
              <button type="button" className="settings-button" aria-label={`Move ${IDLE_CARD_NAMES[id]} earlier`} disabled={!shown || index === 0} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="settings-button"
                aria-label={`Move ${IDLE_CARD_NAMES[id]} later`}
                disabled={!shown || index === cards.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </span>
          </Field>
        )
      })}
      <p className="settings-note">
        The cards the idle screen shows, in the order they fill its columns. A card with nothing to show right now — the calendar with no events this month — yields its room to the others. Now Playing shows in the dock under the cards.
      </p>
    </section>
  )
}

function wordsText(words: readonly string[]): string {
  return words.join(', ')
}

/**
 * A comma-separated list in one text field. The text is kept as typed while
 * the field has focus and split when it loses it, so a comma being typed is
 * not swallowed.
 */
function ListInput({ items, label, placeholder, onChange }: { items: readonly string[]; label: string; placeholder?: string; onChange: (items: string[]) => void }) {
  const [text, setText] = useState(() => wordsText(items))
  useEffect(() => setText(wordsText(items)), [items])
  return (
    <input
      type="text"
      className="settings-list-input"
      value={text}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={() =>
        onChange(
          text
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        )
      }
    />
  )
}

/** One Interest Profile topic: its name, the words that match it, and the subreddits polled for it (none polls none). */
function TopicRow({ topic, onChange, onRemove }: { topic: NewsTopic; onChange: (topic: NewsTopic) => void; onRemove: () => void }) {
  return (
    <div className="settings-field settings-topic">
      <input type="text" value={topic.name} aria-label="Topic name" onChange={(event) => onChange({ ...topic, name: event.target.value })} />
      <span className="settings-card-row">
        <ListInput items={topic.words} label={`Words for ${topic.name}`} onChange={(words) => onChange({ ...topic, words })} />
        <button type="button" className="settings-button" aria-label={`Remove ${topic.name}`} onClick={onRemove}>
          Remove
        </button>
      </span>
      <span className="settings-card-row">
        <span className="settings-label">Subreddits</span>
        <ListInput items={topic.subreddits} label={`Subreddits for ${topic.name}`} placeholder="none" onChange={(subreddits) => onChange({ ...topic, subreddits })} />
      </span>
    </div>
  )
}

/** One feed the News card reads: the name the card shows and its RSS or Atom address. */
function FeedRow({ feed, onChange, onRemove }: { feed: NewsFeed; onChange: (feed: NewsFeed) => void; onRemove: () => void }) {
  return (
    <span className="settings-card-row settings-feed">
      <input type="text" value={feed.name} aria-label="Feed name" onChange={(event) => onChange({ ...feed, name: event.target.value })} />
      <input
        type="url"
        className="settings-list-input"
        value={feed.url}
        aria-label={`Address of ${feed.name}`}
        placeholder="https://…/feed.xml"
        onChange={(event) => onChange({ ...feed, url: event.target.value })}
      />
      <button type="button" className="settings-button" aria-label={`Remove ${feed.name}`} onClick={onRemove}>
        Remove
      </button>
    </span>
  )
}

/** The News card's Interest Profile (core/news/interestProfile) with each topic's subreddits, and its feeds (core/news/feeds), editable. */
function NewsSection({ news, onChange }: { news: AppSettings['news']; onChange: (news: AppSettings['news']) => void }) {
  const { topics, feeds } = news
  const setTopics = (next: InterestProfile): void => onChange({ ...news, topics: next })
  const setFeeds = (next: NewsFeed[]): void => onChange({ ...news, feeds: next })
  return (
    <section className="settings-section" aria-label="news">
      <h2>News</h2>
      {topics.map((topic, index) => (
        <TopicRow
          key={index}
          topic={topic}
          onChange={(next) => setTopics(topics.map((each, at) => (at === index ? next : each)))}
          onRemove={() => setTopics(topics.filter((_, at) => at !== index))}
        />
      ))}
      <span className="settings-card-row">
        <button type="button" className="settings-button" onClick={() => setTopics([...topics, { name: 'New topic', words: [], subreddits: [] }])}>
          Add topic
        </button>
      </span>
      <h3 className="settings-label">Feeds</h3>
      {feeds.map((feed, index) => (
        <FeedRow
          key={index}
          feed={feed}
          onChange={(next) => setFeeds(feeds.map((each, at) => (at === index ? next : each)))}
          onRemove={() => setFeeds(feeds.filter((_, at) => at !== index))}
        />
      ))}
      <span className="settings-card-row">
        <button type="button" className="settings-button" onClick={() => setFeeds([...feeds, { name: 'New feed', url: '' }])}>
          Add feed
        </button>
        <button type="button" className="settings-button" onClick={() => onChange({ topics: defaultInterestProfile(), feeds: defaultNewsFeeds() })}>
          Restore defaults
        </button>
      </span>
      <p className="settings-note">
        The Interest Profile: Today’s Highlight is the story — from Hacker News, GitHub trending, Hugging Face, a topic’s subreddits or a feed — that jumped furthest above its source’s normal day among those matching a
        topic. A story matches a topic when its title holds one of the topic’s words, or when it came from one of the topic’s subreddits. A feed counts nothing, so its posts stand at an ordinary day’s score; the same
        story on several sources counts once, higher.
      </p>
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

        <IdleCardsSection cards={draft.idleCards} onChange={(idleCards) => setDraft({ ...draft, idleCards })} />

        <NewsSection news={draft.news} onChange={(news) => setDraft({ ...draft, news })} />

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
