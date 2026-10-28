import { describeCommand, targetLabel, type Command } from '../../core/command/command'
import type { ErrandRecord } from '../../core/command/decisionRecord'
import type { AppState } from '../../core/command/appOp'
import { confirmLine, confirmOf, isYes, type Typed } from '../../core/errand/confirmClass'
import { errandClock, type ErrandClock } from '../../core/errand/errandClock'
import { askedStep, capLine, confirmStep, errandMemory, faultLine, plannerMemoryOf, unansweredLine, unavailableLine, withCapture, withCard, withStep, type ErrandMemory, type ErrandStep, type TaskHandOff } from '../../core/errand/errandMemory'
import { errandVerbs, refitErrandCard, resolveAction, type ErrandCard } from '../../core/errand/plannerCommand'
import { cardChars, sizeRefusalOf, tighterBudget } from '../../core/decision/cardBudget'
import { plannerMessages } from '../../core/planner/plannerAsk'
import { plannerStepSpan, type ErrandOutcome, type PlannerStepDetail } from '../../core/planner/plannerSpan'
import type { PlannerCapture, PlannerModel, PlannerRequest, PlannerResult } from '../../core/ports/plannerModel'
import { reportFault } from '../../core/trace/fault'

// The Errand loop (#467, ADR 0095): one spoken outcome carried across as
// many steps as it takes, under the Planner. Each step the card is built
// again from a fresh snapshot by the builder the Decision Model's card
// comes from, the Planner is asked once with the memory, and what it names
// is done: an action through the same executor a Command's action takes —
// so the Feed, the Status Capsule and the spans see it as any action — a
// part of the page's text read into the memory, the person asked one
// question, or the Errand done in the Planner's own sentence. An action
// whose effect leaves the appliance is said back first and fires only on
// a yes (the confirm class). The Errand is bounded by seconds — 30 a call,
// 90 in all, both guesses (errandClock.ts) — counted from the work and
// paused while the person is asked; it ends, like a Task, at the next
// Utterance, Escape or the Abort Head. Aloud only the confirm, the
// question and the outcome (docs/agents/ui.md).

/** What one step's action came to, as the runner's executor fired it. */
export interface ActedStep {
  /** A later line, Escape or the Abort Head came over it. */
  readonly superseded: boolean
  /** What it did, in the facts "Done so far" tells Jev. */
  readonly outcome: string
  /** Its Answer, the sentence the Feed shows: what "done so far" is said in. */
  readonly said?: string
  /** What it put on the Shelf, for a capture. */
  readonly capture?: PlannerCapture
}

export interface ErrandDeps {
  readonly planner: PlannerModel
  /** The monotonic clock the seconds are counted on. */
  now(): number
  /** Wall-clock now, for the record. */
  wallNow(): number
  mintTurnId(): string
  /** Whether a later line, Escape or the Abort Head has ended it. */
  superseded(): boolean
  /** Aborted once it is superseded: the Planner call in flight goes with it. */
  readonly signal: AbortSignal
  /** The card the next step is planned over, from a fresh snapshot. */
  card(goalLine: string, step: number, visited: readonly string[]): Promise<ErrandCard>
  app?(): AppState | undefined
  /** The Errand's stage while the Planner is asked (stage Errand, on the Goal Line), on the step's turn. */
  planning(turnId: string, step: number): void
  /** Fires a Command through the runner's executor as one step, its words in the Feed the Planner's why. */
  act(turnId: string, why: string, command: Command, card: ErrandCard, step: number): Promise<ActedStep>
  /** A part of the page's text, read into the memory, never aloud; null when it cannot be read. */
  readPart(turnId: string, why: string, part: number, step: number): Promise<string | null>
  /** A step that fired nothing on its own turn (unanswered, cut short): its stage ends with it. */
  settle(turnId: string): void
  /** A step the Planner answered with no action (done, or a question back, #468): its `command` event in the Planner's own words, and its stage ended. */
  told(turnId: string, words: string, action: string, step: number): void
  /** A step that fired nothing (refused, or said no to): greyed in the Feed with what it came to. */
  drop(turnId: string, why: string, what: string, step: number): void
  /** The confirm or the question said by the Site Question's road; resolves the next line, or null when none came in the Hot Listen window or it was superseded. */
  ask(text: string, kind: 'confirm' | 'question'): Promise<string | null>
  /** The Errand's end said aloud and shown as its Answer. */
  say(text: string, failure: boolean): void
  /** One `planner-step` span per call, on its step's turn. */
  stepSpan(turnId: string, span: { durMs: number; detail: PlannerStepDetail }): void
  /** The `errand` span for the whole, on the Errand's id. */
  span(durMs: number, detail: Record<string, unknown>): void
  log(record: ErrandRecord): void
}

export interface ErrandStart {
  /** The Errand's id: the line's turn, which its steps' Task carries. */
  readonly id: string
  readonly goalLine: string
  readonly source: 'spoken' | 'typed'
  /** A Task that ended not done, handing its line over (#467): its "Done so far" lines and how it ended. */
  readonly handOff?: TaskHandOff
}

/** How much of a page's text one read puts in the memory. A guess (#467): no span yet says what a Planner reads well. */
const READ_PART_CHARS = 6_000

export async function runErrand(deps: ErrandDeps, start: ErrandStart): Promise<ErrandOutcome> {
  const { planner } = deps
  const clock: ErrandClock = errandClock(deps.now)
  const startedAt = deps.now()
  let memory: ErrandMemory = errandMemory(start.goalLine, start.handOff)
  const visited: string[] = []
  /** What the Errand typed, and into which fields, on the page each was typed on: what an Enter or a send button carries away. */
  let typed: (Typed & { readonly url: string })[] = []
  /** The last action said back was refused and nothing has fired since: an Errand the Planner ends now ends `declined`. */
  let refused = false
  /** The step whose stage is up and whose turn no action has ended yet: it is ended before the person is asked, and at the end. */
  let openTurn: string | null = null
  const close = (): void => {
    if (openTurn !== null) deps.settle(openTurn)
    openTurn = null
  }
  let said: string | undefined
  /** Whether the last reply was none of the answers: a second in a row ends the Errand. One retry is a guess (#467), unmeasured. */
  let slipped = false

  const end = (outcome: ErrandOutcome): ErrandOutcome => {
    close()
    const seconds = clock.elapsed() / 1000
    const steps = memory.steps.map(({ why, action, class: stepClass, outcome: came, seconds: took }) => ({ why, action, class: stepClass, outcome: came, seconds: took }))
    deps.span(Math.max(0, deps.now() - startedAt), { steps: steps.length, outcome, model: planner.model, thinking: planner.thinking, workMs: Math.round(clock.elapsed()) })
    deps.log({
      type: 'errand',
      turnId: start.id,
      at: deps.wallNow(),
      source: start.source,
      goalLine: start.goalLine,
      outcome,
      ...(said !== undefined ? { said } : {}),
      steps,
      seconds: Math.round(seconds * 10) / 10,
      model: planner.model,
      thinking: planner.thinking,
      ...(start.handOff !== undefined ? { handedFrom: start.handOff.ended } : {}),
    })
    return outcome
  }
  const ending = (outcome: ErrandOutcome, line: string, failure: boolean): ErrandOutcome => {
    said = line
    deps.say(line, failure)
    return end(outcome)
  }
  /** The seconds a step took, from where it began: the work alone. */
  const since = (from: number): number => Math.round((clock.elapsed() - from) / 100) / 10
  /** Waits on the person: the clock stops while the confirm or the question is open. */
  const askPerson = async (text: string, kind: 'confirm' | 'question'): Promise<string | null> => {
    clock.pause()
    try {
      return await deps.ask(text, kind)
    } finally {
      clock.resume()
    }
  }

  try {
    for (let step = 1; ; step += 1) {
      if (deps.superseded()) return end('superseded')
      if (clock.spent()) return ending('cap', capLine(memory), true)
      const turnId = deps.mintTurnId()
      const began = clock.elapsed()
      deps.planning(turnId, step)
      openTurn = turnId
      let card = await deps.card(start.goalLine, step, visited)
      if (deps.superseded()) return end('superseded')
      if (visited.at(-1) !== card.page.url && card.page.url !== '') visited.push(card.page.url)
      // The call's own cap, or what is left of the Errand's: whichever comes first is the call's end.
      const budget = AbortSignal.timeout(Math.max(1, clock.callBudget()))
      /** The step asked over a card (#501): never sent over the Card Budget, its cuts on the step's span. */
      const ask = async (over: ErrandCard, retryOf?: PlannerStepDetail['retryOf']): Promise<{ result: PlannerResult; request: Omit<PlannerRequest, 'signal'> } | null> => {
        const fit = { ...(over.cuts.length > 0 ? { cuts: over.cuts, ...(over.budget !== undefined ? { budget: over.budget } : {}) } : {}), ...(retryOf !== undefined ? { retryOf } : {}) }
        if (over.over === true) {
          reportFault('run.errand.unsent', `the step's card is ${over.size} characters after every cut, over the Card Budget's ${over.budget ?? 0}: not sent`)
          deps.stepSpan(turnId, { durMs: 0, detail: { model: planner.model, thinking: planner.thinking, outcome: 'unavailable', waitedMs: 0, ...fit, unsent: true } })
          return null
        }
        memory = withCard(memory, over.text)
        const request = { goalLine: start.goalLine, memory: plannerMemoryOf(memory), page: { url: over.page.url, title: over.page.title }, verbs: errandVerbs(over) }
        const result = await planner.plan({ ...request, signal: AbortSignal.any([deps.signal, budget]) })
        const span = result.status === 'answered' ? plannerStepSpan(result, result.answer.next) : plannerStepSpan(result, 'unavailable', budget.aborted && result.reason === 'cancelled' ? 'timeout' : result.reason)
        deps.stepSpan(turnId, { ...span, detail: { ...span.detail, ...fit } })
        return { result, request }
      }
      let asked = await ask(card)
      if (asked === null) return ending('unavailable', unavailableLine(memory), true)
      const refusal = asked.result.status === 'unavailable' ? sizeRefusalOf(asked.result.httpStatus, asked.result.message) : null
      if (refusal !== null && !deps.superseded()) {
        // A host that refused the step for its size is asked once more (#495, #501), on the card cut by what the whole ask must lose at its own count; never a third time.
        const { system, user } = plannerMessages(asked.request)
        const whole = cardChars(system) + cardChars(user)
        card = refitErrandCard(card, start.goalLine, Math.max(0, card.size - (whole - tighterBudget(whole, refusal))))
        asked = await ask(card, { id: turnId, ...refusal })
        if (asked === null) return ending('unavailable', unavailableLine(memory), true)
      }
      const { result } = asked
      if (deps.superseded()) return end('superseded')
      if (result.status === 'unavailable') {
        if (clock.spent()) return ending('cap', capLine(memory), true)
        // A reply that was none of the answers goes back to the Planner as a step, once: a weaker model's slip is not the Errand's end.
        if ((result.reason === 'malformed' || result.reason === 'unparsable') && !slipped) {
          slipped = true
          memory = withStep(memory, { why: 'your last reply', action: 'a reply that was none of the answers', class: 'stays', outcome: `refused: ${result.message}`, seconds: since(began) })
          close()
          continue
        }
        return ending('unavailable', unavailableLine(memory), true)
      }
      slipped = false
      const { answer } = result
      if (answer.next === 'done') {
        openTurn = null
        deps.told(turnId, answer.sentence, 'done', step)
        return ending(refused ? 'declined' : 'done', answer.sentence, false)
      }
      if (answer.next === 'ask') {
        openTurn = null
        deps.told(turnId, answer.question, 'asks back', step)
        const reply = await askPerson(answer.question, 'question')
        if (deps.superseded()) return end('superseded')
        if (reply === null) return ending('unsure', unansweredLine(answer.question), true)
        memory = withStep(memory, askedStep(answer.question, reply, since(began)))
        continue
      }
      const why = answer.why || JSON.stringify(answer.action)
      const resolved = resolveAction(answer.action, card, deps.app?.())
      // Each of these ends the step's turn itself.
      openTurn = null
      if (resolved.kind === 'refused') {
        deps.drop(turnId, why, `refused: ${resolved.reason}`, step)
        memory = withStep(memory, { why, action: JSON.stringify(answer.action), class: answer.class, outcome: `refused: ${resolved.reason}`, seconds: since(began) })
        continue
      }
      if (resolved.kind === 'read') {
        const text = await deps.readPart(turnId, why, resolved.part, step)
        if (deps.superseded()) return end('superseded')
        const outcome = text === null ? `part ${resolved.part} could not be read` : text.length > READ_PART_CHARS ? `${text.slice(0, READ_PART_CHARS)}…` : text
        memory = withStep(memory, { why, action: `read part ${resolved.part} of the page's text`, class: 'stays', outcome, seconds: since(began) })
        continue
      }
      const { command } = resolved
      const action = describeCommand(command, card.page)
      // What was typed on another page is no longer what an Enter or a send carries away.
      const confirm = confirmOf({ command, page: card.page, plannerClass: answer.class, typed: typed.filter((field) => field.url === card.page.url) })
      const stepClass = confirm === null ? 'stays' : 'leaves'
      if (confirm !== null) {
        // The confirm class (#467): said back by the Site Question's road, answered by the next line; only a yes fires it.
        const reply = await askPerson(confirmLine(confirm), 'confirm')
        if (deps.superseded()) return end('superseded')
        const yes = reply !== null && isYes(reply)
        memory = withStep(memory, confirmStep(confirm, reply, yes, since(began)))
        refused = !yes
        if (!yes) {
          deps.drop(turnId, why, `not done: ${reply === null ? 'no answer' : 'the answer was not yes'}`, step)
          continue
        }
      }
      const acted = await deps.act(turnId, why, command, card, step)
      if (acted.superseded || deps.superseded()) return end('superseded')
      const done: ErrandStep = { why, action, class: stepClass, outcome: acted.outcome, ...(acted.said !== undefined ? { said: acted.said } : {}), seconds: since(began) }
      memory = withStep(memory, done)
      if (acted.capture !== undefined) memory = withCapture(memory, acted.capture)
      refused = false
      if (command.verb === 'type' && command.slot !== null) {
        const into = targetLabel(command, card.page)
        // A field typed into again holds the newer text.
        typed = [...typed.filter((field) => field.into !== into || field.url !== card.page.url), { text: command.slot, into, url: card.page.url }]
      }
    }
  } catch (error) {
    // A step that threw ends the Errand aloud and on the record, never in silence: the card, the action or the reading broke.
    reportFault('run.errand.step', error)
    return ending('unavailable', faultLine(memory), true)
  }
}
