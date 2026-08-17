// Mic capture worklet (T9): downmixes the device channels (the C920 is
// stereo) to mono, accumulates samples into 1024-sample chunks at the
// AudioContext rate (16 kHz — the hook opens the context there), and posts
// them to the page.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(1024)
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (input.length > 0) {
      const channelCount = input.length
      const first = input[0]
      if (first) {
        for (let i = 0; i < first.length; i++) {
          let sample = 0
          for (let channel = 0; channel < channelCount; channel++) {
            sample += input[channel][i]
          }
          this.buffer[this.filled++] = sample / channelCount
          if (this.filled === this.buffer.length) {
            this.port.postMessage(this.buffer.slice(0))
            this.filled = 0
          }
        }
      }
    }
    return true
  }
}

registerProcessor('bingbong-capture', CaptureProcessor)
