// The page the app's own voice plays in when it plays through Chromium (#490):
// WebAudio, so Chromium's echo canceller — the mic is captured with
// `echoCancellation: true` (micCapture.ts) — has the voice as its reference
// and takes it out of the mic. aplay plays outside Chromium, where the
// canceller never hears it.
//
// One stream per spoken text, as the aplay player's: each sentence's samples
// are scheduled right after the one before it, so there is no gap between
// them, through the stream's one gain node, so a duck is one gain change.
// A silent stream (the Sound Mute, a run off screen: aplay's 'null' device)
// plays into a context that renders on a silent clock and opens no output
// device (`sinkId: none`, micCapture.ts's reason): it takes as long as the
// sound would, and nothing sounds.
//
// The page is driven by `executeJavaScript` (speechSurface.ts); `first` and
// `done` return promises the caller awaits.

/** The script that defines `window.__speech`, run once as the page loads. */
export const SPEECH_PAGE_SCRIPT = `(() => {
  if (window.__speech) return
  const contexts = {}
  const streams = new Map()
  const context = (silent) => {
    const key = silent ? 'silent' : 'out'
    if (!contexts[key]) contexts[key] = silent ? new AudioContext({ sinkId: { type: 'none' } }) : new AudioContext()
    const made = contexts[key]
    if (made.state === 'suspended') made.resume().catch(() => {})
    return made
  }
  const deferred = () => {
    let resolve
    const promise = new Promise((r) => (resolve = r))
    return { promise, resolve }
  }
  const samples = (b64, bits, channels, ctx, rate) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const width = bits / 8
    const frames = Math.floor(bytes.length / (width * channels))
    if (frames === 0) return null
    const buffer = ctx.createBuffer(channels, frames, rate)
    const view = new DataView(bytes.buffer)
    for (let ch = 0; ch < channels; ch++) {
      const out = buffer.getChannelData(ch)
      for (let f = 0; f < frames; f++) {
        const at = (f * channels + ch) * width
        out[f] = bits === 8 ? (bytes[at] - 128) / 128 : view.getInt16(at, true) / 32768
      }
    }
    return buffer
  }
  const finish = (s) => {
    if (s.finished) return
    s.finished = true
    s.first.resolve(false)
    s.done.resolve()
    s.gain.disconnect()
    streams.delete(s.id)
  }
  window.__speech = {
    open(id, silent) {
      const ctx = context(silent)
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      streams.set(id, { id, ctx, gain, next: 0, sources: new Set(), ended: false, finished: false, started: false, first: deferred(), done: deferred() })
    },
    write(id, rate, channels, bits, b64) {
      const s = streams.get(id)
      if (!s || s.ended) return
      const buffer = samples(b64, bits, channels, s.ctx, rate)
      if (buffer === null) return
      const source = s.ctx.createBufferSource()
      source.buffer = buffer
      source.connect(s.gain)
      const at = Math.max(s.ctx.currentTime, s.next)
      source.start(at)
      s.next = at + buffer.duration
      s.sources.add(source)
      source.onended = () => {
        s.sources.delete(source)
        if (s.ended && s.sources.size === 0) finish(s)
      }
      if (!s.started) {
        s.started = true
        s.first.resolve(true)
      }
    },
    end(id) {
      const s = streams.get(id)
      if (!s) return
      s.ended = true
      if (s.sources.size === 0) finish(s)
    },
    gain(id, value) {
      const s = streams.get(id)
      if (s) s.gain.gain.setValueAtTime(value, s.ctx.currentTime)
    },
    stop(id) {
      const s = streams.get(id)
      if (!s) return
      for (const source of s.sources) {
        source.onended = null
        try { source.stop() } catch {}
      }
      s.sources.clear()
      finish(s)
    },
    first(id) {
      const s = streams.get(id)
      return s ? s.first.promise : Promise.resolve(false)
    },
    done(id) {
      const s = streams.get(id)
      return s ? s.done.promise : Promise.resolve()
    },
    /** The share of its level a stream plays at now; null once it is gone. */
    level(id) {
      const s = streams.get(id)
      return s ? s.gain.gain.value : null
    },
    /** How many streams are open. */
    playing() {
      return streams.size
    },
  }
})()`

/** The page: no element at all, the script alone. Nothing in it is media a page collector would read. */
export const SPEECH_PAGE = `<!doctype html><meta charset="utf-8"><title>speech</title><script>${SPEECH_PAGE_SCRIPT}</script>`
