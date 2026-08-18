import { describe, expect, it } from 'vitest'
import { resolveWakeConfig } from './wakeConfig'

describe('wake config', () => {
  it('defaults to the node engine with the three custom heads under userData/models/wake', () => {
    const config = resolveWakeConfig({}, '/profile', '/app')

    expect(config).toEqual({
      engine: 'node',
      melspecModel: '/profile/models/melspectrogram.onnx',
      embeddingModel: '/profile/models/embedding_model.onnx',
      wakeModel: '/profile/models/wake/bing_bong.onnx',
      abortModel: '/profile/models/wake/stop_now.onnx',
      holdOnModel: '/profile/models/wake/hold_on.onnx',
      pythonBin: 'python3',
      sidecarScript: '/app/scripts/wake_sidecar.py',
      wakeScript: undefined,
    })
  })

  it('selects the python engine and off via BINGBONG_WAKE_ENGINE', () => {
    expect(resolveWakeConfig({ BINGBONG_WAKE_ENGINE: 'python' }, '/p', '/a').engine).toBe('python')
    expect(resolveWakeConfig({ BINGBONG_WAKE_ENGINE: 'off' }, '/p', '/a').engine).toBe('off')
  })

  it('honors model path, python bin, and scripted-score overrides', () => {
    const config = resolveWakeConfig(
      {
        BINGBONG_WAKE_MODEL: '/models/custom_wake.onnx',
        BINGBONG_WAKE_ABORT_MODEL: '/models/custom_abort.onnx',
        BINGBONG_WAKE_HOLD_ON_MODEL: '/models/custom_hold_on.onnx',
        BINGBONG_WAKE_MELSPEC_MODEL: '/models/mels.onnx',
        BINGBONG_WAKE_EMBEDDING_MODEL: '/models/emb.onnx',
        BINGBONG_WAKE_PYTHON_BIN: '/venv/bin/python',
        BINGBONG_WAKE_SCRIPT: '[0.1, 0.9]',
      },
      '/p',
      '/a',
    )

    expect(config.wakeModel).toBe('/models/custom_wake.onnx')
    expect(config.abortModel).toBe('/models/custom_abort.onnx')
    expect(config.holdOnModel).toBe('/models/custom_hold_on.onnx')
    expect(config.melspecModel).toBe('/models/mels.onnx')
    expect(config.embeddingModel).toBe('/models/emb.onnx')
    expect(config.pythonBin).toBe('/venv/bin/python')
    expect(config.wakeScript).toBe('[0.1, 0.9]')
  })

  it('rejects an unknown engine', () => {
    expect(() => resolveWakeConfig({ BINGBONG_WAKE_ENGINE: 'quantum' }, '/p', '/a')).toThrow(/BINGBONG_WAKE_ENGINE/)
  })
})
