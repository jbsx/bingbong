import type { CommandPipeline } from '../../core/pipeline/createCommandPipeline'
import { webEvidenceCommit } from '../../core/pipeline/evidenceCheckpoint'
import type { Clock } from '../../core/ports/clock'
import { createTurnIdSource, type PerfTracer } from '../../core/perf/perfTracer'
import { emitTurnSummary } from '../../core/perf/turnSummary'
import type { SessionRuntime } from '../../core/session/sessionRuntime'
import { createRunTraceWriter, type RunTraceSink } from '../../core/trace/runTrace'
import { failureScreenshotCause, failureScreenshotEvent, type FailureScreenshotCapture } from '../../core/trace/failureScreenshot'
import { reportFault } from '../../core/trace/fault'
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
  /**
   * The Run Trace sink (#180, #184, ADR 0031): the diagnostic file family
   * beside the perf logs, present only when the developer set
   * `BINGBONG_RUN_TRACE`. Absent in tests and wherever nothing is tracing —
   * the Run then simply leaves no trace, reasoning records included.
   */
  runTrace?: RunTraceSink
  /**
   * The failure screenshot (#191, ADR 0031): captures the visible tab and
   * puts the PNG beside the trace when a Run finalizes failed or on a
   * work rail. Wired by main only beside the sink — with no sink there is
   * no record to name the file, so nothing is captured.
   */
  captureFailureScreenshot?: FailureScreenshotCapture
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

        // The command is retained before the Run starts (#211, ADR 0039):
        // a continuation's utterance may be the user correcting what the
        // last Answer showed them, and the first model request of this Run
        // can fail before a single tool has run. Admission is the last
        // moment their words are certain to exist.
        const admission = deps.runtime.accept(submission.submissionId, command)
        activeRun = admission
        let restartRequested = false
        try {
          if (admission.createsSession) deps.onSessionStarted?.(admission)
          const publisher = deps.createRunPublisher(admission)
          // The Run Trace seam (#180, ADR 0030): this Run's decisions,
          // stamped with the identities that join the file to Recorded
          // History and the eval tape. Identity is bound here because
          // admission is what owns it — the Run layer never forges one.
          const traceRun = deps.runTrace
            ? createRunTraceWriter({
                sink: deps.runTrace,
                now: () => deps.clock.now(),
                identity: {
                  runId: admission.runId,
                  sessionId: admission.sessionId,
                  generation: admission.generation,
                },
              })
            : undefined
          for await (const event of deps.pipeline.execute(command, currentTurnId, truncated, {
            snapshot: admission.journal,
            memory: admission.memory,
            // Checkpointed Session Evidence this Run starts beside (#121):
            // the immutable admission snapshot — mid-Run checkpoints join
            // the Session store and later admissions, never this snapshot.
            evidence: admission.evidence,
            // The Session's inspection subject (#210, ADR 0039): the
            // Candidate a previous Answer presented, so this Run's "show
            // me that again" addresses it rather than the open page.
            ...(admission.inspection ? { inspection: admission.inspection } : {}),
            // The user's unresolved words (#211, ADR 0039): what they
            // said, including this Run's own command, that no Run has yet
            // grounded into a decision the Session retains.
            ...(admission.corrections ? { corrections: admission.corrections } : {}),
            // Which verification routes this objective already spent
            // (#212, ADR 0039/0041): so a continuation takes a different
            // route to the check, or names it unverified, rather than
            // sending the request that already reported what it can.
            ...(admission.verification ? { verification: admission.verification } : {}),
            // Resolved only by an Answer the model wrote (#211), and only
            // against the Session that admitted this Run. A Run whose
            // Answer lands after a Reset is answering work nobody is
            // doing any more: the store it would reach belongs to a new
            // owner, whose retained words this Run never saw and cannot
            // discharge. Identity is checked at call time, because that
            // is when the ownership question is actually being asked.
            resolveCorrections: () => {
              const live = deps.runtime.state()
              if (live.sessionId !== admission.sessionId || live.generation !== admission.generation) return
              deps.runtime.evidenceStore()?.resolveCorrectionsFrom(admission.runId)
            },
            // The Observation ledger's staleness guard (#111): the Session
            // generation this Run was admitted under.
            generation: admission.generation,
            // The Run's stop record rides the Memory Commit (#203): bounded
            // Session continuity is where "why did you stop?" is answered
            // from, so there is no second store to keep in step.
            commit: (outcome, note, patch, stop) =>
              deps.runtime.commitRunContinuity(admission.runId, outcome, note, patch, stop),
            // The Evidence Checkpoint commit seam (#121, ADR 0028): the one
            // standard web-Observation commit over the live Session store,
            // provenance stamped under this Run's identity. The store is
            // resolved per call, so a Session that ended (Reset, Lapse)
            // refuses later checkpoints instead of writing into the void.
            checkpointEvidence: webEvidenceCommit(() => deps.runtime.evidenceStore(), admission.runId),
            // The live evidence Session handle (#122): grounds user
            // citations, Candidate checkpoints, Answer support, and
            // derived source links against the live store under this
            // Run's identity — resolved per call for the same reason.
            evidenceSession: () => {
              const store = deps.runtime.evidenceStore()
              return store === null ? null : { store, runId: admission.runId }
            },
            ...(traceRun ? { traceRun } : {}),
          })) {
            if (event.type === 'done' && event.outcome === 'reset') restartRequested = true
            if (deps.canPublish && !deps.canPublish()) break
            publisher.publish(event)
            // The failure screenshot (#191): after the `done` is published
            // and before the Run is finished — the page still shows what
            // it showed when the Run gave up. A capture that throws is a
            // fault under this turn; the Run's outcome is already out.
            const cause = failureScreenshotCause(event)
            if (event.type === 'done' && cause !== null && traceRun !== undefined && deps.captureFailureScreenshot !== undefined) {
              const turnId = event.turnId
              try {
                const captured = await deps.captureFailureScreenshot({ runId: admission.runId, turnId })
                traceRun(() => ({ turnId, ...failureScreenshotEvent(cause, captured) }))
              } catch (error) {
                reportFault('agent.createAssistantCommandRunner.failureScreenshot', error, { turnId })
              }
            }
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
