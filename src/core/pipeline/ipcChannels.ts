export const PIPELINE_IPC = {
  submit: 'pipeline:submit',
  event: 'pipeline:event',
  submissionFeedback: 'pipeline:submission-feedback',
  resolveConfirmation: 'pipeline:resolve-confirmation',
  /** Answer an open ask_user window with free text (the dashboard card). */
  resolveAsk: 'pipeline:resolve-ask',
  /** Renderer → main: abort the active run, if any. */
  abort: 'pipeline:abort',
  /** The feed panel's steer box → main: steer the active run (#46). */
  steer: 'pipeline:steer',
} as const
