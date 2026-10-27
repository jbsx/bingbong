import type { DecisionChoiceQuestion, DecisionQuestions } from '../ports/decisionModel.ts'
import type { MediaFacts } from '../browser/snapshot.ts'
import { applianceQuestions, applianceState, type ApplianceMedia, type ApplianceView } from '../command/applianceCard.ts'
import { isApplianceVerb, type StepContext } from '../command/jevReading.ts'
import { factOfLabel } from '../command/applianceFacts.ts'
import { appCardLabels, SETTINGS_LABEL, UPDATE_LABEL, updateOption } from '../command/appOp.ts'
import { isMediaOp } from '../command/mediaOp.ts'
import type { NameHearing } from '../command/nameMatch.ts'
import type { JevCase, JevExpectation } from './jevCase.ts'

// The Appliance companion of a recorded page-card ask (#485, the #370
// precedent): the Appliance Card the real builder makes from the state the
// ask recorded — the words, the Hearing, a Step's place, the page by its
// address and title, the media element the appliance had playing or
// started (read back off its media ref's line), and the appliance's own
// lines as that card carried them — with the answers the line should get
// on it. A line the page card read as an appliance op expects that op; a
// line about the page expects `page` or `none`, both of which go on to the
// page card. Only a hop-0 ask has a companion: a later hop keeps its card.

/** What a JSON string literal looks like inside a state line. */
const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`

const HEARD_FROM: Readonly<Record<string, NameHearing['from']>> = { 'a name on this page': 'page', 'a name the user taught the app': 'learned', 'a command the app answers to': 'command' }

/** A clock as the state prints one (`1:02`, `1:02:03`) in seconds. */
function secondsOf(clock: string): number {
  return clock.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

const MEDIA_STATE_RE = new RegExp(
  String.raw`^\[(\d+)\] media (${JSON_STRING}).*? (playing|paused|ended) (?:live (\d+(?::\d+)+)|(\d+(?::\d+)+)/(\d+(?::\d+)+)) (?:muted|volume (\d+)%) loop (on|off)(?: speed ([\d.]+)×)?(?: captions (\S+))?( buffering)?( failed)?`,
)

/** A media ref's line read back into its element's facts, with what its card offered: a seek only with a seekable range, captions only with text tracks. */
function mediaOfRefLine(line: string, options: ReadonlySet<string>): (ApplianceMedia & { readonly ref: number }) | null {
  const match = MEDIA_STATE_RE.exec(line)
  if (match === null) return factlessMedia(line, options)
  const [, ref, label, playing, live, at, of, volume, loop, rate, captions, buffering, failed] = match
  const n = Number(ref)
  const currentTime = secondsOf(live ?? at!)
  const duration = live !== undefined ? Infinity : secondsOf(of!)
  const seekable = options.has(`forward-${n}`) || options.has(`back-${n}`) ? { start: 0, end: Number.isFinite(duration) ? duration : currentTime } : null
  const facts: MediaFacts = {
    paused: playing !== 'playing',
    ended: playing === 'ended',
    currentTime,
    duration,
    volume: volume === undefined ? 1 : Number(volume) / 100,
    muted: volume === undefined,
    loop: loop === 'on',
    rate: rate === undefined ? 1 : Number(rate),
    seekable,
    tracks: options.has(`captions-${n}`) || options.has(`uncaptions-${n}`) ? 1 : 0,
    captions: captions === undefined || captions === 'off' ? null : captions,
    hiddenTrack: false,
    buffering: buffering !== undefined,
    failed: failed !== undefined,
  }
  return { ref: n, title: JSON.parse(label!) as string, facts }
}

/**
 * A media ref recorded before its line carried its facts (#372's first
 * cards), whose card still offered its Media Ops: the element was there and
 * on, so it stands as playing from the start at full volume — a
 * reconstruction, the one the case's own expectation (an op on it) implies.
 */
function factlessMedia(line: string, options: ReadonlySet<string>): (ApplianceMedia & { readonly ref: number }) | null {
  const match = new RegExp(String.raw`^\[(\d+)\] media (${JSON_STRING})$`).exec(line)
  if (match === null) return null
  const n = Number(match[1])
  if (![...options].some((label) => new RegExp(`^[a-z]+-${n}$`).test(label) && isMediaOp(label.split('-')[0]!))) return null
  const seekable = options.has(`forward-${n}`) ? { start: 0, end: 0 } : null
  const facts: MediaFacts = { paused: false, ended: false, currentTime: 0, duration: 0, volume: 1, muted: false, loop: false, rate: 1, seekable, tracks: options.has(`captions-${n}`) ? 1 : 0, captions: null, hiddenTrack: false, buffering: false, failed: false }
  return { ref: n, title: JSON.parse(match[2]!) as string, facts }
}

/** The media the appliance had (ADR 0079 as amended): the element playing, else the first that started; a never-started one is page content. */
function applianceMediaOf(lines: readonly string[], options: ReadonlySet<string>, playingTitle: string | null): ApplianceMedia | undefined {
  const media = lines.flatMap((line) => {
    const read = mediaOfRefLine(line, options)
    return read === null ? [] : [read]
  })
  const picked = media.find((each) => !each.facts.paused && !each.facts.ended) ?? media.find((each) => each.facts.currentTime > 0)
  if (picked === undefined) return undefined
  return { title: picked.title !== '' ? picked.title : (playingTitle ?? ''), facts: picked.facts }
}

function hearingOf(line: string | undefined): NameHearing[] {
  if (line === undefined) return []
  const item = new RegExp(String.raw`(${JSON_STRING}) sounds like (${JSON_STRING}), (a name on this page|a name the user taught the app|a command the app answers to)`, 'g')
  return [...line.matchAll(item)].map((match) => ({ heard: JSON.parse(match[1]!) as string, candidate: JSON.parse(match[2]!) as string, from: HEARD_FROM[match[3]!]! }))
}

/** Whether a page-card label is one the appliance holds: an Appliance Verb, a fact, an app op, `resume`. */
function isApplianceLabel(label: string): boolean {
  return isApplianceVerb(label) || factOfLabel(label) !== null || appCardLabels().includes(label) || label === 'settings' || label === UPDATE_LABEL || label === 'resume' || label.startsWith('show_')
}

/** A page-card Media Op label (`pause-7`) as the Appliance Card names it (`media-pause`); null for any other. */
function mediaLabelOf(label: string): string | null {
  const match = /^([a-z]+)-\d+$/.exec(label)
  return match !== null && isMediaOp(match[1]!) ? `media-${match[1]}` : null
}

/** A hop-0 page-card ask: the first reading's, the Where Ask's or the Mark Ask's, never a later hop's, a settings ask or another kind. */
export function isHopZeroCommandAsk(ask: { readonly state: string; readonly questions: DecisionQuestions }): boolean {
  const action = ask.questions.action as DecisionChoiceQuestion | undefined
  const settings = action?.instructions.startsWith("The user's words change one of the app's settings") === true
  return ask.state.startsWith('The user spoke to a web browser: ') && action !== undefined && 'slot' in ask.questions && !settings && !('progress' in ask.questions) && !/^This is step \d+ of the task\./m.test(ask.state)
}

/** The version the corpus's update line names (#422): a page card records none, and the line carries one as the app's does. */
const CORPUS_VERSION = '0.1.1'

/** The Appliance companion's ask for a recorded hop-0 page-card ask; null for an ask that has none. */
export function applianceAskOf(ask: { readonly state: string; readonly questions: DecisionQuestions }): { state: string; questions: DecisionQuestions; view: ApplianceView } | null {
  if (!isHopZeroCommandAsk(ask)) return null
  const lines = ask.state.split('\n')
  const text = JSON.parse(lines[0]!.slice('The user spoke to a web browser: '.length)) as string
  const page = new RegExp(String.raw`^Page: (.*) — (${JSON_STRING})$`).exec(lines.find((line) => line.startsWith('Page: ')) ?? '')
  const stepLine = new RegExp(String.raw`^Step (\d+) of (\d+) of the line: (${JSON_STRING})$`).exec(lines.find((line) => line.startsWith('Step ')) ?? '')
  const done = lines.find((line) => line.startsWith('Done so far: '))?.slice('Done so far: '.length)
  const step: StepContext | undefined = stepLine === null ? undefined : { step: Number(stepLine[1]), of: Number(stepLine[2]), line: JSON.parse(stepLine[3]!) as string, done: done !== undefined ? [done] : [] }
  const heard = hearingOf(lines.find((line) => line.startsWith('Heard by ear')))
  const action = ask.questions.action as DecisionChoiceQuestion
  const offered = new Set(Object.keys(action.options))
  const playingTitle = new RegExp(String.raw`^(?:Playing|Paused): (${JSON_STRING})`).exec(lines.find((line) => /^(Playing|Paused): /.test(line)) ?? '')?.[1]
  const pageTitle = page?.[2] !== undefined ? (JSON.parse(page[2]) as string) : ''
  // The collect titles its media by the element's own title, else the page's (collectPageScript.ts).
  const media = applianceMediaOf(lines, offered, playingTitle !== undefined ? (JSON.parse(playingTitle) as string) : pageTitle)
  const own = Object.fromEntries(
    Object.entries(action.options).flatMap(([label, line]) => {
      if (!isApplianceLabel(label) || line === null) return []
      // The update (#422) is on the Appliance Card alone: beside the settings line, wherever the page card carried the app's lines.
      const update = updateOption({ version: CORPUS_VERSION })
      return label === SETTINGS_LABEL ? [[label, line] as const, [update.label, update.line] as const] : [[label, line] as const]
    }),
  )
  const appAmount = 'amount' in ask.questions && !Object.keys(action.options).some((label) => mediaLabelOf(label) !== null)
  const view: ApplianceView = {
    url: page?.[1] ?? '',
    title: page?.[2] !== undefined ? (JSON.parse(page[2]) as string) : '',
    ...(media !== undefined ? { media } : {}),
    flaggable: true,
    timer: true,
    recorded: { lines: own, amount: appAmount },
  }
  const questions = applianceQuestions(text, view, { steps: 'steps' in ask.questions, heard })
  return { state: applianceState(text, view, heard, step), questions, view }
}

const ON_TO_PAGE = 'page|none'

/** An action label of the page card as the companion expects it: the appliance's own op as itself, anything on the page as `page` or `none`. */
function companionLabel(label: string): string {
  const alternatives = label.split('|').map((each) => each.trim())
  const mapped = new Set<string>()
  for (const alternative of alternatives) {
    const media = mediaLabelOf(alternative)
    if (media !== null) mapped.add(media)
    else if (isApplianceLabel(alternative)) mapped.add(alternative)
    else {
      mapped.add('page')
      mapped.add('none')
    }
  }
  return [...mapped].join('|')
}

/**
 * The companion's expectations (#485): the action as {@link companionLabel}
 * maps it; a `!=` on one of the appliance's own ops kept, one on the page
 * dropped; the Slot, Amount and `where` kept beside an appliance op that
 * reads them, `steps` always; nothing left on the action expects the line
 * to go on to the page card.
 */
export function companionExpectations(expect: readonly JevExpectation[], questions: DecisionQuestions): JevExpectation[] {
  const kept: JevExpectation[] = []
  let action: JevExpectation | null = null
  for (const expectation of expect.filter((each) => each.question === 'action')) {
    if ('label' in expectation) action = { ...expectation, label: companionLabel(expectation.label) }
    else if ('not' in expectation) {
      const mapped = mediaLabelOf(expectation.not) ?? (isApplianceLabel(expectation.not) ? expectation.not : null)
      if (mapped !== null) kept.push({ ...expectation, not: mapped })
    }
  }
  const actionLabels = action !== null && 'label' in action ? action.label.split('|') : []
  const onAppliance = actionLabels.length > 0 && !actionLabels.includes('page')
  const readsBeside = (question: string): boolean => {
    if (question === 'steps') return true
    if (!onAppliance) return false
    if (question === 'slot' || question === 'amount') return true
    return question === 'where' && actionLabels.includes('play')
  }
  const beside = expect.filter((each) => each.question !== 'action' && each.question in questions && readsBeside(each.question))
  const head: JevExpectation[] = action !== null ? [action] : kept.length === 0 ? [{ question: 'action', label: ON_TO_PAGE }] : []
  return [...head, ...kept, ...beside]
}

/** The name a case's Appliance companion goes by in the corpus. */
export const companionName = (name: string): string => `${name}-appliance`

/** Whether a corpus name is a companion's own. */
export const isCompanionName = (name: string): boolean => name.endsWith('-appliance')

/** A corpus case's Appliance companion; null for a case with none (a later hop, a settings ask, a kind the card never meets). */
export function companionCase(name: string, jevCase: JevCase): JevCase | null {
  if (isCompanionName(name)) return null
  const ask = applianceAskOf(jevCase.ask)
  if (ask === null) return null
  return {
    ...(jevCase.turnId !== undefined ? { turnId: jevCase.turnId } : {}),
    ...(jevCase.transcript !== undefined ? { transcript: jevCase.transcript } : {}),
    note: `The Appliance Card's ask for ${name} (#485): built by \`pnpm jev:appliance\` from the state that case recorded.`,
    ...(jevCase.model !== undefined ? { model: jevCase.model } : {}),
    ...(jevCase.recordedAt !== undefined ? { recordedAt: jevCase.recordedAt } : {}),
    expect: companionExpectations(jevCase.expect, ask.questions),
    ask: { state: ask.state, questions: ask.questions },
  }
}
