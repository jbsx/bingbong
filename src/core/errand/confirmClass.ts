import type { PlannerActionClass } from '../ports/plannerModel'
import { targetLabel, type Command, type CommandPage } from '../command/command'
import { exactSiteAnswer } from '../command/siteQuestion'

// The confirm class (#467, ADR 0095, the one amendment to ADR 0076's
// exception list): an Errand's action whose effect leaves the appliance —
// posts, sends, pays, deletes, submits — is said back and fires only on
// the person's yes. The Planner names each action's class; code enforces,
// and hard policy sits on top of it, by kind and never by site: a click or
// an Enter on a control whose label carries one of the leaving words is
// `leaves`, whatever the Planner said. The Site Question's road carries
// it (#423): said, answered by the next line, refused when unsure.

/** The words a control's label carries when its click or its Enter leaves the appliance (orchestrator ruling 5, #467). */
export const LEAVING_WORDS = ['post', 'send', 'pay', 'buy', 'order', 'delete', 'submit', 'publish', 'reply', 'comment', 'subscribe'] as const

// "Unsubscribe" carries subscribe: it changes the account the world sees as surely.
const LEAVING = new RegExp(`\\b((?:un)?subscribe|${LEAVING_WORDS.filter((word) => word !== 'subscribe').join('|')})\\b`, 'i')

/**
 * The leaving word a control's label carries, as the bare word: "Comment"
 * sends one, "Comments" opens the list of them, "Subscribed" is a state.
 */
export function leavingWordOf(label: string | undefined): string | null {
  const match = label === undefined ? null : LEAVING.exec(label)
  return match === null ? null : match[1]!.toLowerCase()
}

/** What a confirm says will happen: its verb, and the text it sends or the control it fires. */
export interface Confirm {
  readonly verb: string
  readonly what: string
}

/** A text the Errand typed, and into the field of which label: what an Enter or a send button carries away. */
export interface Typed {
  readonly text: string
  readonly into: string | undefined
}

const quoted = (label: string | undefined): string => `“${label ?? 'it'}”`

/** The verb a Planner-named `leaves` action is said back by, when its control carries no leaving word. */
function ownVerb(command: Command): string {
  switch (command.verb) {
    case 'press':
      return `press ${command.key?.key ?? 'Enter'} on`
    case 'type':
      return 'send'
    case 'navigate':
      return 'open'
    default:
      return command.verb
  }
}

/**
 * The confirm an action needs before it fires, or null when it stays. A
 * click leaves by its control's label; a type that submits, by its field's;
 * an Enter, by every field typed into on the page so far (#468), since the
 * focus may sit in any of them; and either when the Planner said so. What
 * is said is the text that goes — the words typed into the leaving field,
 * else the last typed before a send — else the control.
 */
export function confirmOf(input: { readonly command: Command; readonly page: CommandPage; readonly plannerClass: PlannerActionClass; readonly typed: readonly Typed[] }): Confirm | null {
  const { command, page, plannerClass, typed } = input
  const label = targetLabel(command, page)
  const enter = command.verb === 'press' && (command.key?.key ?? 'Enter') === 'Enter'
  const last = typed.at(-1) ?? null
  // The field an Enter carries away: the first typed into whose label leaves, else the last typed.
  const leavingField = enter ? (typed.find((field) => leavingWordOf(field.into) !== null) ?? null) : null
  const word =
    command.verb === 'click'
      ? leavingWordOf(label)
      : command.verb === 'type' && command.submit === true
        ? leavingWordOf(label)
        : enter
          ? leavingWordOf(leavingField?.into)
          : null
  if (word === null && plannerClass !== 'leaves') return null
  const verb = word ?? ownVerb(command)
  if (command.verb === 'type') return { verb, what: command.slot ?? quoted(label) }
  if (enter) return { verb, what: (leavingField ?? last)?.text ?? 'the field' }
  return { verb, what: last !== null && word !== null ? last.text : quoted(label) }
}

/** The confirm said aloud (#467): "This will post: <text>. Yes or no?" */
export function confirmLine(confirm: Confirm): string {
  const what = confirm.what.trim()
  return `This will ${confirm.verb}: ${/[.?!…]$/.test(what) ? what : `${what}.`} Yes or no?`
}

/** Whether a line says yes to a confirm: only the exact yes lines; anything else, and silence, refuses. */
export function isYes(line: string): boolean {
  return exactSiteAnswer(line) === 'accept'
}
