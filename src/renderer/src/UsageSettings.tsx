import { useEffect, useState } from 'react'
import {
  defaultGauge,
  defaultProviderPrefs,
  type UsagePrefs,
  type UsageProviderPrefs,
  type UsageProviderReport,
  type UsageSnapshot,
} from '../../core/usage/usage'

type Listing = { status: 'loading' } | { status: 'ready'; snapshot: UsageSnapshot } | { status: 'none'; message: string }

/**
 * What the dashboard reports right now, so the settings can list its
 * providers and windows. Read through main from the saved address, and
 * read again when that address is saved anew.
 */
function useUsageListing(savedUrl: string): Listing {
  const [listing, setListing] = useState<Listing>({ status: 'loading' })

  useEffect(() => {
    if (savedUrl.trim() === '') {
      setListing({ status: 'none', message: 'Set the dashboard address to choose what the card shows.' })
      return
    }
    let cancelled = false
    setListing({ status: 'loading' })
    window.bingbong.usage.get().then(
      (snapshot) => {
        if (cancelled) return
        setListing(snapshot === null ? { status: 'none', message: 'No dashboard address saved.' } : { status: 'ready', snapshot })
      },
      () => {
        if (!cancelled) setListing({ status: 'none', message: 'The dashboard is unreachable, so its metrics cannot be listed.' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [savedUrl])

  return listing
}

/** One provider's controls: the dashboard's ⚙ Metrics card — show it, then per window show, gauge and chart. */
function ProviderMetrics({
  provider,
  shown,
  prefs,
  onShown,
  onPrefs,
}: {
  provider: UsageProviderReport
  shown: boolean
  prefs: UsageProviderPrefs
  onShown: (shown: boolean) => void
  onPrefs: (prefs: UsageProviderPrefs) => void
}) {
  const visible = provider.windows.filter((w) => !prefs.hidden.includes(w.key))
  const gauge = visible.find((w) => w.key === prefs.gauge) ?? defaultGauge(visible)
  // Untouched, the chart draws the gauge alone; the first tick writes the list out.
  const chart = prefs.chart ?? (gauge ? [gauge.key] : [])
  const toggle = (list: readonly string[], key: string, on: boolean): string[] =>
    on ? [...new Set([...list, key])] : list.filter((item) => item !== key)

  return (
    <div className="usage-set-card">
      <label className="usage-set-head">
        <input type="checkbox" checked={shown} aria-label={`Show ${provider.name}`} onChange={(event) => onShown(event.target.checked)} />
        <strong>{provider.name}</strong>
        {provider.plan ? <span className="usage-set-plan">{provider.plan}</span> : null}
        {provider.connected ? null : <span className="usage-set-plan">disconnected</span>}
      </label>
      {shown && provider.windows.length > 0 ? (
        <div className="usage-set-table" role="group" aria-label={`${provider.name} metrics`}>
          <span className="usage-set-col" />
          <span className="usage-set-col">show</span>
          <span className="usage-set-col">gauge</span>
          <span className="usage-set-col">chart</span>
          {provider.windows.map((window) => (
            <div key={window.key} className="usage-set-row">
              <span className="usage-set-label">
                <span className="usage-set-name" title={window.label}>
                  {window.label}
                </span>
                <span className="usage-set-hint">{Math.round(window.usedPct)}%</span>
              </span>
              <input
                type="checkbox"
                aria-label={`Show ${provider.name} ${window.label}`}
                checked={!prefs.hidden.includes(window.key)}
                onChange={(event) => onPrefs({ ...prefs, hidden: toggle(prefs.hidden, window.key, !event.target.checked) })}
              />
              <input
                type="radio"
                name={`usage-gauge-${provider.name}`}
                aria-label={`Gauge ${provider.name} ${window.label}`}
                checked={gauge?.key === window.key}
                onChange={() => onPrefs({ ...prefs, gauge: window.key, hidden: toggle(prefs.hidden, window.key, false) })}
              />
              <input
                type="checkbox"
                aria-label={`Chart ${provider.name} ${window.label}`}
                checked={chart.includes(window.key)}
                onChange={(event) => onPrefs({ ...prefs, chart: toggle(chart, window.key, event.target.checked) })}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The AI Usage card's choices (CONTEXT.md), as the usage dashboard's own
 * ⚙ Metrics panel offers them: which providers the card shows, and for
 * each which windows sit on it, which one fills the dot gauge and which
 * are drawn on the chart. Kept in Bing Bong's settings — the dashboard
 * keeps its own in that browser's storage, out of reach. Edits the page's
 * draft like every other field; Save applies them.
 */
export function UsageMetricsSettings({
  savedUrl,
  value,
  onChange,
}: {
  savedUrl: string
  value: UsagePrefs
  onChange: (next: UsagePrefs) => void
}) {
  const listing = useUsageListing(savedUrl)
  if (listing.status === 'loading') return <p className="settings-note">Loading the dashboard’s metrics…</p>
  if (listing.status === 'none') return <p className="settings-note">{listing.message}</p>
  return (
    <div className="usage-set">
      {listing.snapshot.providers.map((provider) => (
        <ProviderMetrics
          key={provider.name}
          provider={provider}
          shown={value.providers.includes(provider.name)}
          prefs={value.metrics[provider.name] ?? defaultProviderPrefs()}
          onShown={(shown) =>
            onChange({
              ...value,
              providers: shown ? [...new Set([...value.providers, provider.name])] : value.providers.filter((name) => name !== provider.name),
            })
          }
          onPrefs={(prefs) => onChange({ ...value, metrics: { ...value.metrics, [provider.name]: prefs } })}
        />
      ))}
    </div>
  )
}
