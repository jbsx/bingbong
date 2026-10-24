import type { SiteQuestion } from '../command/siteQuestion'
import { reportFault } from '../trace/fault'

// The Site Question desk (#423): where the page's own question waits for
// the user. The pane raises a native confirm here and the page's script
// stays frozen on it; the runner reads the user's next line and answers it
// from here. An alert, which has one button, is accepted by the pane and
// only told here, for its text to be said.

export type SiteQuestionEvent = { readonly type: 'question'; readonly question: SiteQuestion } | { readonly type: 'alert'; readonly text: string } | { readonly type: 'closed' }

export interface SiteQuestionDesk {
  /** The pane: the page asked; `settle` answers it on the page. */
  raise(question: SiteQuestion, settle: (accept: boolean) => Promise<void>): void
  /** The pane: the page's dialog closed with no answer from here (it navigated, or closed). */
  closed(): void
  /** The pane: an alert was accepted; its text is said. */
  told(text: string): void
  /** The question open now, if one is. */
  open(): SiteQuestion | null
  /** Answers the open question; whether one was open. */
  answer(accept: boolean): Promise<boolean>
  subscribe(listener: (event: SiteQuestionEvent) => void): () => void
}

export function createSiteQuestionDesk(): SiteQuestionDesk {
  let current: { question: SiteQuestion; settle: (accept: boolean) => Promise<void> } | null = null
  const listeners = new Set<(event: SiteQuestionEvent) => void>()
  const emit = (event: SiteQuestionEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        reportFault('browser.siteQuestionDesk.listener', error)
      }
    }
  }
  return {
    raise(question, settle) {
      current = { question, settle }
      emit({ type: 'question', question })
    },
    closed() {
      if (current === null) return
      current = null
      emit({ type: 'closed' })
    },
    told(text) {
      emit({ type: 'alert', text })
    },
    open: () => current?.question ?? null,
    async answer(accept) {
      if (current === null) return false
      const { settle } = current
      current = null
      await settle(accept)
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
