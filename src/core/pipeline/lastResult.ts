import type { PipelineEvent } from './events'

// The Status Capsule's last result (#436): the sentence the last Command
// said aloud, kept on screen until the next input, because speech cannot
// be scrolled back by ear (docs/agents/ui.md, principle 5). A page read is
// spoken in parts and is kept at its first, the words it began with; a
// Task's later hop that speaks under its own turn replaces it, so a Task
// ends on its closing sentence. The next Command — any hop 0, a dropped
// Utterance too — is the next input and clears it.

export interface LastResultTracker {
  onEvent(event: PipelineEvent): void
  /** The sentence to keep on screen, or null when the last input has said nothing yet. */
  current(): string | null
}

export function createLastResultTracker(): LastResultTracker {
  let text: string | null = null
  let turn: string | null = null
  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          if ((event.task?.hop ?? 0) === 0) {
            text = null
            turn = null
          }
          return
        case 'speak':
          if (text !== null && event.turnId === turn) return
          text = event.text
          turn = event.turnId ?? null
          return
        case 'site_question':
          text = event.text
          turn = null
          return
        default:
          return
      }
    },
    current: () => text,
  }
}
