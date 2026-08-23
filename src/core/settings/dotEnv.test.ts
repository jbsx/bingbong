import { describe, expect, it } from 'vitest'
import { layerEnv, parseDotEnv } from './dotEnv'
import { defaultSettings, settingsToEnv } from './settings'
import { resolveModelEndpoint } from '../agent/modelRouting'

describe('parseDotEnv', () => {
  it('parses plain, quoted and export-prefixed assignments', () => {
    const values = parseDotEnv(
      [
        'BINGBONG_ORCHESTRATOR_BASE_URL=https://api.z.ai/api/coding/paas/v4',
        'BINGBONG_ORCHESTRATOR_MODEL="GLM-4.6"',
        "BINGBONG_ORCHESTRATOR_API_KEY='single-secret'",
        'export ZAI_API_KEY=exported-secret',
      ].join('\n'),
    )
    expect(values).toEqual({
      BINGBONG_ORCHESTRATOR_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
      BINGBONG_ORCHESTRATOR_MODEL: 'GLM-4.6',
      BINGBONG_ORCHESTRATOR_API_KEY: 'single-secret',
      ZAI_API_KEY: 'exported-secret',
    })
  })

  it('ignores comments, blank lines and malformed lines', () => {
    const values = parseDotEnv(
      [
        '# a comment',
        '',
        '   ',
        'VALID=1',
        '#BINGBONG_SUBAGENT_API_KEY_ENV="commented out"',
        'no-equals-sign',
        '=starts-with-equals',
        'BAD KEY=spaces',
        '9STARTS_WITH_DIGIT=1',
        'UNCLOSED="quote',
      ].join('\r\n'),
    )
    expect(values).toEqual({ VALID: '1', UNCLOSED: '"quote' })
  })

  it('unescapes double-quoted values but leaves single-quoted ones alone', () => {
    expect(parseDotEnv('A="line\\nbreak \\"quoted\\" back\\\\slash"')['A']).toBe(
      'line\nbreak "quoted" back\\slash',
    )
    expect(parseDotEnv("B='literal\\nnewline'")['B']).toBe('literal\\nnewline')
  })
})

describe('layerEnv', () => {
  it('fills gaps from .env without overriding process env values', () => {
    const envFile = parseDotEnv('A=from-file\nB=from-file')
    const layered = layerEnv(envFile, { B: 'from-process', C: 'from-process' })
    expect(layered).toEqual({ A: 'from-file', B: 'from-process', C: 'from-process' })
  })

  it('resolves the orchestrator and vision endpoints from .env alone', () => {
    const envFile = parseDotEnv(
      [
        'BINGBONG_ORCHESTRATOR_BASE_URL=https://api.z.ai/api/coding/paas/v4',
        'BINGBONG_ORCHESTRATOR_MODEL=GLM-4.6',
        'BINGBONG_VISION_BASE_URL=https://api.z.ai/api/coding/paas/v4',
        'BINGBONG_VISION_MODEL=GLM-4.6V',
        'ZAI_API_KEY=zai-secret',
      ].join('\n'),
    )
    const env = layerEnv(envFile, {})
    expect(resolveModelEndpoint(env, 'orchestrator')).toMatchObject({ model: 'GLM-4.6', apiKey: 'zai-secret' })
    expect(resolveModelEndpoint(env, 'vision')).toMatchObject({ model: 'GLM-4.6V', apiKey: 'zai-secret' })
  })

  it('layers .env under process.env under settings values', () => {
    const envFile = parseDotEnv(
      ['BINGBONG_VISION_BASE_URL=https://file.test/v1', 'BINGBONG_VISION_MODEL=from-file', 'ZAI_API_KEY=file-key'].join(
        '\n',
      ),
    )
    const processEnv = { BINGBONG_VISION_MODEL: 'from-process' }
    const settings = defaultSettings()
    settings.modelRouting.vision = { baseUrl: 'https://x.test/v1', model: 'from-settings', apiKey: '' }

    const fromFile = resolveModelEndpoint(layerEnv(envFile, processEnv), 'vision')
    expect(fromFile.model).toBe('from-process')

    const withSettings = resolveModelEndpoint(
      { ...layerEnv(envFile, processEnv), ...settingsToEnv(settings) },
      'vision',
    )
    expect(withSettings.model).toBe('from-settings')
    // Keys not overridden by any layer still come from .env.
    expect(withSettings.apiKey).toBe('file-key')
  })
})
