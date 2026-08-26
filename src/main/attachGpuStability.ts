import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from 'electron'
import {
  GPU_DISABLE_SWITCH,
  gpuDisableRelaunchArgs,
  isGpuCrashLoop,
  parseGpuCrashRecord,
  recordGpuDeath,
  resolveGpuLaunchDecision,
} from '../core/app/gpuStability'

// GPU crash-loop recovery, main wiring (policy in core/app/gpuStability):
// boots with the GPU process disabled when asked or when the previous run's
// persisted deaths say it looped, and relaunches with the switch when a loop
// is observed live — before Chromium's browser-process FATAL ("GPU process
// isn't usable. Goodbye.") can take the app down with the live Session.

/** The Electron surface the guard needs — structural, so tests fake it. */
export type GpuStabilityAppSurface = Pick<App, 'commandLine' | 'on' | 'relaunch' | 'quit'>

export interface GpuStabilityDeps {
  app: GpuStabilityAppSurface
  argv: readonly string[]
  env: Record<string, string | undefined>
  recordPath: string
  now(): number
  log?(line: string): void
}

/** Where the crash record lives inside a profile. */
export function gpuCrashRecordPath(userDataDir: string): string {
  return join(userDataDir, 'gpu-crash-record.json')
}

function readRecord(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function attachGpuStability(deps: GpuStabilityDeps): void {
  const log = deps.log ?? ((line: string) => console.warn(line))
  const { disableGpu } = resolveGpuLaunchDecision({
    argv: deps.argv,
    env: deps.env,
    record: parseGpuCrashRecord(readRecord(deps.recordPath)),
  })
  if (disableGpu) {
    // Must precede app ready; module top in main/index.ts guarantees that.
    deps.app.commandLine.appendSwitch(GPU_DISABLE_SWITCH)
    log('[gpu] hardware acceleration disabled for this launch (crash-loop recovery)')
  }
  // Each launch starts a fresh window: yesterday's loop must not outlive the
  // relaunch it caused, and a healthy launch leaves nothing behind.
  try {
    unlinkSync(deps.recordPath)
  } catch {
    // absent is the common case
  }

  let current: ReturnType<typeof recordGpuDeath> | null = null
  let relaunched = false
  deps.app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU' || details.reason === 'clean-exit') return
    current = recordGpuDeath(current, deps.now())
    // Persist as it happens: the FATAL this guards against leaves no code
    // running to write anything after the fact.
    try {
      writeFileSync(deps.recordPath, `${JSON.stringify(current)}\n`)
    } catch {
      // A record that cannot persist just loses the next-boot fallback.
    }
    log(`[gpu] GPU process gone (${details.reason}), ${current.deaths} in the window`)
    if (!disableGpu && !relaunched && isGpuCrashLoop(current)) {
      relaunched = true
      log('[gpu] GPU crash loop — relaunching with hardware acceleration disabled')
      deps.app.relaunch({ args: gpuDisableRelaunchArgs(deps.argv) })
      deps.app.quit()
    }
  })
}
