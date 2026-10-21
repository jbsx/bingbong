import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../core/settings/settings'
import { SettingsPage } from './SettingsPage'

// The Settings page's words for the Idle Screen's cards and the Weight
// section, rendered from a fresh profile's settings.

function page(): string {
  return renderToStaticMarkup(createElement(SettingsPage, { settings: defaultSettings(), onSave: async () => {}, onClose: () => {} }))
}

describe('SettingsPage', () => {
  it('names the Top Repos card as the screen titles it', () => {
    const html = page()
    expect(html).toContain('aria-label="Show Top Repos"')
    expect(html).not.toContain('aria-label="Show News"')
  })

  it('places Now Playing in the middle, over the AI usage, and leaves it out of the lines under the clock (#365)', () => {
    const html = page()
    expect(html).toContain('middle, over the AI usage')
    expect(html).toContain('The Last Page is a line under the clock.')
    expect(html).not.toContain('Now Playing and the Last Page')
  })

  it('says kilograms only at the Weight heading, not under the pop-up linger', () => {
    const html = page()
    const weight = html.slice(html.indexOf('aria-label="weight"'))
    const summary = weight.slice(0, weight.indexOf('</summary>'))
    expect(summary).toContain('kilograms only')
    expect(html).not.toContain('Kilograms only.')
  })
})
