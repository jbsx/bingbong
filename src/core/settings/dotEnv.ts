// .env loading (#76): the file next to the app is real configuration — the
// routing and credentials that otherwise come from exported env vars. The
// parse and layer functions are pure so the precedence (.env below
// process.env, settings-page values layered on top by the caller) is plain
// unit-testable code; only the file read lives in the main process.

/**
 * Parse `.env` text into values. Malformed lines (no `=`, a key that isn't a
 * env-var name) are ignored — one bad line never takes the config down.
 * Comment (`#`) and blank lines are skipped; an optional `export ` prefix,
 * surrounding single/double quotes and CRLF endings are handled.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (line === '' || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    values[match[1]] = unquote(match[2].trim())
  }
  return values
}

/** Strip one pair of matching quotes; double quotes unescape \n, \" and \\. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\(.)/g, (_, ch: string) => (ch === 'n' ? '\n' : ch))
  }
  return value
}

/**
 * Layer parsed `.env` values under the process env: a key set in the process
 * always wins; `.env` only fills gaps. The caller layers settings-page values
 * (settingsToEnv) on top of the result, completing the
 * .env < process.env < settings precedence.
 */
export function layerEnv(
  envFile: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const layered: Record<string, string | undefined> = { ...processEnv }
  for (const [key, value] of Object.entries(envFile)) {
    if (layered[key] === undefined) layered[key] = value
  }
  return layered
}
