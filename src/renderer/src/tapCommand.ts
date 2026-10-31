// A tap on an Idle Screen control that leaves the screen up is a Command like any other, and the Turn Card is told it
// is a tap's (#525, CONTEXT.md). Each tap marks one line. A submit's reply can land before its line's events (seen on a
// double tap, #532), so a line that ran says nothing as it settles; only a submit that ran no line, or that rejected,
// takes its mark back. The fold counts marks and ties none to a tap, so a rejection after its line started gives back
// another tap's; no such throw has been seen.

import { reportRendererFault } from './diagnostics'

const listeners = new Set<(mark: boolean) => void>()

const tell = (mark: boolean): void => {
  for (const listener of listeners) listener(mark)
}

/** Hears `true` for each tap before its line is submitted, and `false` for a tap whose submit ran no line or rejected. Returns the unsubscribe. */
export function onCommandTap(listener: (mark: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function tapCommand(line: string): void {
  tell(true)
  void window.bingbong.assistant.submit(line).then(
    (ran) => {
      if (!ran) tell(false)
    },
    (error: unknown) => {
      reportRendererFault('tapCommand.submit', error)
      tell(false)
    },
  )
}
