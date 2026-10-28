// What the host checks found missing (#419): main looks once at boot, the
// Settings page shows the same lines the fault log holds.

/**
 * `ear`: the chosen cloud ear cannot hear (#463) — shown under Environment, where its key is.
 * `yt-dlp`: the audio road's yt-dlp is not found (#502) — shown beside the audio-only music toggle while it is on.
 */
export type HostCheck = 'aplay' | 'microphone' | 'display' | 'ear' | 'yt-dlp'

export interface HostFinding {
  check: HostCheck
  message: string
}
