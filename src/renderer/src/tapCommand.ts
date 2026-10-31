// A tap on an Idle Screen control that leaves the screen up is a Command like any other, and the Turn Card is told it
// is a tap's (#525, CONTEXT.md). A submit resolves once its line has run, so a slow line's settling can land between
// the next tap and that tap's first event: the taps are counted, and only the last to settle says none is pending.

const listeners = new Set<(pending: boolean) => void>()
let inFlight = 0

const tell = (pending: boolean): void => {
  for (const listener of listeners) listener(pending)
}

/** Hears each tap before its line is submitted, and again once no tap's submit is still out. Returns the unsubscribe. */
export function onCommandTap(listener: (pending: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function tapCommand(line: string): void {
  inFlight += 1
  tell(true)
  void window.bingbong.assistant.submit(line).finally(() => {
    inFlight -= 1
    if (inFlight === 0) tell(false)
  })
}
