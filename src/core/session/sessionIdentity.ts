declare const submissionIdBrand: unique symbol
declare const runIdBrand: unique symbol
declare const sessionIdBrand: unique symbol

/** Identity assigned before admission is attempted. */
export type SubmissionId = string & { readonly [submissionIdBrand]: 'SubmissionId' }

/** Identity assigned to one accepted command execution. */
export type RunId = string & { readonly [runIdBrand]: 'RunId' }

/** Identity shared by accepted Runs in one Session lifecycle. */
export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' }

/** Monotonic guard that invalidates work crossing an explicit reset. */
export type SessionGeneration = number

/** Domain identity minting stays independent from observability turn correlation. */
export interface SessionIdentitySource {
  mintSubmissionId(): SubmissionId
  mintRunId(): RunId
  mintSessionId(): SessionId
}
