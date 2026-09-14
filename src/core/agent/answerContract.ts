// The orchestrator's response contract: every final answer carries a short
// spoken line (≤ SPEAK_SENTENCE_LIMIT sentences) plus full display text, and
// errors get a spoken one-liner while the dashboard keeps the detail.

import { MAX_RUN_NOTE_CHARS, parseFinalizationCause, parseRunResolution, type FinalizationCause, type RunResolution } from '../session/runJournal'
import { parseAskedItemStandings, type AskedItemStanding } from './askedItems'
import { boundedString, MAX_MEMORY_REFERENCES, MAX_MEMORY_SUBJECT_CHARS, parseMemoryPatch, type MemoryEntryId, type MemoryPatch } from '../session/workingMemory'
import { parseMishearProposals, type MishearProposal } from '../voice/learnedTerms'
import { parseSubagentReportSections } from './subagentReport'
import { reportFault } from '../trace/fault'

export const SPEAK_SENTENCE_LIMIT = 2

/**
 * Parses the answer's supporting Session Evidence identities (#122):
 * an ordered, deduplicated list of Memory Entry ids, bounded like Memory
 * references. Anything else is null — malformed drops the whole list.
 */
function parseEvidenceIds(value: unknown): MemoryEntryId[] | null {
  if (!Array.isArray(value) || value.length > MAX_MEMORY_REFERENCES) return null
  const ids: MemoryEntryId[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return null
    if (seen.has(item)) continue
    seen.add(item)
    ids.push(item as MemoryEntryId)
  }
  return ids
}

/**
 * Parses the Candidate an Answer presents for inspection (#210, ADR
 * 0039): exactly one Memory Entry identity, or nothing. One is the whole
 * point — a list is precisely the "multiple Candidates without a clear
 * subject" ADR 0039 says to clarify with the user, so it is refused here
 * rather than resolved by picking from it. Whether that identity names a
 * live Candidate is the Session's question, not the parser's.
 */
function parseInspectionCandidateId(value: unknown): MemoryEntryId | null {
  return (boundedString(value, MAX_MEMORY_SUBJECT_CHARS) ?? null) as MemoryEntryId | null
}

/**
 * Keep at most `max` sentences. A sentence ends at a [.!?] run followed by
 * whitespace (or end of text) — so URLs and numbers like `youtube.com` or
 * `1.5gb` do not split mid-token.
 */
export function capSentences(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== '')
  return sentences.slice(0, max).join(' ')
}

/**
 * The answer turn's text, in the one place that decides it: the display
 * text when there is any, else the spoken line. Every reader of an answer
 * turn's words — a Subagent Report's text, a failed reserved round's trace
 * record (#198) — asks here, so none of them can disagree about what the
 * model said.
 */
export function answerText(turn: { speak: string; display: string }): string {
  return turn.display !== '' ? turn.display : turn.speak
}

/** A spoken one-liner for an error; the full message stays on the dashboard. */
export function spokenErrorLine(message: string): string {
  const first = capSentences(message, 1)
  return first === '' ? 'Something went wrong.' : `Something went wrong: ${first}`
}

function extractFenced(content: string): string | null {
  const match = content.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/)
  return match ? match[1] : null
}

function extractJsonSlice(content: string): string | null {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const slice = content.slice(start, end + 1)
  return slice === content ? null : slice
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/**
 * The string value starting at `openQuote` (its index in `content`), with
 * completed escapes unescaped — everything visible so far — plus whether
 * the closing quote arrived. Shared scanner for partially streamed JSON:
 * the answer contract's visible-part derivation and the feed's tool-intent
 * phrases both read values mid-stream with it.
 */
export function scanPartialJsonString(content: string, openQuote: number): { value: string; closed: boolean } {
  let out = ''
  for (let i = openQuote + 1; i < content.length; i += 1) {
    const char = content[i]!
    if (char === '"') return { value: out, closed: true }
    if (char !== '\\') {
      out += char
      continue
    }
    const escaped = content[i + 1]
    if (escaped === undefined) return { value: out, closed: false }
    if (escaped === 'u') {
      const hex = content.slice(i + 2, i + 6)
      if (hex.length < 4 || /[^0-9a-fA-F]/.test(hex)) return { value: out, closed: false }
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 5
      continue
    }
    out += ESCAPES[escaped] ?? `\\${escaped}`
    i += 1
  }
  return { value: out, closed: false }
}

/**
 * The visible fragment of a partially streamed answer (#47): the raw
 * content buffer is the answer-contract JSON in flight, so the first
 * `"display"`/`"speak"` value that opens streams (unescaping completed
 * escapes); prose — the fallback contract — streams raw. Monotonic: the
 * visible text only grows as the buffer grows, so successive calls diff
 * cleanly into flush fragments. The first key to open owns the stream; a
 * later key never shrinks it (the final display entry replaces the
 * partial at round end).
 */
export function partialAnswerText(content: string): string {
  if (!content.trimStart().startsWith('{')) return content
  const key = /"(?:display|speak)"\s*:\s*"/.exec(content)
  if (!key) return ''
  return scanPartialJsonString(content, key.index + key[0].length - 1).value
}

/**
 * Which contract a reply matched (#198, ADR 0034). `on_contract` is the
 * JSON branch below — the shape with `speak` and `display`; `malformed`
 * (#245) is a reply that carries both of the contract's keys but that no
 * candidate reads as that shape, JSON that fails to parse or parses wrong;
 * `off_contract` is everything else, prose above all. The marker is the
 * parser's so both loops read the same fact: an ordinary round renders
 * prose as an Answer and meets a Malformed Answer with one Answer Retry,
 * and the two reserved rounds treat both as a failed round.
 */
export type AnswerShape = 'on_contract' | 'off_contract' | 'malformed'

/**
 * Why a JSON value is not the Answer contract's shape (#245), worded for
 * the model: the field, and what it was. Null when it is the shape.
 */
function contractShapeFailure(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'the reply is not a JSON object'
  for (const key of ['speak', 'display'] as const) {
    if (!(key in parsed)) return `"${key}" is missing`
    if (typeof (parsed as Record<string, unknown>)[key] !== 'string') return `"${key}" is not a string`
  }
  return null
}

/** Whether a reply carries both of the Answer contract's keys (#245) — what it was meant as. */
function carriesContractKeys(content: string): boolean {
  return /"speak"\s*:/.test(content) && /"display"\s*:/.test(content)
}

/**
 * What could not be read of a turn marked `malformed` (#245): the parser's
 * own words, or the contract's for a client that marked the shape without
 * them — so neither loop ever sends a retry message with nothing in it.
 */
export function malformedErrorOf(turn: { malformedError?: string }): string {
  return turn.malformedError ?? '"speak" and "display" are not both strings'
}

/**
 * The Answer Retry's message (#245): what could not be read, verbatim, and
 * the contract asked for alone. It diagnoses nothing further and suggests
 * no corrected reply — the runtime never writes the user's Answer.
 */
export function answerRetryMessage(malformedError: string): string {
  return `Your last reply was meant as the Answer but could not be read as one: ${malformedError}. Reply with only the JSON object: no text before or after it, no code fences, "speak" and "display" as strings.`
}

/**
 * Parse the model's final message into {speak, display}. Accepted shapes, in
 * order: a bare JSON object, a JSON object in a code fence, a JSON object with
 * surrounding prose. Anything else falls back to the raw text — capped for
 * speaking, unchanged for display, never repaired — and is marked
 * `malformed` with what the last candidate failed on when it carries the
 * contract's keys (#245), `off_contract` otherwise (#198).
 */
export function parseAssistantAnswer(content: string): {
  speak: string
  display: string
  shape: AnswerShape
  /** What the last candidate failed on, verbatim; present exactly when `shape` is `malformed`. */
  malformedError?: string
  runNote?: string
  runNoteIssue?: 'malformed'
  memoryPatch?: MemoryPatch
  memoryPatchIssue?: 'malformed'
  mishearProposals?: MishearProposal[]
  mishearProposalsIssue?: 'malformed'
  findings?: ReturnType<typeof parseSubagentReportSections>['findings']
  unresolved?: ReturnType<typeof parseSubagentReportSections>['unresolved']
  resolution?: RunResolution
  resolutionIssue?: 'malformed'
  finalizationCause?: FinalizationCause
  finalizationCauseIssue?: 'malformed'
  evidenceIds?: MemoryEntryId[]
  evidenceIssue?: 'malformed'
  inspectionCandidateId?: MemoryEntryId
  inspectionIssue?: 'malformed'
  askedItems?: AskedItemStanding[]
  askedItemsIssue?: 'malformed'
} {
  const trimmed = content.trim()
  const candidates = [trimmed, extractFenced(trimmed), extractJsonSlice(trimmed)]
  // What the last candidate tried failed on (#245): the candidates narrow
  // toward the object the reply meant, so the last one's failure is the
  // one that names what could not be read.
  let lastFailure: string | null = null

  for (const candidate of candidates) {
    if (candidate === null) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      lastFailure = contractShapeFailure(parsed)
      if (lastFailure === null) {
        const {
          speak,
          display,
          run_note: rawRunNote,
          memory_patch: rawMemoryPatch,
          mishear_proposals: rawMishearProposals,
          resolution: rawResolution,
          finalization_cause: rawFinalizationCause,
          evidence_ids: rawEvidenceIds,
          inspection_candidate_id: rawInspectionCandidateId,
          asked_items: rawAskedItems,
        } = parsed as {
          speak: string
          display: string
          run_note?: unknown
          memory_patch?: unknown
          mishear_proposals?: unknown
          resolution?: unknown
          finalization_cause?: unknown
          evidence_ids?: unknown
          inspection_candidate_id?: unknown
          asked_items?: unknown
        }
        let answer: {
          speak: string
          display: string
          shape: AnswerShape
          memoryPatch?: MemoryPatch
          memoryPatchIssue?: 'malformed'
          mishearProposals?: MishearProposal[]
          mishearProposalsIssue?: 'malformed'
          findings?: ReturnType<typeof parseSubagentReportSections>['findings']
          unresolved?: ReturnType<typeof parseSubagentReportSections>['unresolved']
          resolution?: RunResolution
          resolutionIssue?: 'malformed'
          finalizationCause?: FinalizationCause
          finalizationCauseIssue?: 'malformed'
          evidenceIds?: MemoryEntryId[]
          evidenceIssue?: 'malformed'
          inspectionCandidateId?: MemoryEntryId
          inspectionIssue?: 'malformed'
          askedItems?: AskedItemStanding[]
          askedItemsIssue?: 'malformed'
        } = { speak: capSentences(speak, SPEAK_SENTENCE_LIMIT), display, shape: 'on_contract' }
        // The Asked Item standings (#250, ADR 0052): validated like the
        // other hidden metadata — malformed drops the list, the Answer
        // stands — and whether the list is the declared one is the
        // pipeline's question, since only it holds the declaration.
        if (rawAskedItems !== undefined) {
          const askedItems = parseAskedItemStandings(rawAskedItems)
          answer = askedItems ? { ...answer, askedItems } : { ...answer, askedItemsIssue: 'malformed' }
        }
        // Subagent Report sections (#98): validated independently, absent
        // when invalid — the orchestrator never emits these keys, and a
        // subagent's prose report survives a bad section untouched.
        const sections = parseSubagentReportSections(parsed)
        if (sections.findings !== undefined || sections.unresolved !== undefined) {
          answer = { ...answer, ...sections }
        }
        if (rawMemoryPatch !== undefined) {
          const memoryPatch = parseMemoryPatch(rawMemoryPatch)
          answer = memoryPatch ? { ...answer, memoryPatch } : { ...answer, memoryPatchIssue: 'malformed' }
        }
        // Mishear proposals (ADR 0022): same rejection shape as the memory
        // patch — malformed drops the whole list, the Answer stands.
        if (rawMishearProposals !== undefined) {
          const mishearProposals = parseMishearProposals(rawMishearProposals)
          answer = mishearProposals ? { ...answer, mishearProposals } : { ...answer, mishearProposalsIssue: 'malformed' }
        }
        // Run Resolution and proposed Finalization Cause (#110): enum
        // validated independently, and malformed metadata never discards
        // an otherwise useful Answer — the field drops, the Answer stands.
        if (rawResolution !== undefined) {
          const resolution = parseRunResolution(rawResolution)
          answer = resolution ? { ...answer, resolution } : { ...answer, resolutionIssue: 'malformed' }
        }
        if (rawFinalizationCause !== undefined) {
          const finalizationCause = parseFinalizationCause(rawFinalizationCause)
          answer = finalizationCause
            ? { ...answer, finalizationCause }
            : { ...answer, finalizationCauseIssue: 'malformed' }
        }
        // Supporting Session Evidence identities (#122): validated like
        // the other hidden metadata — malformed drops the list, the
        // Answer stands (and its Assessments lose their support claim).
        if (rawEvidenceIds !== undefined) {
          const evidenceIds = parseEvidenceIds(rawEvidenceIds)
          answer = evidenceIds ? { ...answer, evidenceIds } : { ...answer, evidenceIssue: 'malformed' }
        }
        // The Candidate this Answer presents for inspection (#210, ADR
        // 0039): validated like the other hidden metadata, and kept in
        // its own field for the same reason it is a different thing —
        // an inspection subject is what the user is looking at, never
        // support for a claim, so it can never arrive as evidence.
        if (rawInspectionCandidateId !== undefined) {
          const inspectionCandidateId = parseInspectionCandidateId(rawInspectionCandidateId)
          answer = inspectionCandidateId
            ? { ...answer, inspectionCandidateId }
            : { ...answer, inspectionIssue: 'malformed' }
        }
        if (rawRunNote === undefined) return answer
        if (typeof rawRunNote !== 'string') return { ...answer, runNoteIssue: 'malformed' }
        const runNote = rawRunNote.trim()
        return runNote !== '' && runNote.length <= MAX_RUN_NOTE_CHARS
          ? { ...answer, runNote }
          : { ...answer, runNoteIssue: 'malformed' }
      }
    } catch (error) {
      reportFault('agent.answerContract.parseAssistantAnswer', error)
      lastFailure = error instanceof Error ? error.message : String(error)
      // try the next candidate
    }
  }

  const fallback = { speak: capSentences(trimmed, SPEAK_SENTENCE_LIMIT), display: trimmed }
  return lastFailure !== null && carriesContractKeys(trimmed)
    ? { ...fallback, shape: 'malformed', malformedError: lastFailure }
    : { ...fallback, shape: 'off_contract' }
}
