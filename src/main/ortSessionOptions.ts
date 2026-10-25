/**
 * The session options every onnxruntime-node session in the app is created
 * with. Left at the defaults, each session gets its own intra-op pool sized
 * to the machine's cores, and every pool's threads spin-wait after each run:
 * the always-on wake and VAD sessions alone (~94 small runs a second) held
 * about five cores busy at idle on the dev PC, and on the 2-core kiosk the
 * whole machine, starving the renderer and the voice chain. With spinning
 * off and one thread the same loop costs about 4 % of one core.
 *
 * `threads` is the intra-op pool size: 1 for the small always-on models,
 * more only where one big run's latency is the point (the STT encoders).
 */
export function ortSessionOptions(threads = 1) {
  return {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: 'sequential' as const,
    extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
  }
}

export type OrtSessionOptions = ReturnType<typeof ortSessionOptions>

/**
 * The STT encoders' pool: one big run per pass, where a second thread pays.
 * Measured on 12 real utterances pinned to 2 cores / 4 threads (Parakeet,
 * endpoint→transcript p50/p95, CPU over the replay): 1 thread 192/422 ms;
 * 2 threads 128/291 ms, 6.8 s; 4 threads 115/242 ms, 9.8 s; the old spinning
 * default 97/208 ms but 22.6 s. The kiosk has 2 cores.
 */
export const STT_THREADS = 2
