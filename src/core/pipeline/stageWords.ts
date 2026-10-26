import type { Command, CommandPage } from '../command/command'
import { targetLabel } from '../command/command'
import type { PipelineStatus } from './events'

// One vocabulary for a Command's stages (#438, principle 9): the Status
// Capsule's pill, its hint and the Feed's Run Detail name a stage with the
// same word. Acting takes the action's own word ("Opening", "Searching")
// and its object in the person's words — a host, the search terms, a
// control's label — never the raw action line ("navigate http://…").

/** A stage as it is named: its word and, when it is on something, what. */
export interface StageWords {
  readonly word: string
  readonly object?: string
}

/** Each stage's word; acting's is the generic one, for a verb with no word of its own. */
export const STAGE_WORDS: Readonly<Record<PipelineStatus, string>> = {
  thinking: 'Thinking',
  acting: 'Acting',
  loading: 'Loading',
  speaking: 'Speaking',
  cancelled: 'Stopped',
}

/** An address as a person names it: its host without `www.`; words that are no address, as they are. */
export function hostOf(address: string): string {
  return URL.canParse(address) ? new URL(address).hostname.replace(/^www\./, '') : address.replace(/^www\./, '')
}

const quoted = (words: string | null | undefined): string => `“${words ?? ''}”`

/** What Acting is called for this Command, and what it is on. */
export function actingWords(command: Command, page?: CommandPage): StageWords {
  const named = (): string => {
    const label = page !== undefined ? targetLabel(command, page) : undefined
    return label !== undefined && label !== '' ? quoted(label) : `item ${command.target ?? '?'}`
  }
  if (command.dismiss === true) return { word: 'Closing', object: 'the pop-up' }
  switch (command.verb) {
    case 'navigate':
      return { word: 'Opening', object: hostOf(command.slot ?? '') }
    case 'search':
      return { word: 'Searching', object: command.site !== undefined ? `${command.site} for ${quoted(command.slot)}` : quoted(command.slot) }
    case 'type':
      return command.submit === true ? { word: 'Searching', object: quoted(command.slot) } : { word: 'Typing', object: quoted(command.slot) }
    case 'click':
      return { word: 'Clicking', object: command.text !== undefined ? quoted(command.text.text.slice(0, 80)) : named() }
    case 'menu':
      return { word: 'Opening', object: `the menu on ${named()}` }
    case 'scroll_up':
    case 'scroll_down':
      return command.show !== undefined ? { word: 'Scrolling', object: `to ${quoted(command.show.text.slice(0, 80))}` } : { word: 'Scrolling', object: command.verb === 'scroll_up' ? 'up' : 'down' }
    case 'back':
      return { word: 'Going back' }
    case 'forward':
      return { word: 'Going forward' }
    case 'reload':
      return { word: 'Reloading' }
    case 'read':
      return { word: 'Reading', object: 'the page' }
    case 'capture':
      // A Capture Op (#466): what it takes, by its kind.
      return { word: 'Copying', object: command.capture?.kind === 'page' ? 'the page' : `the ${command.capture?.kind ?? 'item'}` }
    case 'resume':
      return { word: 'Opening', object: 'the last page' }
    case 'play':
      if (command.music?.kind === 'search') return { word: command.music.place === 'end' ? 'Queueing' : 'Playing', object: command.slot ?? '' }
      return { word: STAGE_WORDS.acting }
    default:
      return { word: STAGE_WORDS.acting }
  }
}

/** The word a stage goes by (#438): Acting by the action's own word, the rest by the stage's. */
export function stageWord(progress: { readonly stage: PipelineStatus; readonly word?: string }): string {
  return progress.stage === 'acting' && progress.word !== undefined ? progress.word : STAGE_WORDS[progress.stage]
}

/**
 * A stage's line in the Feed's Run Detail: the Capsule's word for it and
 * the object the action named — Acting by the action's own word, Loading
 * by the stage's, on the same object.
 */
export function stageLine(stage: PipelineStatus, acting?: StageWords): string {
  const word = stageWord({ stage, ...(acting !== undefined ? { word: acting.word } : {}) })
  const object = (stage === 'acting' || stage === 'loading') && acting?.object !== undefined && acting.object !== '' ? ` ${acting.object}` : ''
  return `${word}${object}`
}
