import { describe, expect, it } from 'vitest'
import { WEATHER_CITIES, weatherCityOptions } from './cities'

describe('weatherCityOptions', () => {
  it('lists Automatic first, then the cities in order', () => {
    const options = weatherCityOptions('')
    expect(options[0]).toBe('')
    expect(options.slice(1)).toEqual([...WEATHER_CITIES].sort((a, b) => a.localeCompare(b)))
  })

  it('keeps a saved city the list lacks, in its alphabetical place', () => {
    const options = weatherCityOptions('Kyoto')
    expect(options).toHaveLength(WEATHER_CITIES.length + 2)
    expect(options.indexOf('Kyoto')).toBe(options.indexOf('Kolkata') + 1)
  })

  it('adds nothing for a listed city', () => {
    expect(weatherCityOptions('London')).toHaveLength(WEATHER_CITIES.length + 1)
  })
})
