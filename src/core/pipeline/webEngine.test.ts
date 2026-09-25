import { describe, expect, it } from 'vitest'
import { searchUrl } from '../browser/urlInput'
import { DEFAULT_RUN_ENGINE, WEB_ENGINES, runEngineOf, webEngineOfHost, webEngineSearchOf } from './webEngine'

const nameOf = (host: string): string | null => webEngineOfHost(host)?.name ?? null

describe('the Web Engine list (#270, ADR 0066)', () => {
  it('is one fixed list, DuckDuckGo the Run Engine by default', () => {
    expect(WEB_ENGINES.map((engine) => engine.name)).toEqual([
      'google',
      'bing',
      'duckduckgo',
      'yahoo',
      'yandex',
      'baidu',
      'brave',
      'startpage',
      'ecosia',
      'mojeek',
      'qwant',
      'kagi',
    ])
    expect(DEFAULT_RUN_ENGINE.name).toBe('duckduckgo')
  })

  it('knows an engine by its registrable domain, on any subdomain and any country suffix', () => {
    expect(nameOf('www.google.com')).toBe('google')
    expect(nameOf('www.google.co.uk')).toBe('google')
    expect(nameOf('google.de')).toBe('google')
    expect(nameOf('www.bing.com')).toBe('bing')
    expect(nameOf('duckduckgo.com')).toBe('duckduckgo')
    expect(nameOf('html.duckduckgo.com')).toBe('duckduckgo')
    expect(nameOf('search.yahoo.com')).toBe('yahoo')
    expect(nameOf('yandex.ru')).toBe('yandex')
    expect(nameOf('WWW.BAIDU.COM')).toBe('baidu')
  })

  it('knows Brave only by its search host: brave.com is a browser vendor’s site', () => {
    expect(nameOf('search.brave.com')).toBe('brave')
    expect(nameOf('brave.com')).toBeNull()
    expect(nameOf('www.brave.com')).toBeNull()
  })

  it('knows no other site, however close its name', () => {
    expect(nameOf('www.rmg.co.uk')).toBeNull()
    expect(nameOf('googleblog.com')).toBeNull()
    expect(nameOf('bingo.com')).toBeNull()
    expect(nameOf('science.nasa.gov')).toBeNull()
  })
})

describe('webEngineSearchOf (#270)', () => {
  it('reads a Google, Bing or Yahoo search with its terms, each by its own parameter', () => {
    expect(webEngineSearchOf('https://www.google.com/search?q=longitude+watch+1938&hl=en')).toMatchObject({ engine: { name: 'google' }, query: 'longitude watch 1938' })
    expect(webEngineSearchOf('https://www.bing.com/search?q=Voyager%201%20heliopause')).toMatchObject({ engine: { name: 'bing' }, query: 'Voyager 1 heliopause' })
    expect(webEngineSearchOf('https://search.yahoo.com/search?p=Eurostar+pets')).toMatchObject({ engine: { name: 'yahoo' }, query: 'Eurostar pets' })
    expect(webEngineSearchOf('https://yandex.com/search/?text=pi+camera')).toMatchObject({ engine: { name: 'yandex' }, query: 'pi camera' })
    expect(webEngineSearchOf('https://www.baidu.com/s?wd=voyager')).toMatchObject({ engine: { name: 'baidu' }, query: 'voyager' })
  })

  it('reads plain terms as the DuckDuckGo search the browser composes', () => {
    expect(webEngineSearchOf('longitude watch RMG')).toMatchObject({ engine: { name: 'duckduckgo' }, query: 'longitude watch RMG' })
    expect(webEngineSearchOf('https://html.duckduckgo.com/html/?q=voyager')).toMatchObject({ engine: { name: 'duckduckgo' }, query: 'voyager' })
  })

  it('is null for a site’s own search, an engine page carrying no terms, and a plain page', () => {
    expect(webEngineSearchOf('https://www.rmg.co.uk/search?q=longitude')).toBeNull()
    expect(webEngineSearchOf('https://www.google.com/')).toBeNull()
    expect(webEngineSearchOf('https://www.google.com/search?q=')).toBeNull()
    expect(webEngineSearchOf('https://brave.com/search?q=browser')).toBeNull()
    expect(webEngineSearchOf('https://science.nasa.gov/voyager')).toBeNull()
  })

  it('builds each engine’s Search URL, DuckDuckGo’s being the browser’s own', () => {
    expect(DEFAULT_RUN_ENGINE.searchUrl('voyager 1 "heliopause"')).toBe(searchUrl('voyager 1 "heliopause"'))
    for (const engine of WEB_ENGINES) {
      expect(webEngineSearchOf(engine.searchUrl('pi camera v3'))).toMatchObject({ engine: { name: engine.name }, query: 'pi camera v3' })
    }
  })
})

describe('runEngineOf (#270): the engine the user named in their own words, else DuckDuckGo', () => {
  it('is DuckDuckGo when the user named none', () => {
    expect(runEngineOf([]).name).toBe('duckduckgo')
    expect(runEngineOf(['When was the RMG’s longitude watch made?']).name).toBe('duckduckgo')
  })

  it('honours an engine the user asked to search with', () => {
    expect(runEngineOf(['search google for the Voyager heliopause date']).name).toBe('google')
    expect(runEngineOf(['Google it: Eurostar pet policy']).name).toBe('google')
    expect(runEngineOf(['find the pi camera price on Bing']).name).toBe('bing')
    expect(runEngineOf(['look it up on duck duck go']).name).toBe('duckduckgo')
    expect(runEngineOf(['use Brave Search for this']).name).toBe('brave')
    expect(runEngineOf(['try yahoo']).name).toBe('yahoo')
  })

  it('never reads a company or product the command is about as an engine', () => {
    expect(runEngineOf(['What did Google announce at I/O this year?']).name).toBe('duckduckgo')
    expect(runEngineOf(['how much is a Google Pixel 9']).name).toBe('duckduckgo')
    expect(runEngineOf(['what’s the latest in Google’s antitrust case']).name).toBe('duckduckgo')
    expect(runEngineOf(['is Brave a good browser']).name).toBe('duckduckgo')
  })

  it('takes the last engine named: a Steering directive after the command overrides it', () => {
    expect(runEngineOf(['search google for Voyager', 'actually use bing instead']).name).toBe('bing')
    expect(runEngineOf(['search on bing, not google']).name).toBe('bing')
    expect(runEngineOf(['search google for Voyager', 'only the 2013 announcement']).name).toBe('google')
  })
})
