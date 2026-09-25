import { describe, expect, it } from 'vitest'
import {
  DELEGATED_PAGE_COLLECTED_INSTRUCTION,
  DELEGATED_PAGE_NOTICE_FINDINGS,
  createDelegatedPageNotices,
  delegatedPageNotice,
  urlsInTask,
  type DelegatedHolder,
} from './delegatedPage'

// #273, ADR 0065: the Delegated Page Notice's words, and when it fires. A
// Delegated Page still loads; the outcome of a call on it names the Browse
// Subagent that holds it and what that holder's state means for the read.

function holder(extra: Partial<DelegatedHolder> = {}): DelegatedHolder {
  return { agentId: 'a-1', kindLabel: 'browsing', task: 'Read the camera software page', state: 'running', findings: [], ...extra }
}

describe('the Delegated Page Notice text', () => {
  it('names a running holder, the task it was sent for, and the two ways on', () => {
    expect(delegatedPageNotice([holder()])).toBe(
      'a-1 [browsing] was sent to this page for: Read the camera software page. Its report will carry what it reads here; keep to what you did not delegate, or wait with agent_results.',
    )
  })

  it('quotes at most the first 160 characters of the task', () => {
    const task = 'x'.repeat(200)
    const notice = delegatedPageNotice([holder({ task })])!
    expect(notice).toContain(`for: ${'x'.repeat(160)}…. Its report`)
    expect(notice).not.toContain('x'.repeat(161))
  })

  it('tells a finished holder’s page to wait for the collection', () => {
    expect(delegatedPageNotice([holder({ state: 'finished' })])).toBe(
      'a-1 has finished with this page; collect its report with agent_results before reading it.',
    )
  })

  it('lists a collected report’s findings citing the page, then the fixed sentence', () => {
    const notice = delegatedPageNotice([
      holder({
        state: 'collected',
        findings: [
          { subject: 'Autofocus', detail: 'Supported on Camera Module 3.' },
          { subject: 'HDR', detail: 'Available at 1536x864.' },
        ],
      }),
    ])
    expect(notice).toBe(
      [
        "a-1's report already covers this page:",
        '- Autofocus: Supported on Camera Module 3.',
        '- HDR: Available at 1536x864.',
        DELEGATED_PAGE_COLLECTED_INSTRUCTION,
      ].join('\n'),
    )
  })

  it('caps the collected findings and counts the rest', () => {
    const findings = Array.from({ length: DELEGATED_PAGE_NOTICE_FINDINGS + 3 }, (_, index) => ({ subject: `s${index}`, detail: `d${index}` }))
    const lines = delegatedPageNotice([holder({ state: 'collected', findings })])!.split('\n')
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(DELEGATED_PAGE_NOTICE_FINDINGS)
    expect(lines).toContain('and 3 more in its report.')
    expect(lines.at(-1)).toBe(DELEGATED_PAGE_COLLECTED_INSTRUCTION)
  })

  it('says nothing of a collected report that cites nothing from the page', () => {
    expect(delegatedPageNotice([holder({ state: 'collected', findings: [] })])).toBeNull()
  })

  it('names each holder of a page delegated more than once', () => {
    const notice = delegatedPageNotice([holder(), holder({ agentId: 'a-2', state: 'finished' })])!
    expect(notice.split('\n')).toEqual([
      expect.stringMatching(/^a-1 \[browsing\] was sent to this page/),
      'a-2 has finished with this page; collect its report with agent_results before reading it.',
    ])
  })

  it('is null with no holder', () => {
    expect(delegatedPageNotice([])).toBeNull()
  })
})

describe('the URLs a task names', () => {
  it('reads every web address in the free text, trailing punctuation left off', () => {
    expect(urlsInTask('Open https://www.raspberrypi.com/documentation/camera_software.html (parts 1-7) and "https://a.example/b?x=1".')).toEqual([
      'https://www.raspberrypi.com/documentation/camera_software.html',
      'https://a.example/b?x=1',
    ])
  })

  it('leaves a sentence’s closing punctuation off the address it ends on', () => {
    expect(urlsInTask('Read https://a.example/docs/camera.html. Then https://b.example/x, and stop')).toEqual([
      'https://a.example/docs/camera.html',
      'https://b.example/x',
    ])
  })

  it('reads none from a task naming no address', () => {
    expect(urlsInTask('Compare the two camera modules')).toEqual([])
  })
})

describe('when the Notice fires: once per page, holder and state', () => {
  const page = 'https://www.raspberrypi.com/documentation/camera_software.html'

  it('fires on the first call on a delegated page and not again in the same state', () => {
    const notices = createDelegatedPageNotices(() => [holder()])
    expect(notices.onPage(page)).toMatch(/^a-1 \[browsing\]/)
    expect(notices.onPage(page)).toBeNull()
    // The same page by the store's canonical rule: a fragment is no new page.
    expect(notices.onPage(`${page}#part-5`)).toBeNull()
  })

  it('fires again when the holder’s state changes on a page the Run stays on', () => {
    let state: DelegatedHolder['state'] = 'running'
    const notices = createDelegatedPageNotices(() => [holder({ state, findings: [{ subject: 's', detail: 'd' }] })])
    expect(notices.onPage(page)).toMatch(/was sent to this page/)
    state = 'finished'
    expect(notices.onPage(page)).toMatch(/has finished with this page/)
    state = 'collected'
    expect(notices.onPage(page)).toMatch(/report already covers this page/)
    expect(notices.onPage(page)).toBeNull()
  })

  it('fires for a second holder sent to a page the first already announced', () => {
    let holders = [holder()]
    const notices = createDelegatedPageNotices(() => holders)
    notices.onPage(page)
    holders = [holder(), holder({ agentId: 'a-2' })]
    const notice = notices.onPage(page)!
    expect(notice).toMatch(/^a-2 \[browsing\]/)
    expect(notice).not.toContain('a-1')
  })

  it('keeps each page apart', () => {
    const notices = createDelegatedPageNotices(() => [holder()])
    expect(notices.onPage(page)).not.toBeNull()
    expect(notices.onPage('https://www.raspberrypi.com/documentation/accessories/camera.html')).not.toBeNull()
  })

  it('attaches nothing on a page no Subagent holds, or with no page at all', () => {
    const notices = createDelegatedPageNotices((url) => (url === page ? [holder()] : []))
    expect(notices.onPage('https://elsewhere.example/')).toBeNull()
    expect(notices.onPage(null)).toBeNull()
    expect(notices.onPage('about:blank')).toBeNull()
  })

  it('loses the Notice, never the call, when the lookup throws', () => {
    const notices = createDelegatedPageNotices(() => {
      throw new Error('registry gone')
    })
    expect(notices.onPage(page)).toBeNull()
  })
})
