import type { Harness } from './harness'

// What the pane's YouTube video reads, for the suites that drive the live Player
// (music, musicThrottle). In a module of its own: importing it from a test file
// would run that file's suites too.

export interface VideoFacts {
  path: string
  id: string | null
  found: boolean
  paused: boolean
  currentTime: number
  duration: number
  loop: boolean
  ad: boolean
}

const VIDEO_FACTS = `(() => {
  const player = document.querySelector('#movie_player')
  const video = player ? player.querySelector('video') : null
  return {
    path: location.pathname,
    id: new URLSearchParams(location.search).get('v'),
    found: video !== null,
    paused: video ? video.paused : true,
    currentTime: video ? video.currentTime : 0,
    duration: video ? video.duration : 0,
    loop: video ? video.loop : false,
    ad: player ? player.classList.contains('ad-showing') : false,
  }
})()`

export async function facts(harness: Harness): Promise<VideoFacts> {
  return harness.paneEval<VideoFacts>(VIDEO_FACTS)
}
