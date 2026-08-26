import { describe, expect, it } from 'vitest'
import {
  applyAuthHostHeaders,
  authIdentityScript,
  isAuthHost,
  isAuthUrl,
  resolveAuthIdentity,
} from './authIdentity'

describe('resolveAuthIdentity', () => {
  it('defaults to the Google auth hosts and the Chrome UA', () => {
    expect(resolveAuthIdentity({})).toEqual({
      hosts: ['accounts.google.com', 'accounts.youtube.com'],
      userAgent: 'Chrome',
    })
  })

  it('honors the env overrides (comma list, custom UA)', () => {
    expect(resolveAuthIdentity({ BINGBONG_AUTH_HOSTS: '127.0.0.1, EXAMPLE.com ,', BINGBONG_AUTH_UA: 'Firefox' })).toEqual({
      hosts: ['127.0.0.1', 'example.com'],
      userAgent: 'Firefox',
    })
  })
})

describe('isAuthHost', () => {
  const hosts = ['accounts.google.com']

  it('matches the exact host case-insensitively and subdomains', () => {
    expect(isAuthHost('accounts.google.com', hosts)).toBe(true)
    expect(isAuthHost('ACCOUNTS.GOOGLE.COM', hosts)).toBe(true)
    expect(isAuthHost('ssh.accounts.google.com', hosts)).toBe(true)
  })

  it('rejects other hosts and suffix collisions', () => {
    expect(isAuthHost('google.com', hosts)).toBe(false)
    expect(isAuthHost('notaccounts.google.com', hosts)).toBe(false)
    expect(isAuthHost('accounts.google.com.evil.io', hosts)).toBe(false)
  })
})

describe('isAuthUrl', () => {
  const hosts = ['accounts.google.com']

  it('accepts http(s) URLs on auth hosts and rejects everything else', () => {
    expect(isAuthUrl('https://accounts.google.com/ServiceLogin', hosts)).toBe(true)
    expect(isAuthUrl('http://accounts.google.com/', hosts)).toBe(true)
    expect(isAuthUrl('https://www.google.com/search?q=x', hosts)).toBe(false)
    expect(isAuthUrl('about:blank', hosts)).toBe(false)
    expect(isAuthUrl('data:text/html,<b>hi</b>', hosts)).toBe(false)
    expect(isAuthUrl('not a url', hosts)).toBe(false)
  })

  it('is false for an empty host list', () => {
    expect(isAuthUrl('https://accounts.google.com/', [])).toBe(false)
  })
})

describe('applyAuthHostHeaders', () => {
  it('replaces the UA and strips every client hint, case-insensitively', () => {
    const rewritten = applyAuthHostHeaders(
      {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Chromium";v="150"',
        'Sec-CH-UA-Mobile': '?0',
        'SEC-CH-UA-PLATFORM': '"Linux"',
        'sec-ch-ua-full-version-list': '"Chromium";v="150.0.7871.224"',
        accept: 'text/html',
      },
      'Chrome',
    )
    expect(rewritten).toEqual({ accept: 'text/html', 'User-Agent': 'Chrome' })
  })

  it('never mutates the input headers', () => {
    const headers = { 'User-Agent': 'original', 'sec-ch-ua': '"Chromium"' }
    applyAuthHostHeaders(headers, 'Chrome')
    expect(headers).toEqual({ 'User-Agent': 'original', 'sec-ch-ua': '"Chromium"' })
  })
})

describe('authIdentityScript', () => {
  it('is parseable JavaScript carrying the policy', () => {
    const source = authIdentityScript({ hosts: ['accounts.google.com'], userAgent: 'Chrome' })
    expect(() => new Function(source)).not.toThrow()
    expect(source).toContain('accounts.google.com')
    expect(source).toContain('"Chrome"')
    expect(source).toContain('userAgentData')
  })
})
