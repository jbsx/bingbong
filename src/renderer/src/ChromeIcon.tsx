import { CHEVRON, Glyph, type Part } from './WeatherIcon'

// The shell's control glyphs (#334): the Toolbar's and the Feed Panel's
// buttons draw the same Lucide line icons as the Idle Screen, in the
// button's own colour. Path data from Lucide (https://lucide.dev), ISC
// License, Copyright (c) 2022 Lucide Contributors.

const ICONS = {
  back: [{ d: 'm12 19-7-7 7-7' }, { d: 'M19 12H5' }],
  forward: [{ d: 'M5 12h14' }, { d: 'm12 5 7 7-7 7' }],
  panel: [{ d: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' }, { d: 'M15 3v18' }],
  settings: [
    {
      d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    },
    { circle: [12, 12, 3] },
  ],
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
} satisfies Record<string, Part[]>

export type ChromeIconName = keyof typeof ICONS

/** One control glyph, decorative: the button carries the accessible name. */
export function ChromeIcon({ name, size = 24 }: { name: ChromeIconName; size?: number }) {
  return <Glyph parts={ICONS[name]} size={size} className="chrome-icon" />
}
