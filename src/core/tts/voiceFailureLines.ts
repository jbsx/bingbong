// What the user is shown when a line could not be voiced. Neither names
// the error (#315, ADR 0038): what failed is in the fault the speech
// coordinator reports.

/** The line shown when a Run's voice fails. */
export const VOICE_FAILED_LINE = 'Something went wrong.'

/** The line shown when one spoken outside a Run — a Subagent Announcement, a download — fails. */
export const VOICE_UNAVAILABLE_LINE = 'Voice unavailable.'
