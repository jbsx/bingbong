import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findFolder, readShelf } from './readShelf'

describe('readShelf (#424)', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bingbong-shelf-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists each folder\'s own files flat, newest first, and nothing below them or in a folder that is not there', async () => {
    const downloads = join(root, 'bingbong_downloads')
    const docs = join(root, 'docs')
    await mkdir(join(docs, 'deep'), { recursive: true })
    await mkdir(downloads)
    await writeFile(join(downloads, 'invoice.pdf'), 'pdf')
    await writeFile(join(docs, 'cv.docx'), 'cv!!')
    await writeFile(join(docs, 'deep', 'secret.txt'), 'no')
    await utimes(join(docs, 'cv.docx'), 1_000, 1_000)

    const shelf = await readShelf([downloads, docs, join(root, 'gone')])

    expect(shelf.map(({ name, path, size }) => ({ name, path, size }))).toEqual([
      { name: 'invoice.pdf', path: join(downloads, 'invoice.pdf'), size: 3 },
      { name: 'cv.docx', path: join(docs, 'cv.docx'), size: 4 },
    ])
  })

  it('reads a folder named twice — by a symlink, a trailing slash or from `~` — once', async () => {
    const downloads = join(root, 'bingbong_downloads')
    await mkdir(downloads)
    await writeFile(join(downloads, 'invoice.pdf'), 'pdf')
    await symlink(downloads, join(root, 'link'))
    const shelf = await readShelf([downloads, join(root, 'link'), `${downloads}/`, '~/bingbong_downloads'], root)
    expect(shelf.map((file) => file.name)).toEqual(['invoice.pdf'])
  })

  it('finds a spoken folder under home, or a path as written, and none for a folder that is not there', async () => {
    await mkdir(join(root, 'Documents', 'Invoices'), { recursive: true })
    expect(await findFolder('my documents folder', root)).toBe(join(root, 'Documents'))
    expect(await findFolder('invoices', root)).toBe(join(root, 'Documents', 'Invoices'))
    expect(await findFolder('~/Documents/', root)).toBe(join(root, 'Documents'))
    expect(await findFolder(join(root, 'Documents', 'Invoices'), root)).toBe(join(root, 'Documents', 'Invoices'))
    expect(await findFolder('/no/such/folder', root)).toBeNull()
    expect(await findFolder('~Documents', root)).toBe(join(root, 'Documents'))
    expect(await findFolder('music', root)).toBeNull()
  })
})
