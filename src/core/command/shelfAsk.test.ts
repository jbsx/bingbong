import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer } from '../ports/decisionModel'
import type { FileChooser } from '../ports/browser'
import type { ShelfFile } from '../shelf/shelf'
import { promptChars } from '../decision/cardBudget'
import { fitShelfAsk, readShelfAnswer, shelfAsk } from './shelfAsk'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const file = (name: string, hoursAgo: number, size = 86_000): ShelfFile => ({ name, path: `/shelf/${name}`, modifiedMs: NOW - hoursAgo * HOUR, size })
const SHELF = [file('screenshot-3.jpg', 0.5), file('invoice-0423.pdf', 2), file('notes.txt', 30, 900)]
const CHOOSER: FileChooser = { node: 9, multiple: false, accept: 'image/*', label: 'Profile photo' }
const PAGE = { url: 'https://forum.example/settings', title: 'Settings' }
const choice = (label: string): DecisionChoiceAnswer => ({ type: 'choice', choice: label, confidence: 0.9, probabilities: { [label]: 0.9 } })

describe('the Shelf ask (#424): which file on the Shelf the words mean, once the page opened its chooser', () => {
  it('says the words, the page and the field, and offers each file on the Shelf newest first, and none', () => {
    const ask = shelfAsk('attach the screenshot', PAGE, CHOOSER, SHELF, NOW)
    expect(ask.state).toBe(
      [
        'The user spoke to a web browser: "attach the screenshot"',
        'Page: https://forum.example/settings — "Settings"',
        'The page opened its file chooser for its file field "Profile photo" accepts "image/*": the file chosen is set on the field, and nothing is sent.',
      ].join('\n'),
    )
    expect(ask.questions.file.options).toEqual({
      'file-1': 'upload "screenshot-3.jpg", 30 minutes old, 84 KB',
      'file-2': 'upload "invoice-0423.pdf", 2 hours old, 84 KB',
      'file-3': 'upload "notes.txt", a day old, 900 bytes',
      none: 'no file on the shelf is what the words mean',
    })
    expect(ask.files).toEqual(SHELF)
  })

  it('names a field with no label or accept by what it is', () => {
    expect(shelfAsk('upload it', PAGE, { node: 1, multiple: true, accept: '', label: '' }, SHELF, NOW).state.split('\n').at(-1)).toBe(
      'The page opened its file chooser for its file field takes several files: the file chosen is set on the field, and nothing is sent.',
    )
  })

  it('cuts the oldest files until the ask fits the Card Budget', () => {
    const many = Array.from({ length: 200 }, (_, index) => file(`report-${String(index).padStart(3, '0')}-with-a-long-name.pdf`, index))
    const budget = 6_000
    const ask = fitShelfAsk(budget, 'upload the report', PAGE, CHOOSER, many, NOW)
    expect(promptChars(ask.state, ask.questions)).toBeLessThanOrEqual(budget)
    expect(ask.files.length).toBeGreaterThan(10)
    expect(ask.files.length).toBeLessThan(200)
    expect(ask.files).toEqual(many.slice(0, ask.files.length))
  })

  it('reads the file chosen, and none as no file', () => {
    const ask = shelfAsk('attach the screenshot', PAGE, CHOOSER, SHELF, NOW)
    expect(readShelfAnswer(choice('file-2'), ask.files)).toEqual(SHELF[1])
    expect(readShelfAnswer(choice('none'), ask.files)).toBeNull()
    expect(readShelfAnswer(choice('file-9'), ask.files)).toBeNull()
  })
})
