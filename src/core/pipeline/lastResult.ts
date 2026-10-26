import type { PipelineEvent } from './events'

// The Status Capsule's last result (#436): the sentence the last Command
// said aloud, kept on screen until the next input, because speech cannot
// be scrolled back by ear (docs/agents/ui.md, principle 5). A page read is
// spoken in parts and is kept at its first, the words it began with; a
// Task's later hop that speaks under its own turn replaces it, so a Task
// ends on its closing sentence. The next Command — any hop 0, a dropped
// Utterance too — is the next input and clears it.
//
// The Idle Screen's Voice Prompt line keeps only a failure (#470): that
// sentence when it told one, or "No response." for a line read as no
// Command, whose Answer is shown and never said.

export interface LastResultTracker {
  onEvent(event: PipelineEvent): void
  /** The sentence to keep on screen, or null when the last input has said nothing yet. */
  current(): string | null
  /** The kept sentence when it told a failure, or "No response." for a line read as no Command; else null. */
  failure(): string | null
}

export function createLastResultTracker(): LastResultTracker {
  let text: string | null = null
  let turn: string | null = null
  let failed = false
  // The hop 0 read as no Command, and its Answer's first line once shown.
  let droppedTurn: string | null = null
  let noResponse: string | null = null
  return {
    onEvent(event) {
      switch (event.type) {
        case 'command':
          if ((event.task?.hop ?? 0) === 0) {
            text = null
            turn = null
            failed = false
            droppedTurn = event.dropped === true ? event.turnId : null
            noResponse = null
          }
          return
        case 'speak':
          if (text !== null && event.turnId === turn) return
          text = event.text
          turn = event.turnId ?? null
          failed = event.failure === true
          return
        case 'display':
          if (droppedTurn !== null && event.turnId === droppedTurn && event.muted === true) noResponse = event.text.split('\n', 1)[0]!
          return
        case 'site_question':
          text = event.text
          turn = null
          failed = false
          return
        default:
          return
      }
    },
    current: () => text,
    failure: () => (failed ? text : noResponse),
  }
}
