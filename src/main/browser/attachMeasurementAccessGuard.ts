import type { Session } from 'electron'
import { measurementAccessGuardEnabled, measurementGuardRefuses } from '../../core/browser/measurementAccessGuard'
import { reportFault } from '../../core/trace/fault'

// Electron glue for the measurement access guard (#224): composed at the
// browse partition's own protocol layer, which every path to the pane
// shares — the main pane, worker tabs, auth popups, redirects and clicks
// alike — and which the adblocker's webRequest listeners never touch, so
// enabling one cannot unregister the other (Electron allows one
// webRequest listener per event; this is not one). The dashboard and
// overlay renderers load from the default session and are unaffected.
//
// With the flag unset nothing is registered: production is unchanged.

export interface MeasurementAccessGuardAttachment {
  readonly enabled: boolean
  dispose(): void
}

export function attachMeasurementAccessGuard(deps: {
  session: Session
  env: Record<string, string | undefined>
}): MeasurementAccessGuardAttachment {
  if (!measurementAccessGuardEnabled(deps.env)) return { enabled: false, dispose() {} }
  const { protocol } = deps.session
  protocol.handle('file', (request) => {
    const reason = measurementGuardRefuses(request.url) ?? 'measurement access guard: refused'
    // The refusal is a finding, never silent: what the assistant tried
    // to reach is what the capture must show.
    process.stderr.write(`bingbong: ${reason} (${request.url})\n`)
    reportFault('browser.attachMeasurementAccessGuard.refused', reason, undefined)
    return new Response(reason, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  })
  return {
    enabled: true,
    dispose() {
      try {
        protocol.unhandle('file')
      } catch (error) {
        reportFault('browser.attachMeasurementAccessGuard.dispose', error)
      }
    },
  }
}
