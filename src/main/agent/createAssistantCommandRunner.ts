import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import type { Clock } from '../../core/ports/clock'
import { createTurnIdSource, type PerfTracer } from '../../core/perf/perfTracer'
import { emitTurnSummary } from '../../core/perf/turnSummary'
import type { SessionRuntime } from '../../core/session/sessionRuntime'
import type { SubmissionFeedback } from '../../core/session/submissionFeedback'
import type { AcceptedRunOwnership, WindowRunPublisher } from '../session/windowEventPublisher'

export interface AssistantCommandRunner {
  run(command: string, turnId?: string, truncated?: boolean): Promise<boolean>
}

export function createAssistantCommandRunner(deps: {
  pipeline: CommandPipeline
  runtime: SessionRuntime
  clock: Clock
  createRunPublisher(ownership: AcceptedRunOwnership): WindowRunPublisher
  onSessionStarted?(admission: AcceptedRunOwnership & { acceptedAt: number }): void
  /**
   * Ends the live Session with reason 'reset' (#99) — history, Browser
   * State, Subagents, and Feed cleanup included — after a reset-consumed
   * run has fully unwound and before its replacement is admitted.
   */
  onSessionReset(admission: AcceptedRunOwnership): void
  publishFeedback(feedback: SubmissionFeedback): void
  canPublish?: () => boolean
  tracer?: PerfTracer
  printSummary?: (line: string) => void
}): AssistantCommandRunner {
  const mintTurnId = createTurnIdSource(deps.tracer)
  let activeRun: AcceptedRunOwnership | null = null

  return {
    async run(command, turnId, truncated) {
      // A model-invoked Session Reset (#99) replays the original command as
      // the first Run of a fresh Session; every other outcome finishes here.
      let currentTurnId = turnId
      for (;;) {
        const submission = deps.runtime.submit()
        if (activeRun) {
          deps.runtime.reject(submission.submissionId)
          deps.publishFeedback({
            type: 'submission_rejected',
            reason: 'busy',
            submissionId: submission.submissionId,
            message: 'Another command is already running. Wait for it to finish or steer it instead.',
            at: deps.clock.now(),
          })
          emitTurnSummary(deps.tracer, turnId ?? mintTurnId(), deps.printSummary ?? console.log)
          return false
        }

        const admission = deps.runtime.accept(submission.submissionId)
        activeRun = admission
        let restartRequested = false
        try {
          if (admission.createsSession) deps.onSessionStarted?.(admission)
          const publisher = deps.createRunPublisher(admission)
          for await (const event of deps.pipeline.execute(command, currentTurnId, truncated, {
            snapshot: admission.journal,
            memory: admission.memory,
            commit: (outcome, note, patch) => deps.runtime.commitRunContinuity(admission.runId, outcome, note, patch),
          })) {
            if (event.type === 'done' && event.outcome === 'reset') restartRequested = true
            if (deps.canPublish && !deps.canPublish()) break
            publisher.publish(event)
          }
        } finally {
          deps.runtime.finish(admission.runId)
          if (activeRun?.runId === admission.runId) activeRun = null
        }
        if (!restartRequested) return true
        // The discarded run has fully unwound: end its Session so the next
        // admission creates the replacement identity from scratch. The
        // replacement mints its own turn id — the old one belongs to the
        // discarded attempt's perf spans — while `truncated` rides on: it
        // describes the user's utterance, which is being retried verbatim.
        deps.onSessionReset(admission)
        currentTurnId = undefined
      }
    },
  }
}
