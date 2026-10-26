// The ask put to the Planner (#465, ADR 0095) and the reading of its
// reply: the system instructions name the one JSON answer it gives (the
// next action by kind with its class, done with its own sentence, or one
// question back), the user message carries the Goal Line on its own
// labelled line, the page, the Appliance Verbs, the Errand's memory and
// the last card. A reply is read as the first JSON object in it; anything
// that is not exactly one of the answers is refused with the reason,
// never half-read. Imports carry .ts extensions: the gate scripts run this
// under node's type stripping (#36).

import { reportFault } from '../trace/fault.ts'
import type { PlannerAction, PlannerActionKind, PlannerAnswer, PlannerRequest } from '../ports/plannerModel'

const ACTION_KINDS: readonly PlannerActionKind[] = ['click', 'type', 'scroll', 'press', 'navigate', 'back', 'read', 'media', 'capture', 'verb', 'option']

export const PLANNER_INSTRUCTIONS = [
  'You drive a voice-controlled web browser for the person who spoke the Goal Line. You see the page as a card of numbered refs and the lines it offers, the steps already taken and what was captured. Name the one next thing to do.',
  '',
  'Reply with exactly one JSON object and nothing else, one of:',
  '{"next": "act", "action": {…}, "class": "stays" | "leaves", "why": "<one short line: what this step is for>"}',
  '{"next": "done", "sentence": "<what came of it, said aloud to the person>"}',
  '{"next": "ask", "question": "<one question back, said aloud>"}',
  '',
  'An action is one of:',
  '{"kind": "click", "ref": N}',
  '{"kind": "type", "ref": N, "text": "…"} (types into a field; press Enter or click its button to send it)',
  '{"kind": "scroll", "direction": "up" | "down"} (add "ref": N to scroll one part of the page)',
  '{"kind": "press", "key": "Enter"}',
  '{"kind": "navigate", "url": "https://…"}',
  '{"kind": "back"}',
  '{"kind": "read", "part": "1"} (the page\'s whole text, a part at a time: the step\'s outcome holds the text and says how many parts there are)',
  '{"kind": "media", "ref": N, "op": "<a media op the ref offers>", "amount": "<how far, when the op takes one>"}',
  '{"kind": "capture", "ref": N} (puts a link\'s address or an image on the Shelf and the clipboard)',
  '{"kind": "option", "option": "<an id the card offers>", "text": "<words, for a line that takes them>"} (any line on the card by its id: show-N brings a block into view; capture-text-N, capture-view-N and capture-page copy a block or the page; open-N opens a link further down)',
  '{"kind": "verb", "verb": "<an Appliance Verb>", "words": "<its words>"}',
  '',
  'class is "leaves" when the action\'s effect leaves the appliance for other people or the world: it posts, sends, pays, orders, deletes, submits, publishes, replies, comments or subscribes. Otherwise "stays". A "leaves" action is said back to the person and waits for their yes; their answer comes back as a step.',
  'Ask back when the Goal Line, the page and what was captured do not say what is meant; never guess at what only the person knows. One question at a time.',
  'Say done when the Goal Line is carried out, or cannot be, in a sentence that tells the person the outcome itself, not "Done". A page that wants a sign-in first cannot be carried further: say done, saying so.',
].join('\n')

/** The two messages of one Planner call. */
export function plannerMessages(request: Omit<PlannerRequest, 'signal'>): { system: string; user: string } {
  const { goalLine, page, verbs, memory } = request
  const verbLines = Object.entries(verbs).map(([name, what]) => (what === null ? `- ${name}` : `- ${name}: ${what}`))
  const stepLines = memory.steps.map((step, index) => {
    // Its class and its seconds, once the Errand loop took it (#467).
    const facts = [step.class, step.seconds !== undefined ? `${step.seconds.toFixed(1)} s` : undefined].filter((fact) => fact !== undefined)
    return `${index + 1}. ${step.action}${facts.length > 0 ? ` (${facts.join(', ')})` : ''} → ${step.outcome}`
  })
  const captureLines = memory.captures.map((capture) => `- ${capture.what}: ${capture.text !== undefined ? JSON.stringify(capture.text) : `on the Shelf as ${capture.file ?? 'a file'}`}`)
  const section = (title: string, lines: readonly string[], none: string): string => (lines.length === 0 ? `${title}: ${none}` : [`${title}:`, ...lines].join('\n'))
  const user = [
    // The user's words on a line of their own, labelled: a model copying a block copies the whole line.
    `Goal Line: ${goalLine}`,
    `Page: ${page.url} — ${JSON.stringify(page.title)}`,
    '',
    section('Appliance Verbs', verbLines, 'none'),
    '',
    section('Steps done', stepLines, 'none yet'),
    '',
    section('Captured', captureLines, 'nothing'),
    '',
    memory.card === null ? 'The card: none yet' : `The card:\n${memory.card}`,
  ].join('\n')
  return { system: PLANNER_INSTRUCTIONS, user }
}

/** The end of the balanced object that opens at `start`, strings respected; -1 when it never closes. */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let at = start; at < text.length; at++) {
    const char = text[at]
    if (inString) {
      if (char === '\\') at += 1
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return at
    }
  }
  return -1
}

/** The first JSON object in a reply — bare, fenced or after a sentence — or null when there is none. */
export function firstJsonObject(content: string): Record<string, unknown> | null {
  for (let start = content.indexOf('{'); start !== -1; start = content.indexOf('{', start + 1)) {
    const end = objectEnd(content, start)
    if (end === -1) return null
    try {
      const parsed: unknown = JSON.parse(content.slice(start, end + 1))
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch (error) {
      // Not JSON from this brace: the next one may open the answer.
      reportFault('planner.plannerAsk.firstJsonObject', error)
    }
  }
  return null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const refNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)

function readAction(raw: Record<string, unknown>): PlannerAction | string {
  const kind = raw.kind
  if (!ACTION_KINDS.includes(kind as PlannerActionKind)) return `action kind ${JSON.stringify(kind)} is not one of ${ACTION_KINDS.join(', ')}`
  const ref = refNumber(raw.ref)
  switch (kind as PlannerActionKind) {
    case 'click':
      return ref === null ? 'click needs a ref number' : { kind: 'click', ref }
    case 'capture':
      return ref === null ? 'capture needs a ref number' : { kind: 'capture', ref }
    case 'type': {
      const typed = typeof raw.text === 'string' ? raw.text : null
      return ref === null || typed === null ? 'type needs a ref number and its text' : { kind: 'type', ref, text: typed }
    }
    case 'scroll': {
      const direction = raw.direction
      if (direction !== 'up' && direction !== 'down') return 'scroll needs up or down'
      return ref === null ? { kind: 'scroll', direction } : { kind: 'scroll', direction, ref }
    }
    case 'press': {
      const key = text(raw.key)
      return key === null ? 'press needs a key' : { kind: 'press', key }
    }
    case 'navigate': {
      const url = text(raw.url)
      return url === null ? 'navigate needs a url' : { kind: 'navigate', url }
    }
    case 'back':
      return { kind: 'back' }
    case 'read': {
      const part = typeof raw.part === 'number' ? String(raw.part) : text(raw.part)
      return part === null ? 'read needs a part' : { kind: 'read', part }
    }
    case 'media': {
      const op = text(raw.op)
      if (ref === null || op === null) return 'media needs a ref number and its op'
      const amount = text(raw.amount)
      return amount === null ? { kind: 'media', ref, op } : { kind: 'media', ref, op, amount }
    }
    case 'option': {
      const option = text(raw.option)
      if (option === null) return 'option needs an id the card offers'
      const typed = typeof raw.text === 'string' && raw.text !== '' ? raw.text : null
      return typed === null ? { kind: 'option', option } : { kind: 'option', option, text: typed }
    }
    case 'verb': {
      const verb = text(raw.verb)
      if (verb === null) return 'verb needs its name'
      const words = text(raw.words)
      return words === null ? { kind: 'verb', verb } : { kind: 'verb', verb, words }
    }
  }
}

/** A reply's object read as the Planner's one answer, or the reason it is none. */
export function readPlannerAnswer(raw: unknown): PlannerAnswer | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const reply = raw as Record<string, unknown>
  switch (reply.next) {
    case 'done': {
      const sentence = text(reply.sentence)
      return sentence === null ? 'done carries no sentence' : { next: 'done', sentence }
    }
    case 'ask': {
      const question = text(reply.question)
      return question === null ? 'ask carries no question' : { next: 'ask', question }
    }
    case 'act': {
      if (typeof reply.action !== 'object' || reply.action === null) return 'no action'
      const action = readAction(reply.action as Record<string, unknown>)
      if (typeof action === 'string') return action
      if (reply.class !== 'stays' && reply.class !== 'leaves') return 'class is not stays or leaves'
      return { next: 'act', action, class: reply.class, why: typeof reply.why === 'string' ? reply.why.trim() : '' }
    }
    default:
      return 'next is not act, done or ask'
  }
}
