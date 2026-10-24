import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ipcMain, shell } from 'electron'
import { parseDotEnv } from '../../core/settings/dotEnv'
import { envEntries, isEnvKey, setEnvValue, type EnvFileView } from '../../core/settings/envEntries'
import { SETTINGS_IPC } from '../../core/settings/ipcChannels'
import { reportFault } from '../../core/trace/fault'

// Glue between the Settings page's Environment section and the `.env` (#76).
// The edit itself is core/settings/envEntries (unit-tested); this file reads,
// writes and opens the file and hands main the new values after each write.

export interface EnvFileIpcOptions {
  path: string
  processEnv: Record<string, string | undefined>
  /** The file's values after a write, for currentEnv() to read live. */
  onWritten(values: Record<string, string>): void
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reportFault('settings.envFile.read', error)
    return ''
  }
}

export function registerEnvFileIpc({ path, processEnv, onWritten }: EnvFileIpcOptions): void {
  const view = (): EnvFileView => ({ path, exists: existsSync(path), entries: envEntries(readText(path), processEnv) })

  ipcMain.handle(SETTINGS_IPC.envList, () => view())
  ipcMain.handle(SETTINGS_IPC.envSet, (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !isEnvKey(key)) throw new Error('not an env var name')
    if (value !== null && typeof value !== 'string') throw new Error('a value is a string, or null to remove')
    const text = setEnvValue(readText(path), key, value)
    writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 })
    onWritten(parseDotEnv(text))
    return view()
  })
  ipcMain.handle(SETTINGS_IPC.envOpen, async () => {
    if (!existsSync(path)) writeFileSync(path, '', { encoding: 'utf8', mode: 0o600 })
    // openPath answers an error message, empty on success.
    return shell.openPath(path)
  })
}
