// What the model is told of the Answer Checkpoints (#288, #291, ADR 0072),
// each phrase from one constant. The `fix-288-290` traces showed a model
// that knew the field and called the record tool anyway, so the instruction
// is given where the Answer is written, and every text a Run reads on its
// way to a recording round names the Answer as the other place to record.
// Apart from the modules that say them, so a checkpoint's grader can name
// the Answer without importing the list that imports the grader.

/** The instruction, which opens the Answer contract's `checkpoints` bullet. */
export const ANSWER_CHECKPOINT_INSTRUCTION =
  'When you are ready to answer, answer: what you found and have not recorded goes in "checkpoints", never in a ' +
  'record_evidence or record_candidate call first.'

/** What the prompt's `record_evidence` paragraph and both tools' descriptions say of it. */
export const ANSWER_CHECKPOINT_GUIDANCE =
  'Not for a Run that is ready to answer: what is unrecorded then goes in the Answer\'s "checkpoints".'

/** What a refused checkpoint's result ends on, whichever tool refused it. */
export const ANSWER_CHECKPOINT_REFUSAL_HINT =
  'If you are ready to answer, carry the corrected entry in the Answer\'s "checkpoints" instead of sending it again.'

/** The two places a Candidate just created may be decided from. */
export const CANDIDATE_DECISION_PLACES = 'alongside your next action or in the Answer\'s "checkpoints"'
