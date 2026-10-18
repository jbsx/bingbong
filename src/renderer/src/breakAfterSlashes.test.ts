import { describe, expect, it } from 'vitest'
import { rehypeBreakAfterSlashes } from './breakAfterSlashes'

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] }

const text = (value: string): Node => ({ type: 'text', value })
const el = (tagName: string, children: Node[], properties: Record<string, unknown> = {}): Node => ({ type: 'element', tagName, properties, children })

function run(tree: Node): Node {
  rehypeBreakAfterSlashes()(tree)
  return tree
}

/** The tree's text with each <wbr> shown as `|`, so a break opportunity is visible. */
function show(node: Node): string {
  if (node.type === 'text') return node.value ?? ''
  if (node.tagName === 'wbr') return '|'
  return (node.children ?? []).map(show).join('')
}

describe('rehypeBreakAfterSlashes', () => {
  it('lets a long path in an Answer break after each slash, not mid-word', () => {
    const tree = run({ type: 'root', children: [el('p', [text('screenshot saved: /tmp/bingbong/downloads/screenshot-1.jpg')])] })
    expect(show(tree)).toBe('screenshot saved: /|tmp/|bingbong/|downloads/|screenshot-1.jpg')
  })

  it('leaves code text and link hrefs as they are', () => {
    const link = el('a', [text('example.com/a/b')], { href: 'https://example.com/a/b' })
    const tree = run({ type: 'root', children: [el('p', [el('code', [text('a/b')]), link])] })
    expect(show(tree)).toBe('a/bexample.com/|a/|b')
    expect(link.properties).toEqual({ href: 'https://example.com/a/b' })
  })

  it('leaves text without a slash untouched', () => {
    const tree = run({ type: 'root', children: [el('p', [text('Scrolled down.')])] })
    expect(tree.children?.[0].children).toEqual([text('Scrolled down.')])
  })
})
