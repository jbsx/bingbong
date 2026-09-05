// GPU crash-loop recovery: when the GPU process crash-loops, Chromium's
// browser process LOG(FATAL)s — "GPU process isn't usable. Goodbye." (seen
// live on an Intel-iGPU/Wayland box) — and takes the whole app with it: no
// window-close handlers, no Session end, in-flight Runs left interrupted.
// The policy here keeps that death from being silent or final: every GPU
// death is persisted as it happens (so the record survives the FATAL), a
// loop observed live relaunches immediately with the GPU disabled instead
// of racing Chromium's give-up, and the next boot after a hard death starts
// with the GPU disabled. Each launch starts a fresh window, so a recovered
// machine tries hardware again on the next manual start.

import { reportFault } from '../trace/fault'

/** Chromium switch name (no dashes) as `appendSwitch` wants it. */
export const GPU_DISABLE_SWITCH = 'disable-gpu'
/** Env knob: `BINGBONG_DISABLE_GPU=1` boots with the GPU process off. */
export const GPU_DISABLE_ENV = 'BINGBONG_DISABLE_GPU'

/** GPU-process deaths inside this window together count as a crash loop. */
export const GPU_CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000
/** Deaths inside the window that mean "act before Chromium gives up". */
export const GPU_CRASH_LOOP_DEATHS = 2

/** The persisted crash count one launch leaves behind for the next. */
export interface GpuCrashRecord {
  deaths: number
  firstAt: number
}

/** Parses the persisted record; malformed or absent input is no record. */
export function parseGpuCrashRecord(raw: string | null): GpuCrashRecord | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const { deaths, firstAt } = parsed as { deaths?: unknown; firstAt?: unknown }
    if (!Number.isInteger(deaths) || (deaths as number) < 0 || !Number.isFinite(firstAt)) return null
    return { deaths: deaths as number, firstAt: firstAt as number }
  } catch (error) {
    reportFault('app.gpuStability.parseRecord', error)
    return null
  }
}

/** One more GPU death at `at`; a window that lapsed opens a fresh one. */
export function recordGpuDeath(
  prev: GpuCrashRecord | null,
  at: number,
  windowMs: number = GPU_CRASH_LOOP_WINDOW_MS,
): GpuCrashRecord {
  if (prev !== null && at - prev.firstAt < windowMs && at >= prev.firstAt) {
    return { deaths: prev.deaths + 1, firstAt: prev.firstAt }
  }
  return { deaths: 1, firstAt: at }
}

/** Whether the record's deaths form a loop worth acting on. */
export function isGpuCrashLoop(record: GpuCrashRecord | null, deaths: number = GPU_CRASH_LOOP_DEATHS): boolean {
  return record !== null && record.deaths >= deaths
}

/** The argv spelling of the disable switch, as process.argv carries it. */
export function gpuDisableFlag(): string {
  return `--${GPU_DISABLE_SWITCH}`
}

/**
 * The boot decision: disable the GPU process when asked for (switch or env
 * knob) or when the previous run's persisted record shows a crash loop.
 */
export function resolveGpuLaunchDecision(inputs: {
  argv: readonly string[]
  env: Record<string, string | undefined>
  record: GpuCrashRecord | null
}): { disableGpu: boolean } {
  const asked = inputs.argv.includes(gpuDisableFlag()) || inputs.env[GPU_DISABLE_ENV] === '1'
  return { disableGpu: asked || isGpuCrashLoop(inputs.record) }
}

/** The argv for the recovery relaunch: everything this run got, plus the switch. */
export function gpuDisableRelaunchArgs(argv: readonly string[]): string[] {
  return [...argv.slice(1), gpuDisableFlag()]
}
