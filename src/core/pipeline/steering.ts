import type { CommandPipeline } from './createCommandPipeline'

// Typed steering (#46): the feed panel's steer box drives the exact seam the
// spoken "hold on" flow drives. The voice session pauses and resumes in two
// steps because it must listen for the directive between them; the typed box
// already has the directive, so pause-if-needed and resume-with-steering land
// as one atomic submit. Everything downstream is the tested voice behavior:
// pending decisions settle as steered, stale not-yet-executed work is
// cancelled, and the directive rides the next orchestrator model call.

/**
 * Submits one steering directive to the active run. Returns false when there
 * is no run to steer, the directive is blank, or the run is aborting — the
 * caller's box is disabled then anyway, and input is never silently taken
 * while claiming it was.
 */
export function steerPipeline(pipeline: CommandPipeline, directive: string): boolean {
  const trimmed = directive.trim()
  if (trimmed === '') return false
  const state = pipeline.getState()
  if (state === 'idle') return false
  if (state === 'running') pipeline.pause()
  return pipeline.resume(trimmed)
}
