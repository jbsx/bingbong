import { CHEVRON, Glyph, type Part } from './WeatherIcon'

// The shell's control glyphs (#334): the Toolbar's and the Feed Panel's
// buttons draw the same Lucide line icons as the Idle Screen, in the
// button's own colour. Path data from Lucide (https://lucide.dev), ISC
// License, Copyright (c) 2022 Lucide Contributors.

/** Lucide's speaker: the body of the Sound Mute's two glyphs. */
const SPEAKER: Part = { d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z' }

const ICONS = {
  back: [{ d: 'm12 19-7-7 7-7' }, { d: 'M19 12H5' }],
  forward: [{ d: 'M5 12h14' }, { d: 'm12 5 7 7-7 7' }],
  home: [{ d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }, { d: 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
  panel: [{ d: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' }, { d: 'M15 3v18' }],
  settings: [
    {
      d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    },
    { circle: [12, 12, 3] },
  ],
  // Lucide's "volume-2" and "volume-x": the Sound Mute's button, sound on and muted.
  sound: [SPEAKER, { d: 'M16 9a5 5 0 0 1 0 6' }, { d: 'M19.364 18.364a9 9 0 0 0 0-12.728' }],
  muted: [SPEAKER, { d: 'M22 9l-6 6' }, { d: 'M16 9l6 6' }],
  dock: [{ d: 'M17 12H3' }, { d: 'm11 18 6-6-6-6' }, { d: 'M21 5v14' }],
  undock: [{ d: 'M3 19V5' }, { d: 'm13 6-6 6 6 6' }, { d: 'M7 12h14' }],
  collapse: CHEVRON,
  expand: [{ d: 'm15 18-6-6 6-6' }],
  tick: [{ d: 'M5 12.5l4.5 4.5L19 7.5' }],
  cross: [{ d: 'M6 6l12 12' }, { d: 'M18 6L6 18' }],
  dash: [{ d: 'M6 12h12' }],
  timer: [{ d: 'M10 2h4' }, { d: 'm12 14 3-3' }, { circle: [12, 14, 8] }],
  music: [{ d: 'M9 18V5l12-2v13' }, { circle: [6, 18, 3] }, { circle: [18, 16, 3] }],
  ended: [{ d: 'M6 6h12v12H6z' }],
  // Lucide's "list": the Feed's Details switch (#454).
  details: [{ d: 'M3 12h.01' }, { d: 'M3 18h.01' }, { d: 'M3 6h.01' }, { d: 'M8 12h13' }, { d: 'M8 18h13' }, { d: 'M8 6h13' }],
} satisfies Record<string, Part[]>

export type ChromeIconName = keyof typeof ICONS

/** One control glyph, decorative: the button carries the accessible name. */
export function ChromeIcon({ name, size = 24 }: { name: ChromeIconName; size?: number }) {
  return <Glyph parts={ICONS[name]} size={size} className="chrome-icon" />
}
