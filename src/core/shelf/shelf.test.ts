import { describe, expect, it } from 'vitest'
import { describeShelfFile, onShelf, shelfFolders, type ShelfFile } from './shelf'

const HOUR = 3_600_000
const NOW = 1_800_000_000_000

const file = (name: string, hoursAgo: number, size = 1024, folder = '/d'): ShelfFile => ({ name, path: `${folder}/${name}`, modifiedMs: NOW - hoursAgo * HOUR, size })

describe('the Shelf (#424)', () => {
  it('reads bingbong_downloads alone, and the Settings folder beside it once one is named', () => {
    expect(shelfFolders('/home/u/Downloads/bingbong_downloads', '')).toEqual(['/home/u/Downloads/bingbong_downloads'])
    expect(shelfFolders('/home/u/Downloads/bingbong_downloads', '/home/u/Documents')).toEqual(['/home/u/Downloads/bingbong_downloads', '/home/u/Documents'])
    expect(shelfFolders('/home/u/Downloads/bingbong_downloads', '/home/u/Downloads/bingbong_downloads/')).toEqual(['/home/u/Downloads/bingbong_downloads'])
  })

  it('puts the newest first, from every folder, and leaves out what is hidden or still downloading', () => {
    const shelf = onShelf([file('old.pdf', 48), file('.hidden', 0), file('cv.docx', 3, 1024, '/docs'), file('new.png', 0.1), file('Unconfirmed 1.crdownload', 0), file('song.mp3.part', 0)])
    expect(shelf.map((each) => each.name)).toEqual(['new.png', 'cv.docx', 'old.pdf'])
  })

  it('names each file with its age and size, as the card shows it', () => {
    expect(describeShelfFile(file('invoice.pdf', 2, 86_000), NOW)).toBe('"invoice.pdf", 2 hours old, 84 KB')
    expect(describeShelfFile(file('shot.jpg', 0.01, 300), NOW)).toBe('"shot.jpg", a minute old, 300 bytes')
    expect(describeShelfFile(file('cv.docx', 30, 2_400_000), NOW)).toBe('"cv.docx", a day old, 2.3 MB')
    expect(describeShelfFile(file('scan.pdf', 24 * 9, 5_000), NOW)).toBe('"scan.pdf", 9 days old, 5 KB')
  })
})
