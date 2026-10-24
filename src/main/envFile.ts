import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDotEnv } from '../core/settings/dotEnv'
import { reportFault } from '../core/trace/fault'

/** Where the app runs from: a checkout's `pnpm build`, or the packaged AppImage. */
export interface EnvFileHome {
  isPackaged: boolean
  appPath: string
  userDataDir: string
}

// Where the app's `.env` lives (#76): next to the app in a checkout, in the
// profile in the packaged app, whose own path is read-only (ADR 0090) —
// unless BINGBONG_ENV_FILE points somewhere else, the seam e2e uses to stay
// hermetic and tests use to bring their own file.
export function resolveEnvFilePath(env: Record<string, string | undefined>, home: EnvFileHome): string {
  const override = env.BINGBONG_ENV_FILE
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  return join(home.isPackaged ? home.userDataDir : home.appPath, '.env')
}

/** Read and parse the env file (once, at boot); a missing file is simply no config. */
export function loadEnvFile(env: Record<string, string | undefined>, home: EnvFileHome): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(resolveEnvFilePath(env, home), 'utf8'))
  } catch (error) {
    // A present-but-unreadable file must not be silent — that is the exact
    // "debug a config that was never wrong" trap this loader exists to end.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      process.stderr.write(`bingbong: could not read ${resolveEnvFilePath(env, home)}: ${String(error)}\n`)
      // Read at startup, long before any sink exists — the record is a
      // no-op today and correct the moment the loader is called again.
      reportFault('app.envFile.load', error)
    }
    return {}
  }
}
