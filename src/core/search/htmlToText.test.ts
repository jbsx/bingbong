import { describe, expect, it } from 'vitest'
import { htmlToText } from './htmlToText'

// Minimal HTML→text for research subagents: drop script/style/head noise,
// keep block structure as newlines, decode the common entities. It is an
// excerpt for a model, not a browser-grade extractor.

describe('htmlToText', () => {
  it('extracts readable text and drops scripts, styles and comments', () => {
    const html = `
      <html>
        <head><title>Ignored title tag</title><style>body { color: red }</style></head>
        <body>
          <!-- a comment -->
          <script>console.log('nope')</script>
          <h1>Keyboards worth buying</h1>
          <p>The best boards of 2026. <a href="/x">Details</a>.</p>
        </body>
      </html>
    `
    const text = htmlToText(html)
    expect(text).toContain('Keyboards worth buying')
    expect(text).toContain('The best boards of 2026. Details.')
    expect(text).not.toContain('console.log')
    expect(text).not.toContain('color: red')
    expect(text).not.toContain('Ignored title tag')
    expect(text).not.toContain('<!--')
  })

  it('keeps block structure so headings and paragraphs stay separated', () => {
    const text = htmlToText('<h2>One</h2><p>Two</p><div>Three</div><span>Four</span>')
    expect(text.split('\n').map((line) => line.trim()).filter(Boolean)).toEqual(['One', 'Two', 'Three', 'Four'])
  })

  it('decodes the common entities', () => {
    const text = htmlToText('<p>Fish &amp; chips &lt;3 &#8212; done &quot;ok&quot; &#39;fine&#39;</p>')
    expect(text).toContain('Fish & chips <3 — done "ok" \'fine\'')
  })

  it('caps the excerpt length at a model-friendly size', () => {
    const text = htmlToText(`<p>${'x'.repeat(50_000)}</p>`)
    expect(text.length).toBeLessThanOrEqual(8_000)
  })

  it('returns empty string for non-HTML input that is only tags', () => {
    expect(htmlToText('<br><hr>')).toBe('')
  })
})
