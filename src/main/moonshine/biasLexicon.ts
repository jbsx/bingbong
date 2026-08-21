// The STT contextual-biasing lexicon (#62): the app's own vocabulary that
// Moonshine's greedy decode boosts toward (see contextualBiasing.ts). Pure
// data — extend it as mishears are discovered; no decode code changes.
// Terms the acoustic model already hears fine (everyday words) are left out
// on purpose: every entry is a near-tie waiting to be flipped.

export const BIAS_LEXICON: readonly string[] = [
  // Feed Panel states and sizing (View Preferences, ADR 0006)
  'panel',
  'feed panel',
  'dock',
  'docked',
  'dock mode',
  'overlay',
  'overlay mode',
  'collapsed',
  'wider',
  'narrower',
  'half screen',
  'panel mode',
  'panel width',

  // Navigation and app control
  'forward',
  'go forward',
  'backward',
  'reload',
  'quit',
  'restart',

  // Settings names (voice-settable surface, ADR 0006)
  'wake word',
  'wake threshold',
  'endpoint delay',
  'tool rounds',
  'web zoom',
  'zoom',
  'voice',
  'adblock',
  'ad blocker',
  'weather city',
  'celsius',
  'fahrenheit',
  'metric',
  'imperial',
  'model routing',
  'orchestrator',
  'subagent',

  // Dashboard vocabulary
  'dashboard',
  'idle screen',
  'feed entry',
]
