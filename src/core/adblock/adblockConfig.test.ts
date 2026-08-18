import { describe, expect, it } from 'vitest'
import {
  ADBLOCK_UPDATE_INTERVAL_MS,
  DEFAULT_ADBLOCK_LISTS,
  adblockCachePaths,
  cacheIsUsable,
  resolveAdblockConfig,
} from './adblockConfig'

describe('DEFAULT_ADBLOCK_LISTS', () => {
  it('bundles EasyList, uBlock filters and a malware-domain list', () => {
    const joined = DEFAULT_ADBLOCK_LISTS.join(' ')
    expect(joined).toContain('easylist.to/easylist/easylist.txt')
    expect(joined).toContain('ublockorigin.github.io')
    expect(joined).toContain('urlhaus')
  })

  it('excludes EasyPrivacy (v1: breakage debugging on a voice browser)', () => {
    expect(DEFAULT_ADBLOCK_LISTS.join(' ')).not.toContain('easyprivacy')
  })
})

describe('resolveAdblockConfig', () => {
  it('returns the default lists when nothing is set', () => {
    const config = resolveAdblockConfig({})
    expect(config.lists).toEqual(DEFAULT_ADBLOCK_LISTS)
    expect(config.resourcesUrl).not.toBeNull()
  })

  it('replaces the lists from BINGBONG_ADBLOCK_LISTS', () => {
    const config = resolveAdblockConfig({
      BINGBONG_ADBLOCK_LISTS: 'http://lists.example/a.txt , http://lists.example/b.txt',
    })
    expect(config.lists).toEqual(['http://lists.example/a.txt', 'http://lists.example/b.txt'])
  })

  it('drops empty entries from the override', () => {
    const config = resolveAdblockConfig({ BINGBONG_ADBLOCK_LISTS: ' http://lists.example/a.txt ,,' })
    expect(config.lists).toEqual(['http://lists.example/a.txt'])
  })

  it('is fully off with BINGBONG_ADBLOCK=off', () => {
    const config = resolveAdblockConfig({ BINGBONG_ADBLOCK: 'off' })
    expect(config.lists).toEqual([])
    expect(config.resourcesUrl).toBeNull()
  })

  it('skips scriptlet resources when BINGBONG_ADBLOCK_RESOURCES is set but empty', () => {
    expect(resolveAdblockConfig({ BINGBONG_ADBLOCK_RESOURCES: '' }).resourcesUrl).toBeNull()
    expect(resolveAdblockConfig({ BINGBONG_ADBLOCK_RESOURCES: 'http://r.example/x.json' }).resourcesUrl).toBe(
      'http://r.example/x.json',
    )
  })
})

describe('adblockCachePaths', () => {
  it('places the engine cache and metadata beside the profile', () => {
    expect(adblockCachePaths('/userData')).toEqual({
      engine: '/userData/adblock-engine.bin',
      meta: '/userData/adblock-meta.json',
    })
  })
})

describe('cacheIsUsable', () => {
  const lists = ['http://lists.example/a.txt']
  const now = 1_000_000_000_000

  it('rejects a missing cache', () => {
    expect(cacheIsUsable(null, lists, now, ADBLOCK_UPDATE_INTERVAL_MS)).toBe(false)
  })

  it('rejects a cache built from different lists', () => {
    expect(cacheIsUsable({ urls: ['http://lists.example/other.txt'], updatedAt: now }, lists, now, ADBLOCK_UPDATE_INTERVAL_MS)).toBe(false)
  })

  it('accepts a fresh cache built from the same lists', () => {
    expect(cacheIsUsable({ urls: lists, updatedAt: now - 1 }, lists, now, ADBLOCK_UPDATE_INTERVAL_MS)).toBe(true)
  })

  it('rejects a cache older than the update interval', () => {
    expect(cacheIsUsable({ urls: lists, updatedAt: now - ADBLOCK_UPDATE_INTERVAL_MS }, lists, now, ADBLOCK_UPDATE_INTERVAL_MS)).toBe(false)
  })
})
