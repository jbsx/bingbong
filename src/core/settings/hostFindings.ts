// What the host checks found missing (#419): main looks once at boot, the
// Settings page shows the same lines the fault log holds.

export type HostCheck = 'aplay' | 'microphone' | 'display'

export interface HostFinding {
  check: HostCheck
  message: string
}
