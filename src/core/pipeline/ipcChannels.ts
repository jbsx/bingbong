export const PIPELINE_IPC = {
  /** Renderer → main: run one typed command. Resolves false when a run is already active. */
  submit: 'pipeline:submit',
  /** Main → renderer: one PipelineEvent. */
  event: 'pipeline:event',
  /** Renderer → main: abort the active run, if any. */
  abort: 'pipeline:abort',
} as const
