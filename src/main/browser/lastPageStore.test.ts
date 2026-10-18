import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLastPageStore } from './lastPageStore'

describe('the Last Page store', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-last-page-'))
    path = join(dir, 'nested', 'last-page.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty without a file and persists the page the pane shows', () => {
    const store = createLastPageStore(path, { now: () => 42 })
    const seen: unknown[] = []
    store.onChange((page) => seen.push(page))

    expect(store.get()).toBeNull()
    store.record({ url: 'about:blank', title: '' })
    store.record({ url: 'https://youtube.com/', title: '' })
    store.record({ url: 'https://youtube.com/', title: 'YouTube' })
    store.record({ url: 'https://youtube.com/', title: 'YouTube' })

    expect(store.get()).toEqual({ url: 'https://youtube.com/', title: 'YouTube', at: 42 })
    expect(seen).toEqual([
      { url: 'https://youtube.com/', title: '', at: 42 },
      { url: 'https://youtube.com/', title: 'YouTube', at: 42 },
    ])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ url: 'https://youtube.com/', title: 'YouTube', at: 42 })
  })

  it('reads the persisted page back at the next start', () => {
    createLastPageStore(path, { now: () => 7 }).record({ url: 'https://example.com/a', title: 'A' })

    expect(createLastPageStore(path).get()).toEqual({ url: 'https://example.com/a', title: 'A', at: 7 })
  })

  it('treats a corrupt file as no Last Page', () => {
    writeFileSync(path.replace('/nested', ''), 'not json', 'utf8')

    expect(createLastPageStore(path.replace('/nested', '')).get()).toBeNull()
  })
})
