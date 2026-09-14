// The malformed-call correction (#241): a record_evidence or record_candidate
// call its parser refuses is told every shape defect it carries, in field
// order, and shown its own arguments with the fixes applied — the call it
// should send. Nothing is repaired silently: the check stays in each
// checkpoint's evaluate step, so a malformed call remains a rejected
// Evidence Checkpoint, and the correction only teaches the shape.

/** One shape defect: the field, and what is wrong with it. */
export interface ShapeDefect {
  readonly field: string
  readonly problem: string
}

/** A malformed call read back as the call it should have been. */
export interface ShapeDiagnosis {
  /** Every defect, in the tool's field order; keys the tool does not declare come last. */
  readonly defects: readonly ShapeDefect[]
  /** The model's own arguments with every fix applied — a placeholder only where nothing derives. */
  readonly corrected: Readonly<Record<string, unknown>>
  /** False when a field grounding needs could not be derived, so the repaired call is not graded. */
  readonly groundable: boolean
}

/** A value nothing in the call can supply, naming what belongs there and nothing more. */
export function placeholder(what: string): string {
  return `<${what}>`
}

/** Why a string field refused its value: missing, the wrong type, empty, or past its bound. */
export function stringProblem(value: unknown, max?: number): string {
  if (value === undefined) return 'missing'
  if (typeof value !== 'string') {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    return `must be a string, not ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`
  }
  if (value.trim() === '') return 'empty'
  return max === undefined ? 'not a usable value' : `longer than its ${max}-character bound`
}

/** The defects in the tool's declared field order; undeclared keys keep their call order after them. */
export function inFieldOrder(defects: readonly ShapeDefect[], fields: readonly string[]): ShapeDefect[] {
  const rank = (field: string): number => {
    const index = fields.indexOf(field)
    return index === -1 ? fields.length : index
  }
  return [...defects].sort((a, b) => rank(a.field) - rank(b.field))
}

/**
 * The arguments with one key set: in place when the call already has it,
 * otherwise just before `beside` when that key is present, otherwise last —
 * so the corrected call still reads as the model's own.
 */
export function withField(
  args: Readonly<Record<string, unknown>>,
  key: string,
  value: unknown,
  beside?: string,
): Record<string, unknown> {
  if (key in args || beside === undefined || !(beside in args)) return { ...args, [key]: value }
  const placed: Record<string, unknown> = {}
  for (const [name, held] of Object.entries(args)) {
    if (name === beside) placed[key] = value
    placed[name] = held
  }
  return placed
}

/** The arguments without one key. */
export function withoutField(args: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([name]) => name !== key))
}

/**
 * The correction a malformed rejection carries: every defect, the corrected
 * call as a JSON block with values in full — a clipped excerpt is a
 * near-miss the tool itself rejects — and, when the repaired call was graded
 * and refused, that refusal in the exact sentence its own class produces.
 */
export function malformedCorrection(noun: 'citation' | 'call', diagnosis: ShapeDiagnosis, verdict?: string): string {
  const count = diagnosis.defects.length
  return [
    `the ${noun} is malformed — ${count === 1 ? 'one field' : `${count} fields`} to fix:`,
    ...diagnosis.defects.map(({ field, problem }) => `- ${field}: ${problem}`),
    'Send this call instead:',
    '```json',
    JSON.stringify(diagnosis.corrected, null, 2),
    '```',
    ...(verdict !== undefined ? [`Graded as corrected, it would still be refused: ${verdict}`] : []),
  ].join('\n')
}
