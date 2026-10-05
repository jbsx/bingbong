import { streamedCard, type parseAssistantAnswer } from '../agent/answerContract'

// The Answer's Card, published when its fields close (#319, ADR 0074). The
// Card's fields lead the Answer object, so they have closed in the stream
// about halfway through the round; the pipeline publishes the Card then
// and the Answer Tail is written behind it. The watch reads the stream
// alone: what the Card must still pass before it is shown — the
// Off-language check, the Asked Items' coverage — is the pipeline's to ask.

/** The Card's fields as the stream closed them: an on-contract Answer holding nothing else. */
export type ClosedCard = ReturnType<typeof parseAssistantAnswer>

/**
 * One round's watch over its streamed text. `ready` settles once, with the
 * Card, when the stream has closed its fields in the contract's order and
 * they read as the contract's shape; it never settles otherwise.
 */
export interface CardWatch {
  /** One streamed fragment of the round's raw content. */
  onText(text: string): void
  /**
   * The client retried the attempt (#47, #271): its partial text is
   * dropped, and a Card it had already closed belongs to a reply that
   * never landed.
   */
  restart(): void
  /** Whether the Card came from an attempt the client then retried. */
  readonly abandoned: boolean
  /** Whether the attempt in flight wrote its Card's fields out of the contract's order. */
  outOfOrder(): boolean
  readonly ready: Promise<ClosedCard>
}

export function createCardWatch(): CardWatch {
  let buffer = ''
  // Read once an attempt: an object's order does not change as it grows.
  let read: 'in_order' | 'out_of_order' | null = null
  let settled = false
  let abandoned = false
  let resolve: (card: ClosedCard) => void = () => {}
  const ready = new Promise<ClosedCard>((settle) => {
    resolve = settle
  })
  return {
    onText(text) {
      buffer += text
      if (read !== null) return
      const streamed = streamedCard(buffer)
      if (streamed === null) return
      read = streamed.order
      if (streamed.order !== 'in_order' || streamed.card.shape !== 'on_contract' || settled) return
      settled = true
      resolve(streamed.card)
    },
    restart() {
      if (settled) abandoned = true
      buffer = ''
      read = null
    },
    get abandoned() {
      return abandoned
    },
    outOfOrder() {
      return read === 'out_of_order'
    },
    ready,
  }
}
