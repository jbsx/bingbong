import type { AppView } from '../command/appOp'

// The app's views over IPC (#420, ADR 0091): which full-window view shows
// is the dashboard's React state, so a Command that asks for one is sent
// there, and the dashboard tells main what it shows — the line the card
// carries says it.

export const APP_VIEW_IPC = {
  /** Main → dashboard: show this view, Settings at this section. */
  show: 'app-view:show',
  /** Dashboard → main: the view showing now, whoever moved it. */
  shown: 'app-view:shown',
} as const

/** A view, and for Settings the section brought to the top. */
export interface AppViewShown {
  readonly view: AppView
  readonly section?: string
}

export function isAppViewShown(value: unknown): value is AppViewShown {
  if (typeof value !== 'object' || value === null) return false
  const shown = value as Record<string, unknown>
  return (shown.view === 'dashboard' || shown.view === 'weight' || shown.view === 'settings') && (shown.section === undefined || typeof shown.section === 'string')
}
