import { ipcMain } from 'electron'
import type { HostFinding } from '../../core/settings/hostFindings'
import { SETTINGS_IPC } from '../../core/settings/ipcChannels'

/** The Settings page reads what the boot-time host checks found (#419). */
export function registerHostChecksIpc(findings: readonly HostFinding[]): void {
  ipcMain.handle(SETTINGS_IPC.hostChecks, () => findings)
}
