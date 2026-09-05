import { ipcMain } from 'electron'
import { DIAGNOSTICS_IPC } from '../../core/trace/diagnosticsIpcChannels'
import { rendererReportOf } from '../../core/trace/rendererTrace'
import type { HostTraceWriter } from '../../core/trace/hostTrace'

// The main half of the renderer diagnostics channel (#187, ADR 0031).
// Registered whether or not anything is tracing: the preload always
// exposes `diagnostics.report`, so the page's call has to be answered by
// something, and with `BINGBONG_HOST_TRACE` unset the writer is absent
// and every report is dropped — the same shape every other producer has.
//
// The record is rebuilt from the reported value rather than forwarded
// (`rendererReportOf`), so what lands in the file is assembled main-side
// out of declared fields only. The renderer is the least trusted writer
// in the app and the one closest to the user's own words; it may say what
// happened, not what the file says.

export function registerDiagnosticsIpc(deps: {
  /** The Host Trace writer, or null/absent when the flag is off. */
  hostTrace?: HostTraceWriter | null
}): void {
  const hostTrace = deps.hostTrace ?? null
  ipcMain.on(DIAGNOSTICS_IPC.report, (_event, report: unknown) => {
    if (hostTrace === null) return
    const event = rendererReportOf(report)
    if (event === null) return
    // The writer stamps the clock and the Active Session: a page holds no
    // Session identity it could be trusted to name for a host record.
    hostTrace(() => event)
  })
}
