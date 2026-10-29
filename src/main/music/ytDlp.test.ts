import { describe, expect, it } from 'vitest'
import { parseLookup } from './ytDlp'

describe("the audio road's lookup (#502)", () => {
  it('reads the stream and when YouTube serves it', () => {
    expect(parseLookup('1793237545 https://rr1.googlevideo.com/videoplayback?id=1\n')).toEqual({ stream: 'https://rr1.googlevideo.com/videoplayback?id=1', availableAt: 1793237545000 })
  })

  it('a stream yt-dlp names no time for is served at once', () => {
    expect(parseLookup('NA https://rr1.googlevideo.com/videoplayback?id=1')).toEqual({ stream: 'https://rr1.googlevideo.com/videoplayback?id=1', availableAt: null })
  })

  it("a bare address, `-g`'s shape, names no time", () => {
    expect(parseLookup('https://stream.example/aaaaaaaaaaa\n')).toEqual({ stream: 'https://stream.example/aaaaaaaaaaa', availableAt: null })
  })

  it('no address is no stream', () => {
    expect(parseLookup('')).toBeNull()
    expect(parseLookup('1793237545 NA')).toBeNull()
  })
})
