import { DEFAULT_DECISION_THRESHOLDS, choiceProbability, type DecisionChoiceQuestion } from '../ports/decisionModel'
import type { MediaFacts, PageMedia } from '../browser/snapshot'
import { isRealPage } from '../browser/lastPage'
import { parseDuration } from '../timer/duration'
import { readTimerWords } from '../timer/timerWords'
import type { Command, CommandPage } from './command'
import type { NameHearing } from './nameMatch'
import { isMediaEngine } from './siteScope'
import { MEDIA_OPS, amountQuestion, mediaOpLineOf, mediaOpsOf, mediaStateOf, rateLevel, volumeLevel, type LevelRung, type MediaOp } from './mediaOp'
import { factOfLabel, sayOptions, withPageSong } from './applianceFacts'
import { appCardOptions, appOpOf, DASHBOARD_LINE, takesAmount, updateOption } from './appOp'
import { DOING_LABEL, readFate, runningLines, withEnded, withRunning, type EndedCommand, type Fate, type RunningCommand } from './runningCommand'
import {
  appCommand,
  applianceCommand,
  applianceVerbLine,
  heardLine,
  isApplianceVerb,
  mediaActionOf,
  offeredApplianceVerbs,
  scopableSite,
  slotQuestion,
  slotWords,
  stepsQuestion,
  whereQuestion,
  type Appliance,
  type CommandAnswers,
  type StepContext,
} from './jevReading'

// The Appliance Card (#485): every line the Local Match cannot settle is
// read first on a small card built from what the appliance already holds —
// the media element playing or started and every Media Op its kind allows,
// the Player's Appliance Verbs, the facts, the app's own ops, resume, the
// Flag, Help, the Timer, `stop` — with no page collect and none of the
// page's refs. `page` is one of its options: a line about something on the
// page open goes on to today's page card, unchanged, and so does `none`
// (ADR 0082: a hop-0 none asks again, never ends). The "question split in
// two" paid strategy of AGENTS.md ("Jev decides"), reached after Jev failed
// with the whole class in front of it (#478, #458, #422): on the page card
// a page ref lured the appliance line (Dislike, the browser's `back`, the
// promo's play-N) or drowned it among 146 page-ref options.

/** The media element the appliance has playing or started (ADR 0079 as amended: the Player's `#movie_player video` first, else the page's own as the collect picks it): its title and its own facts. */
export interface ApplianceMedia {
  readonly title: string
  readonly facts: MediaFacts
}

/** What the Appliance Card is built from: the page open by its address and title alone, the media fact, and what the appliance holds. */
export interface ApplianceView {
  readonly url: string
  readonly title: string
  readonly media?: ApplianceMedia
  readonly appliance?: Appliance
  /** A Task the Flag would name (#421): `flag` is offered only while there is one. */
  readonly flaggable?: boolean
  /** A Timer is wired: its set and off are offered. */
  readonly timer?: boolean
  /**
   * The appliance's own lines as a recorded page-card ask carried them (the
   * corpus converter, #485): its Appliance Verbs, facts, app ops and
   * resume, each line as the appliance worded it then, standing in for the
   * lines `appliance` would make; `amount` whether that card asked one.
   */
  readonly recorded?: { readonly lines: Readonly<Record<string, string>>; readonly amount: boolean }
  /** The line still running when this one is read (#489): its lines on the state, the doing fact and the Fate question. Absent, the card is unchanged. */
  readonly running?: RunningCommand
  /** The line just ended, within its window (#499): the doing fact for it, while nothing runs; the state is unchanged. Absent, the card is unchanged. */
  readonly ended?: EndedCommand
}

/** How the card is asked: whether `steps` rides it (hop 0 of a whole line), and the Hearing. */
export interface ApplianceAskOptions {
  readonly steps?: boolean
  readonly heard?: readonly NameHearing[]
}

/** The Appliance Card's questions: the action card and the Slot; the Amount beside a media op or an app amount; `where` beside `play` on a site; `steps` at hop 0 on a line with a conjunction. */
export type ApplianceQuestions = {
  readonly action: DecisionChoiceQuestion
  readonly slot: DecisionChoiceQuestion
  readonly amount?: DecisionChoiceQuestion
  readonly where?: DecisionChoiceQuestion
  readonly steps?: DecisionChoiceQuestion
  /** The running Command's Fate (#489), only while one runs. */
  readonly fate?: DecisionChoiceQuestion
}

/** How the Appliance Card stands in the env (#485): null when `BINGBONG_APPLIANCE_CARD=off`; else its asks, sequential unless `BINGBONG_APPLIANCE_ASKS=parallel` (T1). */
export function applianceCardOf(env: Readonly<Record<string, string | undefined>>): { readonly asks: 'sequential' | 'parallel' } | null {
  const said = (key: string): string => (env[key] ?? '').trim().toLowerCase()
  if (said('BINGBONG_APPLIANCE_CARD') === 'off') return null
  return { asks: said('BINGBONG_APPLIANCE_ASKS') === 'parallel' ? 'parallel' : 'sequential' }
}

/** The label of the option that sends the line on to the page card. */
export const PAGE_LABEL = 'page'

/** A Media Op's label on this card: the op on the element by kind, never by a ref number (ADR 0079 as amended). */
const mediaLabel = (op: MediaOp): string => `media-${op}`
const MEDIA_LABEL_RE = /^media-([a-z]+)$/

/** The appliance's own verbs past the Player's, each one line (T3 wording, measured on the gate). */
const OWN_LINES = {
  flag: 'the app: mark the last thing it did as a failure, for its makers to look at — the words after it, if any, are the hint',
  help: 'the app: show and say what it can be asked to do',
  timer: 'the app: set a timer for the length the words say',
  timer_off: 'the app: turn the timer off',
  stop: 'stop what the app is doing: the page loading, the voice speaking',
} as const

/** The line that sends the line on to the page card (T3). */
function pageLine(view: ApplianceView): string {
  return isRealPage(view.url) ? `something on the page open, ${JSON.stringify(view.title)}: its links, buttons, fields or text` : 'something on a web page: the screen shows none'
}

/** The ops whose card line says the media is the one already on (T3): a title in the words is a new song, the music's `play`. */
const MEDIA_LINES: Partial<Record<MediaOp, (named: string) => string>> = {
  play: (named) => `carry on playing ${named}, the one already on: unpause it — never a song the words name, which is the music's play`,
  restart: (named) => `play ${named} again from the start: repeat it once, now`,
  loop: (named) => `put ${named} on loop, so it plays again each time it ends`,
}

/** Each up and down rung's resulting level, on the volume's and the speed's own line (the B rider, T3): `down a little → 45%`. */
function levelsOf(op: 'volume' | 'rate', facts: MediaFacts): string {
  const sizes = ['little', 'step', 'lot'] as const
  const level = (rung: LevelRung): string => (op === 'volume' ? `${volumeLevel(rung, '', facts)}%` : `${rateLevel(rung, '', facts)}×`)
  const way = (dir: 'up' | 'down'): string => sizes.map((size) => `${dir} a ${size} → ${level(`${dir}-${size}` as LevelRung)}`).join(', ')
  return ` (${way('down')}; ${way('up')})`
}

/**
 * The browser view's line on this card names it the app's own home screen,
 * so a line about a site's home page reads `page` and that home stays a page
 * ref (#485's close, 2026-10-27: pick, never ask). A guess: the next
 * home-page line in the ledger settles it.
 */
const HOME_LINE = "app: show the app's own home screen, the browser, leaving Settings or the Weight page — not a website's home page"

/** An app option's line as this card words it, a recorded page-card line among them. */
function appLineOf(label: string, line: string): string {
  return label === 'show_dashboard' ? line.replace(DASHBOARD_LINE, HOME_LINE) : line
}

const NONE_LINE = 'not a command: a remark, a question to no one, noise'

const INSTRUCTIONS =
  "Which one action does the appliance take for the user's words? Each option is a whole action on what the appliance itself holds: what is playing, the music, the app, what it knows. Choose page when the words are about something on the page open. Choose none when the words are not a command."

/** The state the card is asked over: the words, the Hearing, a Step's place, the page by its address and title, and what is playing. */
export function applianceState(text: string, view: ApplianceView, heard?: readonly NameHearing[], step?: StepContext): string {
  return [
    `The user spoke to the appliance, a voice-driven web browser: ${JSON.stringify(text)}`,
    // The line still running, right after the words (#494, measured on the Overlap Jev cases): a split line's second half reads as its rest.
    ...(view.running !== undefined ? runningLines(view.running) : []),
    ...heardLine(heard),
    ...(step !== undefined ? [`Step ${step.step} of ${step.of} of the line: ${JSON.stringify(step.line)}`] : []),
    ...(step !== undefined && step.done.length > 0 ? [`Done so far: ${step.done.join('; ')}`] : []),
    isRealPage(view.url) ? `Page open: ${view.url} — ${JSON.stringify(view.title)}` : 'Page open: none, the screen is blank',
    view.media !== undefined ? `Playing: ${JSON.stringify(view.media.title)} ${mediaStateOf(view.media.facts)}` : 'Playing: nothing',
  ].join('\n')
}

/** The media as the page's song fact reads it (#402): what `say_playing` says when the Player holds none. */
export function pageMediaOf(media: ApplianceMedia | undefined): PageMedia | undefined {
  if (media === undefined) return undefined
  const { facts } = media
  return { title: media.title, paused: facts.paused, currentTime: facts.currentTime, duration: facts.duration, loop: facts.loop, muted: facts.muted }
}

/** The page an appliance reading fires against: the page open by its address and title, no refs, the media on it. */
export function appliancePage(view: ApplianceView): CommandPage {
  const media = pageMediaOf(view.media)
  return { url: view.url, title: view.title, refs: [], ...(media !== undefined ? { media } : {}) }
}

/** The Appliance Card (#485): every option by kind, from what the appliance holds, and `page` and `none`. */
export function applianceQuestions(text: string, view: ApplianceView, options: ApplianceAskOptions = {}): ApplianceQuestions {
  const { appliance, media } = view
  const named = media === undefined ? '' : `the media playing, ${JSON.stringify(media.title)}`
  const ops = media === undefined ? [] : mediaOpsOf(media.facts)
  const verbs = offeredApplianceVerbs(appliance, media !== undefined)
  const facts = appliance?.facts === undefined ? {} : sayOptions(withPageSong(appliance.facts, pageMediaOf(media)))
  // The app's ops, its update among them (#422): on this card alone, which the page card's lines do not crowd.
  const app = appliance?.app === undefined ? [] : [...appCardOptions(appliance.app), updateOption(appliance.app)]
  const resume = appliance?.lastPage === undefined || isRealPage(view.url) ? [] : [['resume', `reopen the last page the screen showed: ${JSON.stringify(appliance.lastPage)}`] as const]
  const recorded = view.recorded === undefined ? undefined : Object.fromEntries(Object.entries(view.recorded.lines).map(([label, line]) => [label, appLineOf(label, line)]))
  const own: Readonly<Record<string, string>> = recorded ?? {
    ...Object.fromEntries(verbs.map((verb) => [verb, applianceVerbLine(verb)])),
    ...facts,
    ...Object.fromEntries(app.map((option) => [option.label, appLineOf(option.label, option.line)])),
    ...Object.fromEntries(resume),
  }
  const action: DecisionChoiceQuestion = {
    type: 'choice',
    instructions: INSTRUCTIONS,
    options: {
      ...Object.fromEntries(ops.map((op) => [mediaLabel(op), `${MEDIA_LINES[op]?.(named) ?? mediaOpLineOf(op, named)}${(op === 'volume' || op === 'rate') && media !== undefined ? levelsOf(op, media.facts) : ''}`])),
      ...own,
      ...(view.timer === true ? { timer: OWN_LINES.timer, timer_off: OWN_LINES.timer_off } : {}),
      ...(view.flaggable === true ? { flag: OWN_LINES.flag } : {}),
      help: OWN_LINES.help,
      stop: OWN_LINES.stop,
      [PAGE_LABEL]: pageLine(view),
      none: NONE_LINE,
    },
  }
  const amounts = ops.length > 0 || (view.recorded?.amount ?? app.some((option) => takesAmount(option.op)))
  const site = Object.hasOwn(own, 'play') ? scopableSite(view.url, undefined) : null
  const steps = options.steps === true ? stepsQuestion(text) : null
  const questions: ApplianceQuestions = {
    action,
    slot: slotQuestion(text, options.heard),
    ...(amounts ? { amount: amountQuestion() } : {}),
    ...(site !== null ? { where: whereQuestion(site) } : {}),
    ...(steps !== null ? { steps } : {}),
  }
  if (view.running !== undefined) return withRunning('', questions, view.running).questions
  return view.ended === undefined ? questions : withEnded('', questions, view.ended).questions
}

/** The Fate the answers read for the line still running (#489); none while nothing runs. Unsure or unanswered, it goes on. */
export function fateOfAnswers(answers: CommandAnswers, view: ApplianceView): Fate | undefined {
  return view.running === undefined ? undefined : readFate((answers as unknown as { readonly fate?: Parameters<typeof readFate>[0] }).fate)
}

/** What the Appliance Card's answers come to: a Command fired from it, the Flag, or the line going on to the page card — `page`, or `none`. */
export type ApplianceReading =
  | { readonly kind: 'command'; readonly command: Command }
  | { readonly kind: 'flag'; readonly hint?: string }
  | { readonly kind: 'page'; readonly chose: 'page' | 'none' }

const ON_TO_PAGE: ApplianceReading = { kind: 'page', chose: 'page' }

/**
 * The reading the Appliance Card's answers make (#485): its top option, as
 * the page card reads its own (the top Choice at any confidence). A Media
 * Op reaches its element by kind (`target` null); a `play` whose words
 * point at this page needs refs, and goes on to the page card; one an
 * option cannot fire (a volume `to` with no number, a timer with no
 * length) goes on too, where the whole page is in front of Jev.
 */
export function readApplianceAnswers(answers: CommandAnswers, text: string, view: ApplianceView): ApplianceReading {
  const label = answers.action.choice
  if (label === 'none') return { kind: 'page', chose: 'none' }
  // Only a sure pick fires here (the rulings' "a sure appliance pick fires"): the page card, a superset, reads an unsure one.
  if (choiceProbability(answers.action) < DEFAULT_DECISION_THRESHOLDS.choice) return ON_TO_PAGE
  if (label === PAGE_LABEL) return ON_TO_PAGE
  const command = (made: Command): ApplianceReading => ({ kind: 'command', command: made })
  const media = MEDIA_LABEL_RE.exec(label)
  if (media !== null) {
    const op = MEDIA_OPS.find((candidate) => candidate === media[1])
    const action = op === undefined || view.media === undefined ? null : mediaActionOf(op, view.media.facts, answers, text)
    return action === null ? ON_TO_PAGE : command({ verb: 'media', target: null, slot: null, mediaOp: action })
  }
  if (isApplianceVerb(label)) {
    if (label === 'play' && 'where' in answers && answers.where.choice === 'page' && !isMediaEngine(view.url)) return ON_TO_PAGE
    return command(applianceCommand(label, answers.slot, text, answers, view.url, undefined))
  }
  const fact = factOfLabel(label)
  if (fact !== null && (fact !== 'doing' || (label === DOING_LABEL && (view.running !== undefined || view.ended !== undefined)))) return command({ verb: 'say', target: null, slot: null, fact })
  const app = view.appliance?.app
  const op = app === undefined ? null : appOpOf(label, app)
  if (op !== null) return command(appCommand(op, answers, text))
  const carried = answers.slot.choice === 'none' ? '' : slotWords(answers.slot, text)
  switch (label) {
    case 'resume':
      return command({ verb: 'resume', target: null, slot: null })
    case 'help':
      return command({ verb: 'help', target: null, slot: null })
    case 'stop':
      return command({ verb: 'stop', target: null, slot: null })
    case 'timer_off':
      return command({ verb: 'timer', target: null, slot: null })
    case 'timer': {
      const said = readTimerWords(text)
      const durationMs = said?.kind === 'set' ? said.durationMs : parseDuration(carried)
      return durationMs === null ? ON_TO_PAGE : command({ verb: 'timer', target: null, slot: null, durationMs })
    }
    case 'flag':
      return carried === '' ? { kind: 'flag' } : { kind: 'flag', hint: carried }
    default:
      return ON_TO_PAGE
  }
}
