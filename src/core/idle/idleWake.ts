// What wakes the Idle Screen once it is up. The rest state survives the
// voice half and the pipeline — a wake, a listen, a heard line, a Jev
// reading — so a Command that never needs the pane (the Timer, a Stop)
// is heard and performed over it. Only a Command that acts on the pane,
// or real input, brings the dashboard back.

import type { PipelineEvent } from '../pipeline/events'

/** Whether this event, arriving while the Idle Screen is up, wakes it: a Command that acts on the pane. */
export function wakesIdleScreen(event: PipelineEvent): boolean {
  return event.type === 'command' && event.dropped !== true && event.keepsIdle !== true
}
