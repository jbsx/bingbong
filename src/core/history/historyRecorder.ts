import type { PipelineEvent } from '../pipeline/events'
import { inferRunOutcome } from '../pipeline/events'
import type { VoiceHeardEvent } from '../voice/ipcChannels'
import { describeHeard } from '../voice/heardDisplay'
import type { HistoryStore } from './historyStore'
import { projectPipelineEvent } from './transcriptProjection'

// Projects the dashboard's own event streams (pipeline events, heard voice,
// voice errors) onto the history store, mirroring the renderer's transcript
// word-for-word: what a restart hydrates is exactly what was on screen.

export interface HistoryRecorder {
  /** One independent command execution; concurrent attempts cannot collide. */
  run(): { event(pipelineEvent: PipelineEvent): void }
  /** Auxiliary pipeline events (downloads/subagents) attach to the active run. */
  event(pipelineEvent: PipelineEvent): void
  heard(heard: VoiceHeardEvent): void
  voiceError(message: string, at?: number): void
}

export function createHistoryRecorder(
  store: HistoryStore,
  deps: { now(): number },
): HistoryRecorder {
  const activeRunIds: number[] = []
  const activeRunId = (): number | null => activeRunIds[0] ?? null
  const removeActiveRun = (runId: number): void => {
    const index = activeRunIds.indexOf(runId)
    if (index !== -1) activeRunIds.splice(index, 1)
  }

  const append = (
    kind: 'command' | 'tool' | 'display' | 'speak' | 'error' | 'voice',
    text: string,
    at: number,
    targetRunId = activeRunId(),
  ): void => {
    store.appendEntry({ runId: targetRunId, kind, text, at })
  }

  return {
    run() {
      let runId: number | null = null
      let lastStatus: string | null = null
      let failed = false

      return {
        event(event) {
          switch (event.type) {
            case 'command': {
              if (runId !== null) {
                store.finishRun(runId, 'interrupted', event.at)
                removeActiveRun(runId)
              }
              runId = store.startRun(event.text, event.at)
              activeRunIds.push(runId)
              lastStatus = null
              failed = false
              const projected = projectPipelineEvent(event)
              if (projected) append(projected.kind, projected.text, projected.at, runId)
              return
            }
            case 'status':
              lastStatus = event.status
              return
            case 'done': {
              if (runId !== null) {
                const outcome = inferRunOutcome(event.outcome, lastStatus, failed)
                store.finishRun(runId, outcome, event.at)
                removeActiveRun(runId)
                runId = null
              }
              lastStatus = null
              failed = false
              return
            }
            default: {
              if (event.type === 'error') failed = true
              const projected = projectPipelineEvent(event)
              if (projected) append(projected.kind, projected.text, projected.at, runId)
            }
          }
        },
      }
    },
    event(event) {
      const projected = projectPipelineEvent(event)
      if (projected) append(projected.kind, projected.text, projected.at)
    },
    heard(heard) {
      // Commands are echoed by the pipeline itself; only answers and
      // undecided words land in the transcript.
      if (heard.routed === 'command') return
      append('voice', describeHeard(heard), heard.at ?? deps.now())
    },
    voiceError(message, at = deps.now()) {
      append('error', `voice: ${message}`, at)
    },
  }
}
