import { describe, expect, it } from 'vitest'
import { createSiteQuestionDesk, type SiteQuestionEvent } from './siteQuestionDesk'

// The Site Question desk (#423): the pane raises the page's confirm here,
// the runner answers it from here. The page waits on the answer.

const QUESTION = { kind: 'confirm' as const, text: 'Delete this video?' }

describe('the Site Question desk', () => {
  it('holds a raised question open until it is answered, and settles the page with the answer', async () => {
    const desk = createSiteQuestionDesk()
    const settled: boolean[] = []
    desk.raise(QUESTION, async (accept) => {
      settled.push(accept)
    })
    expect(desk.open()).toEqual(QUESTION)
    expect(await desk.answer(true)).toBe(true)
    expect(settled).toEqual([true])
    expect(desk.open()).toBeNull()
  })

  it('answers nothing when no question is open', async () => {
    expect(await createSiteQuestionDesk().answer(false)).toBe(false)
  })

  it('tells its listeners of a question, an alert and a question the page closed itself', () => {
    const desk = createSiteQuestionDesk()
    const heard: SiteQuestionEvent[] = []
    desk.subscribe((event) => heard.push(event))
    desk.raise(QUESTION, async () => {})
    desk.closed()
    desk.told('Saved.')
    expect(heard).toEqual([{ type: 'question', question: QUESTION }, { type: 'closed' }, { type: 'alert', text: 'Saved.' }])
    expect(desk.open()).toBeNull()
  })

  it('says nothing of a close when no question was open', () => {
    const desk = createSiteQuestionDesk()
    const heard: SiteQuestionEvent[] = []
    desk.subscribe((event) => heard.push(event))
    desk.closed()
    expect(heard).toEqual([])
  })
})
