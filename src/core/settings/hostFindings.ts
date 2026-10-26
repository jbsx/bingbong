// What the host checks found missing (#419): main looks once at boot, the
// Settings page shows the same lines the fault log holds.

/** `ear`: the chosen cloud ear cannot hear (#463) — shown under Environment, where its key is. */
export type HostCheck = 'aplay' | 'microphone' | 'display' | 'ear'

export interface HostFinding {
  check: HostCheck
  message: string
}
