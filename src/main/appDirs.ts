import { join } from 'node:path'

/** Where the files that ship with the app sit, read in place and never copied (ADR 0090). */
export interface AppDirs {
  /** Silero VAD, the openWakeWord front end and the wake heads: `models/` in the repo, `resources/models` in the package. */
  bundledModelsDir: string
  /** scripts/wake_sidecar.py, which Python reads from outside the read-only archive. */
  scriptsDir: string
}

export function resolveAppDirs(app: { isPackaged: boolean; appPath: string; resourcesPath: string }): AppDirs {
  if (!app.isPackaged) return { bundledModelsDir: join(app.appPath, 'models'), scriptsDir: join(app.appPath, 'scripts') }
  return {
    bundledModelsDir: join(app.resourcesPath, 'models'),
    scriptsDir: join(app.resourcesPath, 'app.asar.unpacked', 'scripts'),
  }
}
