import { useState } from 'react'
import { nowPlayingView, thumbnailUrl, type NowPlaying } from '../../core/music/nowPlaying'
import { LoopIcon, MusicIcon } from './WeatherIcon'

type Form = 'full' | 'small'

// The card's filled glyphs, drawn in the mockup's (#365) weight.
const GLYPHS = {
  pause: <path d="M7.2 5h1.6a1.2 1.2 0 0 1 1.2 1.2v11.6a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 17.8V6.2A1.2 1.2 0 0 1 7.2 5zm8 0h1.6a1.2 1.2 0 0 1 1.2 1.2v11.6a1.2 1.2 0 0 1-1.2 1.2h-1.6a1.2 1.2 0 0 1-1.2-1.2V6.2A1.2 1.2 0 0 1 15.2 5z" />,
  play: <path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" />,
  replay: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />,
  previous: <path d="M6 5h1.4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm13 .5v13a.8.8 0 0 1-1.2.7L8.6 12.7a.8.8 0 0 1 0-1.4l9.2-6.5a.8.8 0 0 1 1.2.7z" />,
  skip: <path d="M17.6 5H19a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-1.4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM5 5.5v13a.8.8 0 0 0 1.2.7l9.2-6.5a.8.8 0 0 0 0-1.4L6.2 4.8A.8.8 0 0 0 5 5.5z" />,
  muted: <path d="M11 5 6 9H3v6h3l5 4zm11 4-6 6m0-6 6 6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />,
}

function CardGlyph({ name, size }: { name: keyof typeof GLYPHS; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  )
}

/** Three bars: the kicker's mark, moving only while the song plays (styles.css keeps it still under reduced motion). */
function Bars() {
  return (
    <svg className="idle-music-bars" width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x={1} y={6} width={3} height={10} rx={1} />
      <rect x={6.5} y={1} width={3} height={15} rx={1} />
      <rect x={12} y={4} width={3} height={12} rx={1} />
    </svg>
  )
}

/** Fires a music verb as a Command on the pointer going down, keeping the Idle Screen up: the music verbs need no pane, and useIdle never hears the press. */
function tap(verb: string) {
  const submit = (): void => {
    void window.bingbong.assistant.submit(verb)
  }
  return {
    onPointerDown: (event: React.PointerEvent) => {
      event.stopPropagation()
      submit()
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') submit()
    },
  }
}

/** The song's picture, the card's only colour; a scrim with the pause or replay glyph over it when not playing; the music glyph when there is none. The tap toggles. */
function Thumbnail({ id, cover, verb, label, form }: { id: string; cover: 'pause' | 'replay' | null; verb: string; label: string; form: Form }) {
  const [failed, setFailed] = useState(false)
  const glyph = form === 'full' ? 44 : 28
  return (
    <button type="button" className="idle-music-thumb" aria-label={label} {...tap(verb)}>
      {failed ? <MusicIcon size={glyph} /> : <img src={thumbnailUrl(id)} alt="" onError={() => setFailed(true)} />}
      {cover !== null ? (
        <span className="idle-music-cover">
          <CardGlyph name={cover} size={glyph} />
        </span>
      ) : null}
    </button>
  )
}

const TOGGLE_LABEL = { pause: 'Pause', play: 'Play', replay: 'Play again' } as const

/** Previous · play/pause/replay · skip: round buttons, the middle one raised. */
function Controls({ toggle, glyph, form }: { toggle: 'pause' | 'play'; glyph: 'pause' | 'play' | 'replay'; form: Form }) {
  const side = form === 'full' ? 22 : 20
  return (
    <span className="idle-music-controls">
      <button type="button" className="idle-music-button" aria-label="Previous" {...tap('previous')}>
        <CardGlyph name="previous" size={side} />
      </button>
      <button type="button" className="idle-music-button idle-music-button--main" aria-label={TOGGLE_LABEL[glyph]} {...tap(toggle)}>
        <CardGlyph name={glyph} size={form === 'full' ? 26 : 24} />
      </button>
      <button type="button" className="idle-music-button" aria-label="Skip" {...tap('skip')}>
        <CardGlyph name="skip" size={side} />
      </button>
    </span>
  )
}

/**
 * Now Playing (#344, #365, CONTEXT.md): the middle Column's card while the
 * Player holds a song. In full, its picture beside the kicker (NOW PLAYING
 * with three moving bars, PAUSED, ENDED, STARTING; LOOP and MUTED when on),
 * the title, the channel and what is queued next — or, ended, how to hear
 * it again — over the elapsed time, the bar, the length and the controls.
 * Small, one row: the picture, the kicker with both times, the title and
 * the bar, the controls. No accent anywhere: music is not Bing Bong
 * itself. Every control and the picture fire their music verb as a Command
 * on the pointer going down, and keep the Idle Screen up.
 */
export function NowPlayingCard({ nowPlaying, form }: { nowPlaying: NowPlaying; form: Form }) {
  const view = nowPlayingView(nowPlaying)
  const state = nowPlaying.ended ? 'ended' : nowPlaying.paused ? 'paused' : view.kicker === 'Starting' ? 'starting' : 'playing'
  const cover = nowPlaying.ended ? 'replay' : nowPlaying.paused ? 'pause' : null
  const bar = (
    <span className="idle-music-bar" aria-hidden="true">
      <span className="idle-music-fill" style={{ width: `${view.fraction * 100}%` }} />
    </span>
  )
  const head = (
    <span className="idle-music-head">
      {state === 'playing' ? <Bars /> : null}
      <span>{view.kicker}</span>
      {view.flags.map((flag) => (
        <span key={flag} className="idle-music-flag">
          {flag === 'Loop' ? <LoopIcon size={18} /> : <CardGlyph name="muted" size={18} />}
          {flag}
        </span>
      ))}
      {form === 'small' ? (
        <span className="idle-music-times">
          {view.elapsed} / {view.length}
        </span>
      ) : null}
    </span>
  )
  const thumbnail = <Thumbnail id={nowPlaying.id} cover={cover} verb={view.toggle} label={`${view.label}. ${TOGGLE_LABEL[view.glyph]}`} form={form} />
  const controls = <Controls toggle={view.toggle} glyph={view.glyph} form={form} />
  return (
    <section className={`idle-card idle-music-card idle-music-card--${form} idle-music-card--${state}`} aria-label={view.label}>
      {form === 'small' ? (
        <>
          {thumbnail}
          <span className="idle-music-info">
            {head}
            <span className="idle-music-title">{nowPlaying.title}</span>
            {bar}
          </span>
          {controls}
        </>
      ) : (
        <>
          <span className="idle-music-top">
            {thumbnail}
            <span className="idle-music-info">
              {head}
              <span className="idle-music-title">{nowPlaying.title}</span>
              {nowPlaying.channel !== '' ? <span className="idle-music-channel">{nowPlaying.channel}</span> : null}
              {view.again ? (
                <span className="idle-music-next">Say “play” or tap to hear it again</span>
              ) : view.next.length > 0 ? (
                <span className="idle-music-next">
                  <span className="idle-music-next-label">Next</span> {view.next.join(' · ')}
                </span>
              ) : null}
            </span>
          </span>
          <span className="idle-music-row">
            <span className="idle-music-time">{view.elapsed}</span>
            {bar}
            <span className="idle-music-time idle-music-time--length">{view.length}</span>
            {controls}
          </span>
        </>
      )}
    </section>
  )
}
