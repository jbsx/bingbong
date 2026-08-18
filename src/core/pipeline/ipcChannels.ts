export const PIPELINE_IPC = {
  submit: 'pipeline:submit',
  event: 'pipeline:event',
  resolveConfirmation: 'pipeline:resolve-confirmation',
  /** Answer an open ask_user window with free text (the dashboard card). */
  resolveAsk: 'pipeline:resolve-ask',
} as const
