import { describe, expect, it } from 'vitest'
import { normalizeUrlInput } from './urlInput'

describe('normalizeUrlInput', () => {
  it('keeps http and https URLs as-is', () => {
    expect(normalizeUrlInput('https://youtube.com')).toBe('https://youtube.com')
    expect(normalizeUrlInput('http://example.com/page?id=3#frag')).toBe('http://example.com/page?id=3#frag')
  })

  it('keeps about: URLs as-is', () => {
    expect(normalizeUrlInput('about:blank')).toBe('about:blank')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrlInput('  https://example.com  ')).toBe('https://example.com')
  })

  it('prefixes https:// onto bare domains', () => {
    expect(normalizeUrlInput('youtube.com')).toBe('https://youtube.com')
    expect(normalizeUrlInput('youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
  })

  it('uses http for localhost and bare IPv4 hosts', () => {
    expect(normalizeUrlInput('localhost')).toBe('http://localhost')
    expect(normalizeUrlInput('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeUrlInput('192.168.1.1')).toBe('http://192.168.1.1')
  })

  it('treats multi-word input as a web search', () => {
    expect(normalizeUrlInput('best mechanical keyboards')).toBe(
      'https://duckduckgo.com/?q=best%20mechanical%20keyboards',
    )
  })

  it('treats dotless single words as a web search', () => {
    expect(normalizeUrlInput('youtube')).toBe('https://duckduckgo.com/?q=youtube')
  })

  it('treats non-web schemes as a web search', () => {
    expect(normalizeUrlInput('javascript:alert(1)')).toBe(
      'https://duckduckgo.com/?q=javascript%3Aalert(1)',
    )
    expect(normalizeUrlInput('foo:bar')).toBe('https://duckduckgo.com/?q=foo%3Abar')
  })

  it('keeps file URLs for local pages', () => {
    expect(normalizeUrlInput('file:///tmp/page.html')).toBe('file:///tmp/page.html')
  })

  it('returns null for empty input', () => {
    expect(normalizeUrlInput('')).toBeNull()
    expect(normalizeUrlInput('   ')).toBeNull()
  })
})
