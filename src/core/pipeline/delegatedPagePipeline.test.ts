import { describe, expect, it } from 'vitest'
import { createCommandPipeline } from './createCommandPipeline'
import { FakeClock, RecordingTts, ScriptedLlm } from '../testing/doubles'
import type { Tool } from './tool'
import type { DelegatedHolder } from './delegatedPage'

// #273, ADR 0065, at the Run loop: the orchestrator's Tool Round reads the
// Delegated Pages of the Subagents this Run spawned, by its own turn id, and
// the Notice reaches the model on the result of the call on the page.

describe('the Run loop’s Delegated Page Notice (#273)', () => {
  const DOCS = 'https://www.raspberrypi.com/documentation/computers/camera_software.html'

  it('asks the registry by this Run’s turn and hands the model the Notice', async () => {
    let url = 'about:blank'
    const navigate: Tool = {
      name: 'navigate',
      acquisition: true,
      async execute(call) {
        url = String(call.args.url)
        return 'navigated'
      },
    }
    const asked: { url: string; turnId: string }[] = []
    const holder: DelegatedHolder = { agentId: 'a-1', kindLabel: 'browsing', task: 'Read the camera page', state: 'running', findings: [] }
    const llm = new ScriptedLlm([
      { kind: 'tool_calls', calls: [{ id: 'n1', name: 'navigate', args: { url: DOCS } }] },
      { kind: 'answer', speak: 'Done.', display: 'Done.' },
    ])
    const pipeline = createCommandPipeline({
      llm,
      tts: new RecordingTts(),
      clock: new FakeClock(),
      tools: [navigate],
      currentPageUrl: () => url,
      delegatedPages: (page, turnId) => {
        asked.push({ url: page, turnId })
        return [holder]
      },
    })

    for await (const event of pipeline.execute('read the camera docs', 'turn-273')) void event

    expect(asked).toEqual([{ url: DOCS, turnId: 'turn-273' }])
    expect(llm.requests[1]?.toolResults?.[0]?.outcome).toEqual({
      ok: true,
      result:
        'navigated\n\na-1 [browsing] was sent to this page for: Read the camera page. Its report will carry what it reads here; keep to what you did not delegate, or wait with agent_results.',
    })
  })
})
