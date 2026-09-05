import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDotEnv } from '../core/settings/dotEnv'
import { reportFault } from '../core/trace/fault'

// Where the app's `.env` lives (#76): next to the app, unless
// BINGBONG_ENV_FILE points somewhere else — the seam e2e uses to stay
// hermetic and tests use to bring their own file.
export function resolveEnvFilePath(env: Record<string, string | undefined>, appPath: string): string {
  const override = env.BINGBONG_ENV_FILE
  return typeof override === 'string' && override.trim() !== '' ? override.trim() : join(appPath, '.env')
}

/** Read and parse the env file (once, at boot); a missing file is simply no config. */
export function loadEnvFile(env: Record<string, string | undefined>, appPath: string): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(resolveEnvFilePath(env, appPath), 'utf8'))
  } catch (error) {
    // A present-but-unreadable file must not be silent — that is the exact
    // "debug a config that was never wrong" trap this loader exists to end.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      process.stderr.write(`bingbong: could not read ${resolveEnvFilePath(env, appPath)}: ${String(error)}\n`)
      // Read at startup, long before any sink exists — the record is a
      // no-op today and correct the moment the loader is called again.
      reportFault('app.envFile.load', error)
    }
    return {}
  }
}
