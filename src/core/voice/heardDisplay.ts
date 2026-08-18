import type { VoiceHeardEvent } from './ipcChannels'

/** Transcript annotation per heard-but-not-command routing. */
const HEARD_SUFFIX: Record<Exclude<VoiceHeardEvent['routed'], 'command'>, string> = {
  confirmation: ' (answered)',
  ask: ' (your answer)',
  abort: ' (stopping)',
  pause: ' (paused)',
  resume: ' (resumed)',
  steering: ' (steering)',
  ignored: ' — not a yes or no',
}

/** How a heard-but-not-command transcript reads in the dashboard transcript. */
export function describeHeard(heard: VoiceHeardEvent): string {
  if (heard.routed === 'command') return heard.text
  return `heard "${heard.text}"${HEARD_SUFFIX[heard.routed]}`
}
