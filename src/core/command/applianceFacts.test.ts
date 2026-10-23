import { describe, expect, it } from 'vitest'
import type { WeatherReport } from '../weather/weather'
import { factAnswer, factOfLabel, factsOffered, factValue, sayOptions, withPageSong, type ApplianceFacts } from './applianceFacts'

// 2026-10-23 12:34 in London (BST).
const NOW = Date.UTC(2026, 9, 23, 11, 34)

const LONDON: WeatherReport = {
  city: 'London',
  temperature: 13.4,
  units: 'metric',
  description: 'Partly cloudy',
  today: { high: 15.2, low: 8, precipitationChance: 20, sunrise: null, sunset: null },
  hours: [{ time: '2026-10-23T13:00', temperature: 14, description: 'Partly cloudy', sky: 'partly-cloudy', isDay: true, precipitationChance: 10 }],
  days: [{ date: '2026-10-24', high: 14, low: 9, description: 'Rain', sky: 'rain', precipitationChance: 70 }],
}

const FACTS: ApplianceFacts = {
  now: NOW,
  timeZone: 'Europe/London',
  weather: LONDON,
  nowPlaying: { id: 'x', title: 'Highs and Lows', channel: 'Ye', elapsedS: 62, durationS: 215, paused: false, loop: false, muted: false, ended: false, queued: [] },
  timer: { status: 'running', durationMs: 25 * 60_000, endsAt: NOW + 8 * 60_000 + 20_000 },
}

describe('the facts the appliance holds (#402)', () => {
  it('offers the clock and the weather always, the song and the Timer while their feature is wired', () => {
    expect(factsOffered(FACTS)).toEqual(['time', 'weather', 'playing', 'timer'])
    expect(factsOffered({ now: NOW, timeZone: 'Europe/London', weather: null })).toEqual(['time', 'weather'])
  })

  it('gives each option its fact on its line, the weather naming its city as the only place it answers for', () => {
    const options = sayOptions(FACTS)
    expect(Object.keys(options)).toEqual(['say_time', 'say_weather', 'say_playing', 'say_timer'])
    expect(options.say_time).toBe('appliance: say the time and date — 12:34, Friday 23 October')
    expect(options.say_weather).toMatch(/^appliance: say today's weather in London, the home city — words naming another place or a website are a search, not this — London: 13°C, partly cloudy now; today high 15°C, low 8°C, rain 20%; coming hours 13:00 14°C; coming days 2026-10-24 14°C\/9°C Rain, rain 70%$/)
    expect(options.say_playing).toBe('appliance: say the song playing — "Highs and Lows" by Ye, 1:02 of 3:35')
    expect(options.say_timer).toBe('appliance: say how long is left on the timer — 8 minutes 20 seconds left of 25 minutes')
  })

  it('says what it lacks on the line, so a question with nothing to answer it still has its option', () => {
    const empty: ApplianceFacts = { now: NOW, timeZone: 'Europe/London', weather: null, nowPlaying: null, timer: { status: 'off' } }
    expect(factValue('weather', empty)).toBe('no forecast yet')
    expect(factValue('playing', empty)).toBe('nothing playing')
    expect(factValue('timer', empty)).toBe('no timer set')
    expect(factValue('timer', { ...empty, timer: { status: 'ringing', durationMs: 60_000, rangAt: NOW } })).toBe('ringing: the time is up')
  })

  it('answers each in a fixed sentence filled from the facts, its units in words for the voice', () => {
    expect(factAnswer('time', FACTS)).toBe("It's 12:34 on Friday 23 October.")
    expect(factAnswer('weather', FACTS)).toBe("In London it's 13 degrees and partly cloudy, with a high of 15 and a low of 8 and a 20 percent chance of rain.")
    expect(factAnswer('playing', FACTS)).toBe('Playing “Highs and Lows” by Ye, 1:02 of 3:35.')
    expect(factAnswer('playing', { ...FACTS, nowPlaying: null })).toBe('Nothing is playing.')
    expect(factAnswer('timer', FACTS)).toBe('8 minutes 20 seconds left on the timer.')
    expect(factAnswer('timer', { ...FACTS, timer: { status: 'off' } })).toBe('No timer is running.')
    expect(factAnswer('weather', { ...FACTS, weather: null })).toBe("There's no forecast yet: set a weather city in settings.")
  })

  it("takes the page's own song when the Player holds none, and never over the Player's", () => {
    const media = { title: 'YE - HIGHS AND LOWS', paused: false, currentTime: 7, duration: 111, loop: false, muted: false }
    const none = { ...FACTS, nowPlaying: null }
    expect(factAnswer('playing', withPageSong(none, media))).toBe('Playing “YE - HIGHS AND LOWS”, 0:07 of 1:51.')
    expect(withPageSong(none, undefined)).toBe(none)
    expect(withPageSong(FACTS, media)).toBe(FACTS)
    // A live stream has no length to say.
    expect(factValue('playing', withPageSong(none, { ...media, duration: Infinity }))).toBe('"YE - HIGHS AND LOWS"')
  })

  it('reads a fact back off its label, and nothing off any other', () => {
    expect(factOfLabel('say_weather')).toBe('weather')
    expect(factOfLabel('say')).toBeNull()
    expect(factOfLabel('click-3')).toBeNull()
  })

})
