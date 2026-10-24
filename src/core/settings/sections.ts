// The Settings page's sections (ADR 0078), under their groups, in page
// order: the page's index draws them, and the card offers the Settings view
// at each (#420, ADR 0091) — one list, so a section added to the page is a
// place a line can open without a line of card code.

export interface SettingsSection {
  /** The section's `aria-label` on the page: what the index scrolls to and the view names. */
  readonly id: string
  readonly title: string
}

export const SETTINGS_INDEX: readonly { readonly group: string; readonly sections: readonly SettingsSection[] }[] = [
  {
    group: 'General',
    sections: [
      { id: 'voice', title: 'Voice' },
      { id: 'learned terms', title: 'Speech vocabulary' },
      { id: 'appearance', title: 'Appearance' },
      { id: 'browsing', title: 'Browsing' },
    ],
  },
  {
    group: 'Idle screen',
    sections: [
      { id: 'idle screen cards', title: 'Cards' },
      { id: 'clock', title: 'Clock' },
      { id: 'screen', title: 'Screen' },
      { id: 'weather', title: 'Weather' },
      { id: 'weight', title: 'Weight' },
      { id: 'ai usage', title: 'AI usage' },
    ],
  },
  {
    group: 'System',
    sections: [
      { id: 'environment', title: 'Environment' },
      { id: 'this computer', title: 'This computer' },
    ],
  },
]

/** Every section, in page order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_INDEX.flatMap(({ sections }) => sections)
