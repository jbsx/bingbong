import type { WeatherReport } from './weather'

/** The Idle Screen's background glow (CONTEXT.md): one colour a weather, mixed into the canvas from above the top edge. */
export type WeatherGlow = 'rain' | 'cloud' | 'sun' | 'night'

/** A Date's local wall clock as the forecast writes its times: `YYYY-MM-DDTHH:MM`, so the two compare as strings. */
function wallClock(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Whether the sun is down at `now`: before today's sunrise or from its sunset, else the report's own reading. */
function isNight(report: WeatherReport, now: Date): boolean {
  const sunrise = report.today?.sunrise ?? null
  const sunset = report.today?.sunset ?? null
  if (sunrise !== null && sunset !== null) {
    const at = wallClock(now)
    return at < sunrise || at >= sunset
  }
  return report.isDay === false
}

/**
 * The glow the current weather gives the Idle Screen: rain for anything
 * falling, cloud for overcast and fog, and a clear or partly cloudy sky is
 * sun while the sun is up and night from sunset to sunrise. No weather, or
 * a sky it cannot name, has none.
 */
export function weatherGlow(report: WeatherReport | null, now: Date): WeatherGlow | null {
  switch (report?.sky) {
    case 'drizzle':
    case 'rain':
    case 'freezing':
    case 'showers':
    case 'snow':
    case 'thunder':
      return 'rain'
    case 'cloudy':
    case 'fog':
      return 'cloud'
    case 'clear':
    case 'partly-cloudy':
      return isNight(report, now) ? 'night' : 'sun'
    default:
      return null
  }
}
