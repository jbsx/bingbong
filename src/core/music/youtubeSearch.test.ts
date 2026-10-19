import { describe, expect, it } from 'vitest'
import { initialDataOf, pickVideo, plainVideos, resultsUrl, videoIdOf, watchUrl } from './youtubeSearch'

// The search pick (#343): the first plain video of YouTube's results —
// read off the `ytInitialData` the results page carries, past ads, Shorts,
// channels, playlists and the "People also watched" shelves.

const video = (id: string, title: string) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, navigationEndpoint: { watchEndpoint: { videoId: id } } } })

/** A results page's data with these items in its first section. */
function resultsData(...items: unknown[]): unknown {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }, { continuationItemRenderer: {} }] } },
      },
    },
  }
}

describe('the search pick', () => {
  it('is the first plain video past an ad, a Short, a channel, a playlist and a shelf', () => {
    const data = resultsData(
      { adSlotRenderer: {} },
      { reelShelfRenderer: { items: [{ reelItemRenderer: { videoId: 'shortshort1' } }] } },
      { channelRenderer: { channelId: 'UC123' } },
      { playlistRenderer: { playlistId: 'PL123' } },
      { lockupViewModel: { contentId: 'RDabc', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
      { shelfRenderer: { content: { verticalListRenderer: { items: [video('alsowatched', 'People also watched')] } } } },
      video('dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up'),
      video('second00000', 'Second'),
    )
    expect(pickVideo(data)).toEqual({ id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up' })
  })

  it('keeps every plain video in order, for a correction to move along (#345)', () => {
    const data = resultsData(video('first000000', 'First'), { channelRenderer: {} }, video('second00000', 'Second'), { adSlotRenderer: {} }, video('third000000', 'Third'))
    expect(plainVideos(data).map((song) => song.id)).toEqual(['first000000', 'second00000', 'third000000'])
    expect(plainVideos(null)).toEqual([])
  })

  it('skips a video renderer that opens as a Short', () => {
    const short = { videoRenderer: { videoId: 'shortvideo1', title: { runs: [{ text: 'A Short' }] }, navigationEndpoint: { reelWatchEndpoint: { videoId: 'shortvideo1' } } } }
    expect(pickVideo(resultsData(short, video('plainvideo1', 'Plain')))).toEqual({ id: 'plainvideo1', title: 'Plain' })
  })

  it('reads a video lockup, and the title from simpleText', () => {
    const lockup = { lockupViewModel: { contentId: 'lockupvid01', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: { lockupMetadataViewModel: { title: { content: 'Lockup' } } } } }
    expect(pickVideo(resultsData(lockup))).toEqual({ id: 'lockupvid01', title: 'Lockup' })
    expect(pickVideo(resultsData({ videoRenderer: { videoId: 'simpletext1', title: { simpleText: 'Simple' } } }))).toEqual({ id: 'simpletext1', title: 'Simple' })
  })

  it('is null for no results, or data that is not a results page', () => {
    expect(pickVideo(resultsData({ channelRenderer: {} }))).toBeNull()
    expect(pickVideo(null)).toBeNull()
    expect(pickVideo({ contents: {} })).toBeNull()
  })

  it('reads the data out of a results page\'s HTML', () => {
    const data = resultsData(video('dQw4w9WgXcQ', 'Never; Gonna </ Give'))
    const html = `<html><script nonce="x">var ytInitialData = ${JSON.stringify(data)};</script><script>var other = 1;</script></html>`
    expect(pickVideo(initialDataOf(html))).toEqual({ id: 'dQw4w9WgXcQ', title: 'Never; Gonna </ Give' })
    expect(initialDataOf('<html>consent</html>')).toBeNull()
  })

  it('addresses the results and the watch page, and reads a watch address\'s id', () => {
    expect(resultsUrl('daft punk & co')).toBe('https://www.youtube.com/results?search_query=daft+punk+%26+co')
    expect(watchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toBe('dQw4w9WgXcQ')
    expect(videoIdOf('https://www.youtube.com/results?search_query=x')).toBeNull()
    expect(videoIdOf('https://accounts.google.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})
