import { describe, expect, it } from 'vitest'
import { pageContextMenuItems, type PageContextMenuParams } from './contextMenu'

// The reconstructed page menu (the appliance input pass, with ADR 0020 and ADR 0021): Electron cannot show
// Chromium's native context menu — the app rebuilds it item by item. The
// appliance cut is pinned here: navigation, honest link items, clipboard
// verbs, image copies; no Save As, no Print, no Inspect, and never a
// new-tab item for a browser that has no tabs.

function params(overrides: Partial<PageContextMenuParams> = {}): PageContextMenuParams {
  return { ...overrides }
}

function labels(items: ReturnType<typeof pageContextMenuItems>): string[] {
  return items.filter((item) => item.kind === 'item').map((item) => (item as { label: string }).label)
}

describe('pageContextMenuItems', () => {
  it('a plain page shows the navigation trio, Back/Forward gated on history', () => {
    const fresh = pageContextMenuItems(params())
    expect(labels(fresh)).toEqual(['Back', 'Forward', 'Reload'])
    expect(fresh.map((i) => (i.kind === 'item' ? `${i.label}:${i.enabled}` : 'sep'))).toEqual([
      'Back:false',
      'Forward:false',
      'Reload:true',
    ])

    const browsed = pageContextMenuItems(params({ canGoBack: true, canGoForward: true }))
    expect(browsed.map((i) => (i.kind === 'item' ? `${i.label}:${i.enabled}` : 'sep'))).toEqual([
      'Back:true',
      'Forward:true',
      'Reload:true',
    ])
  })

  it('a link offers Open Link and Copy Link Address above the navigation', () => {
    const items = pageContextMenuItems(params({ linkURL: 'https://example.com/page', canGoBack: true }))
    expect(items).toEqual([
      { kind: 'item', action: 'openLink', label: 'Open Link', enabled: true },
      { kind: 'item', action: 'copyLink', label: 'Copy Link Address', enabled: true },
      { kind: 'separator' },
      { kind: 'item', action: 'back', label: 'Back', enabled: true },
      { kind: 'item', action: 'forward', label: 'Forward', enabled: false },
      { kind: 'item', action: 'reload', label: 'Reload', enabled: true },
    ])
  })

  it('a page selection offers Copy, enabled only with real text', () => {
    const items = pageContextMenuItems(params({ selectionText: 'chosen words' }))
    expect(items[0]).toEqual({ kind: 'item', action: 'copy', label: 'Copy', enabled: true })
    expect(items[1]).toEqual({ kind: 'separator' })
    expect(labels(items)).toContain('Back')

    const blank = pageContextMenuItems(params({ selectionText: '  ' }))
    expect(labels(blank)).not.toContain('Copy')
  })

  it('an editable field offers Cut/Copy/Paste gated on the edit flags', () => {
    const items = pageContextMenuItems(
      params({ isEditable: true, editFlags: { canCut: true, canCopy: false, canPaste: true } }),
    )
    expect(items.slice(0, 3)).toEqual([
      { kind: 'item', action: 'cut', label: 'Cut', enabled: true },
      { kind: 'item', action: 'copy', label: 'Copy', enabled: false },
      { kind: 'item', action: 'paste', label: 'Paste', enabled: true },
    ])
    expect(items[3]).toEqual({ kind: 'separator' })
  })

  it('an image offers Copy Image and Copy Image Address below the rest', () => {
    const items = pageContextMenuItems(params({ mediaType: 'image', srcURL: 'https://example.com/cat.png' }))
    expect(items.slice(-3)).toEqual([
      { kind: 'separator' },
      { kind: 'item', action: 'copyImage', label: 'Copy Image', enabled: true },
      { kind: 'item', action: 'copyImageUrl', label: 'Copy Image Address', enabled: true },
    ])
    // An image without a source address copies nothing.
    const srcless = pageContextMenuItems(params({ mediaType: 'image' }))
    expect(labels(srcless)).not.toContain('Copy Image')
  })

  it('never offers tab, window, save, print, or inspector items', () => {
    const everything = pageContextMenuItems(
      params({
        linkURL: 'https://example.com',
        selectionText: 'text',
        mediaType: 'image',
        srcURL: 'https://example.com/i.png',
        isEditable: true,
        editFlags: { canCut: true, canCopy: true, canPaste: true },
        canGoBack: true,
        canGoForward: true,
      }),
    )
    const forbidden = /tab|window|save|print|inspect|view source|translate|cast|search/i
    for (const item of everything) {
      if (item.kind === 'item') expect(`${item.label} ${item.action}`).not.toMatch(forbidden)
    }
  })
})
