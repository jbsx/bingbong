// The Smart Turn v3 front end (#357): the ONNX export takes Whisper's
// log-mel features, not audio, so they are computed here — the same steps
// pipecat-ai/smart-turn's inference.py takes through Hugging Face's
// WhisperFeatureExtractor(chunk_length=8). The last 8 s of 16 kHz audio,
// zero-padded at the start; normalized to zero mean and unit variance; a
// 400-point periodic-Hann STFT every 160 samples over reflect-padded audio;
// power through 80 Slaney mel filters; log10, the last frame dropped,
// floored 8 below the peak and scaled to (x + 4) / 4. Pure math, so the
// match to the Python extractor is spec-tested.

const SAMPLE_RATE = 16_000
const N_FFT = 400
const HOP = 160
const BINS = N_FFT / 2 + 1
/** Smart Turn reads 8 s of audio. */
export const SMART_TURN_SAMPLES = 8 * SAMPLE_RATE
export const SMART_TURN_MELS = 80
/** 8 s at a 160-sample hop. */
export const SMART_TURN_FRAMES = SMART_TURN_SAMPLES / HOP

/** Slaney's mel scale: linear below 1 kHz, logarithmic above. */
const MIN_LOG_HZ = 1_000
const MIN_LOG_MEL = 15
const LOG_STEP = 27 / Math.log(6.4)

function hzToMel(hz: number): number {
  return hz >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) * LOG_STEP : (3 * hz) / 200
}

function melToHz(mel: number): number {
  return mel >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp((mel - MIN_LOG_MEL) / LOG_STEP) : (200 * mel) / 3
}

/** 80 Slaney-normalized triangular filters over the 201 FFT bins, 0–8 kHz; mel-major. */
function melFilterBank(): Float64Array {
  const maxMel = hzToMel(SAMPLE_RATE / 2)
  const edges = Array.from({ length: SMART_TURN_MELS + 2 }, (_, i) => melToHz((maxMel * i) / (SMART_TURN_MELS + 1)))
  const filters = new Float64Array(SMART_TURN_MELS * BINS)
  for (let m = 0; m < SMART_TURN_MELS; m++) {
    const [lower, center, upper] = [edges[m], edges[m + 1], edges[m + 2]]
    const norm = 2 / (upper - lower)
    for (let b = 0; b < BINS; b++) {
      const hz = (b * SAMPLE_RATE) / 2 / (BINS - 1)
      const weight = Math.min((hz - lower) / (center - lower), (upper - hz) / (upper - center))
      if (weight > 0) filters[m * BINS + b] = weight * norm
    }
  }
  return filters
}

/** The periodic Hann window numpy's `hanning(N + 1)[:-1]` gives. */
function hannWindow(): Float64Array {
  return Float64Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT))
}

// The 400-point DFT as 20 × 20 (Cooley–Tukey, one split): two passes of
// 20-point DFTs with a twiddle between, a tenth of the direct sum's work.
const SPLIT = 20
const COS20 = Float64Array.from({ length: SPLIT }, (_, k) => Math.cos((2 * Math.PI * k) / SPLIT))
const SIN20 = Float64Array.from({ length: SPLIT }, (_, k) => Math.sin((2 * Math.PI * k) / SPLIT))
const COS400 = Float64Array.from({ length: N_FFT }, (_, k) => Math.cos((2 * Math.PI * k) / N_FFT))
const SIN400 = Float64Array.from({ length: N_FFT }, (_, k) => Math.sin((2 * Math.PI * k) / N_FFT))

/** |X[k]|² for k in 0..200 of one real 400-sample frame, into `power`. */
function powerSpectrum(frame: Float64Array, power: Float64Array, re: Float64Array, im: Float64Array): void {
  // Pass 1: for each n2, the 20-point DFT over n1 of x[20·n1 + n2], twiddled by W400^(n2·k1).
  for (let n2 = 0; n2 < SPLIT; n2++) {
    for (let k1 = 0; k1 < SPLIT; k1++) {
      let sumRe = 0
      let sumIm = 0
      for (let n1 = 0; n1 < SPLIT; n1++) {
        const x = frame[SPLIT * n1 + n2]
        const k = (n1 * k1) % SPLIT
        sumRe += x * COS20[k]
        sumIm -= x * SIN20[k]
      }
      const t = (n2 * k1) % N_FFT
      re[n2 * SPLIT + k1] = sumRe * COS400[t] + sumIm * SIN400[t]
      im[n2 * SPLIT + k1] = sumIm * COS400[t] - sumRe * SIN400[t]
    }
  }
  // Pass 2: for each k1, the 20-point DFT over n2 gives X[k1 + 20·k2].
  for (let k = 0; k < BINS; k++) {
    const k1 = k % SPLIT
    const k2 = Math.floor(k / SPLIT)
    let sumRe = 0
    let sumIm = 0
    for (let n2 = 0; n2 < SPLIT; n2++) {
      const a = re[n2 * SPLIT + k1]
      const b = im[n2 * SPLIT + k1]
      const w = (n2 * k2) % SPLIT
      sumRe += a * COS20[w] + b * SIN20[w]
      sumIm += b * COS20[w] - a * SIN20[w]
    }
    power[k] = sumRe * sumRe + sumIm * sumIm
  }
}

let filterBank: Float64Array | null = null
let window: Float64Array | null = null

/** Smart Turn's input for an Utterance so far: 80 × 800 float32, mel-major (the `input_features` [1, 80, 800] tensor). */
export function smartTurnFeatures(pcm: Float32Array): Float32Array {
  filterBank ??= melFilterBank()
  window ??= hannWindow()

  // The last 8 s, zero-padded at the start, then zero mean and unit variance.
  const audio = new Float64Array(SMART_TURN_SAMPLES)
  const kept = pcm.subarray(Math.max(0, pcm.length - SMART_TURN_SAMPLES))
  audio.set(kept, SMART_TURN_SAMPLES - kept.length)
  let mean = 0
  for (const x of audio) mean += x
  mean /= audio.length
  let variance = 0
  for (const x of audio) variance += (x - mean) * (x - mean)
  variance /= audio.length
  const scale = 1 / Math.sqrt(variance + 1e-7)
  for (let i = 0; i < audio.length; i++) audio[i] = (audio[i] - mean) * scale

  // Centered frames over reflect padding of N_FFT / 2 a side.
  const half = N_FFT / 2
  const sample = (i: number): number => {
    const j = i - half
    if (j < 0) return audio[-j]
    if (j >= audio.length) return audio[2 * (audio.length - 1) - j]
    return audio[j]
  }

  const logMel = new Float64Array(SMART_TURN_MELS * SMART_TURN_FRAMES)
  const frame = new Float64Array(N_FFT)
  const power = new Float64Array(BINS)
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  let peak = -Infinity
  // 801 frames fit; Whisper drops the last.
  for (let t = 0; t < SMART_TURN_FRAMES; t++) {
    for (let n = 0; n < N_FFT; n++) frame[n] = sample(t * HOP + n) * window[n]
    powerSpectrum(frame, power, re, im)
    for (let m = 0; m < SMART_TURN_MELS; m++) {
      let energy = 0
      const row = m * BINS
      for (let b = 0; b < BINS; b++) {
        const weight = filterBank[row + b]
        if (weight !== 0) energy += weight * power[b]
      }
      const value = Math.log10(Math.max(energy, 1e-10))
      logMel[m * SMART_TURN_FRAMES + t] = value
      if (value > peak) peak = value
    }
  }

  const features = new Float32Array(logMel.length)
  const floor = peak - 8
  for (let i = 0; i < logMel.length; i++) features[i] = (Math.max(logMel[i], floor) + 4) / 4
  return features
}
