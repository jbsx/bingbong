import { ipcMain } from 'electron'
import { WEATHER_IPC } from '../../core/weather/ipcChannels'
import type { WeatherReport } from '../../core/weather/weather'

/** The weather main holds (#402): the last report the Idle Screen's fetch handed it, null when it has none. */
export interface WeatherFacts {
  latest(): WeatherReport | null
}

/**
 * The weather's IPC (#402): the renderer fetches the settings city's
 * report for the Idle Screen and sends main every one it shows — null
 * when the city is unset or the report failed — so the answer to "what's
 * the weather like" is the report on the screen, from one fetch.
 */
export function registerWeatherIpc(): WeatherFacts {
  let latest: WeatherReport | null = null
  ipcMain.on(WEATHER_IPC.report, (_event, report: unknown) => {
    latest = isReport(report) ? report : null
  })
  return { latest: () => latest }
}

function isReport(value: unknown): value is WeatherReport {
  const report = value as Partial<WeatherReport> | null
  return report !== null && typeof report === 'object' && typeof report.city === 'string' && typeof report.temperature === 'number' && typeof report.description === 'string'
}
