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
  publishFeedback(feedback: SubmissionFeedback): void
  canPublish?: () => boolean
  tracer?: PerfTracer
  printSummary?: (line: string) => void
}): AssistantCommandRunner {
  const mintTurnId = createTurnIdSource(deps.tracer)
  let activeRun: AcceptedRunOwnership | null = null

  return {
    async run(command, turnId, truncated) {
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
      try {
        if (admission.createsSession) deps.onSessionStarted?.(admission)
        const publisher = deps.createRunPublisher(admission)
        for await (const event of deps.pipeline.execute(command, turnId, truncated, {
          snapshot: admission.journal,
          memory: admission.memory,
          commit: (outcome, note, patch) => deps.runtime.commitRunContinuity(admission.runId, outcome, note, patch),
        })) {
          if (deps.canPublish && !deps.canPublish()) break
          publisher.publish(event)
        }
        return true
      } finally {
        deps.runtime.finish(admission.runId)
        if (activeRun?.runId === admission.runId) activeRun = null
      }
    },
  }
}
