import { parseDotEnv } from '../../core/settings/dotEnv.ts'

// `pnpm logs:pull [machine] [dir]` (#418): copy one machine's folder of the
// Log Bucket to a local folder, which perf:report, jev:candidates and the
// bugs scripts then read as any logs dir. The R2 remote and the bucket come
// from the root .env, the same RCLONE_CONFIG_R2_* lines the kiosk's sidecar
// reads; the process environment wins, as it does for the app.

const SETTING = /^(BINGBONG_LOG_[A-Z0-9_]+|RCLONE_CONFIG_R2_[A-Z0-9_]+)$/

export type LogsPullPlan =
  | { dir: string; argv: string[]; env: Record<string, string> }
  | { missing: string[] }

export function planLogsPull(
  args: readonly string[],
  dotEnvText: string,
  processEnv: Record<string, string | undefined>,
): LogsPullPlan {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(parseDotEnv(dotEnvText))) if (SETTING.test(key)) env[key] = value
  for (const [key, value] of Object.entries(processEnv)) if (SETTING.test(key) && value !== undefined) env[key] = value

  const missing = ['BINGBONG_LOG_BUCKET', 'RCLONE_CONFIG_R2_TYPE'].filter((key) => !env[key]?.trim())
  if (missing.length > 0) return { missing }

  const machine = args[0]?.trim() || 'kiosk'
  const dir = args[1]?.trim() || `kiosk-logs/${machine}`
  return { dir, argv: ['copy', `r2:${env.BINGBONG_LOG_BUCKET}/${machine}/`, dir], env }
}
