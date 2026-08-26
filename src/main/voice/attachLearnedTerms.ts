import { BrowserWindow, ipcMain } from 'electron'
import { LEARNED_TERMS_IPC } from '../../core/voice/learnedTermsIpcChannels'
import type { LearnedTermsStore } from './learnedTermsStore'

// Glue between the settings page's Learned Terms section and the ledger.
// The store owns the recurrence gate, rejection marks and persistence
// (unit-tested); this file only bridges IPC and is covered by typecheck +
// the store tests, mirroring attachSettings.ts.

export function registerLearnedTermsIpc(store: LearnedTermsStore): void {
  ipcMain.handle(LEARNED_TERMS_IPC.list, () => store.list())
  ipcMain.handle(LEARNED_TERMS_IPC.add, (_event, raw: unknown) =>
    typeof raw === 'string' ? store.manualAdd(raw) : false)
  ipcMain.handle(LEARNED_TERMS_IPC.remove, (_event, raw: unknown) =>
    typeof raw === 'string' ? store.manualRemove(raw) : false)

  // Auto-admissions reach every open settings page too — the lexicon is
  // one app-global ledger, whichever window's run grew it.
  store.onChange((terms) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(LEARNED_TERMS_IPC.changed, terms)
    }
  })
}
