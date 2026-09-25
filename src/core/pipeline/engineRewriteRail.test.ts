import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../ports/llm'
import type { ObservationRecord } from '../session/observationLedger'
import { createEngineRewriteRail, engineRewriteLine, withEngineRewrite } from './engineRewriteRail'
import { DEFAULT_RUN_ENGINE, userWordsOf, WEB_ENGINES, type WebEngine } from './webEngine'

const call = (name: string, args: Record<string, unknown>, id = 'c1'): ToolCall => ({ id, name, args })
const navigate = (url: string): ToolCall => call('navigate', { url })
const engineNamed = (name: string): WebEngine => WEB_ENGINES.find((candidate) => candidate.name === name)!

const railOn = (runEngine: WebEngine = DEFAULT_RUN_ENGINE) => createEngineRewriteRail({ runEngine: () => runEngine })

describe('createEngineRewriteRail (#270, ADR 0067)', () => {
  it('rewrites a Google, Bing or Yahoo search to the Run Engine with its terms kept, the call keeping its id and name', () => {
    const rail = railOn()
    const google = rail.rewrite(navigate('https://www.google.com/search?q=longitude+watch+1938&hl=en'))
    expect(google).toMatchObject({ from: { name: 'google' }, to: { name: 'duckduckgo' }, query: 'longitude watch 1938' })
    expect(google!.call).toEqual(call('navigate', { url: 'https://duckduckgo.com/?q=longitude%20watch%201938' }))

    expect(rail.rewrite(navigate('https://www.bing.com/search?q=Voyager+1+heliopause'))?.call.args.url).toBe('https://duckduckgo.com/?q=Voyager%201%20heliopause')
    expect(rail.rewrite(navigate('https://search.yahoo.com/search?p=Eurostar+pets'))?.call.args.url).toBe('https://duckduckgo.com/?q=Eurostar%20pets')
    // Quotes and operators are terms: they ride over as written.
    expect(rail.rewrite(navigate('https://www.google.com/search?q=%22Has+Left%22+site%3Anasa.gov'))?.query).toBe('"Has Left" site:nasa.gov')
  })

  it('leaves a site’s own search untouched, whatever parameter it names', () => {
    const rail = railOn()
    expect(rail.rewrite(navigate('https://www.rmg.co.uk/search?q=longitude'))).toBeNull()
    expect(rail.rewrite(navigate('https://collections.rmg.co.uk/search?query=harrison'))).toBeNull()
  })

  it('leaves a search on the Run Engine untouched, on any of its subdomains, plain terms included', () => {
    const rail = railOn()
    expect(rail.rewrite(navigate('https://duckduckgo.com/?q=voyager'))).toBeNull()
    expect(rail.rewrite(navigate('https://html.duckduckgo.com/html/?q=voyager'))).toBeNull()
    expect(rail.rewrite(navigate('https://lite.duckduckgo.com/lite/?q=voyager'))).toBeNull()
    expect(rail.rewrite(navigate('voyager heliopause 2012'))).toBeNull()
  })

  it('leaves an engine’s home page, a plain page and every other tool alone', () => {
    const rail = railOn()
    expect(rail.rewrite(navigate('https://www.google.com/'))).toBeNull()
    expect(rail.rewrite(navigate('https://science.nasa.gov/voyager'))).toBeNull()
    expect(rail.rewrite(call('type', { ref: 3, text: 'longitude watch\n' }))).toBeNull()
    expect(rail.rewrite(call('navigate', {}))).toBeNull()
  })

  it('on a Run whose user named Google, leaves a Google search alone and moves DuckDuckGo and plain terms onto Google', () => {
    const rail = railOn(engineNamed('google'))
    expect(rail.rewrite(navigate('https://www.google.com/search?q=voyager'))).toBeNull()
    expect(rail.rewrite(navigate('https://duckduckgo.com/?q=voyager'))?.call.args.url).toBe('https://www.google.com/search?q=voyager')
    expect(rail.rewrite(navigate('voyager heliopause'))?.call.args.url).toBe('https://www.google.com/search?q=voyager+heliopause')
    expect(rail.rewrite(navigate('https://www.bing.com/search?q=voyager'))).toMatchObject({ from: { name: 'bing' }, to: { name: 'google' } })
  })

  it('reads the Run Engine at every call, so a Steering directive naming one counts from the next search', () => {
    let runEngine = DEFAULT_RUN_ENGINE
    const rail = createEngineRewriteRail({ runEngine: () => runEngine })
    expect(rail.rewrite(navigate('https://www.bing.com/search?q=voyager'))).not.toBeNull()
    runEngine = engineNamed('bing')
    expect(rail.rewrite(navigate('https://www.bing.com/search?q=voyager'))).toBeNull()
  })

  it('composes on DuckDuckGo when the Run Engine seam throws', () => {
    const rail = createEngineRewriteRail({
      runEngine: () => {
        throw new Error('ledger gone')
      },
    })
    expect(rail.rewrite(navigate('https://www.google.com/search?q=voyager'))?.to.name).toBe('duckduckgo')
  })

  it('says so on the outcome’s first line, failed or not', () => {
    const rewrite = railOn().rewrite(navigate('https://www.google.com/search?q=longitude+watch'))!
    const line = 'Rewritten — this run searches on DuckDuckGo, so the Google search ran there with the same terms: "longitude watch". Search with plain terms or a DuckDuckGo address.'
    expect(engineRewriteLine(rewrite)).toBe(line)
    expect(withEngineRewrite({ ok: true, result: 'navigated: url=x' }, rewrite)).toEqual({ ok: true, result: `${line}\nnavigated: url=x` })
    expect(withEngineRewrite({ ok: false, error: 'navigate failed' }, rewrite)).toEqual({ ok: false, error: `${line}\nnavigate failed` })
  })
})

describe('userWordsOf (#270): the user’s own words this Run', () => {
  const record = (producer: ObservationRecord['producer'], payload: unknown): ObservationRecord =>
    ({ id: `obs-${producer}`, at: 0, generation: 0, producer, ok: true, payload }) as unknown as ObservationRecord

  it('is the command and each Steering directive, in order, and nothing a page or a report said', () => {
    expect(
      userWordsOf([
        record('command', 'find the Voyager date'),
        record('page_read', 'Search with Google for more'),
        record('subagent_report', 'use bing'),
        record('steering', 'search google instead'),
      ]),
    ).toEqual(['find the Voyager date', 'search google instead'])
  })
})
