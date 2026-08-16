import { describe, expect, it } from 'vitest'
import { urlBarNavigationScript } from './scripts'

describe('urlBarNavigationScript', () => {
  it('embeds the URL as a JSON string literal', () => {
    const script = urlBarNavigationScript('http://127.0.0.1:1234/')
    expect(script).toContain('"http://127.0.0.1:1234/"')
  })

  it('escapes hostile URLs so they stay inside the string literal', () => {
    const hostile = 'http://x/"><script>globalThis.pwned=1</script>'
    const script = urlBarNavigationScript(hostile)
    expect(script).toContain(JSON.stringify(hostile))
  })

  it('focuses before setting the value (React controlled input resets when not editing)', () => {
    const script = urlBarNavigationScript('http://example.com/')
    expect(script.indexOf('.focus()')).toBeLessThan(script.indexOf('HTMLInputElement.prototype'))
  })

  it('drives the React input via the native setter and submits the form', () => {
    const script = urlBarNavigationScript('http://example.com/')
    expect(script).toContain("dispatchEvent(new Event('input', { bubbles: true }))")
    expect(script).toContain("querySelector('.url-form').requestSubmit()")
  })
})
