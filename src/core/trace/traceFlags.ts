// The diagnostics opt-ins (#184, ADR 0031): one flag per glossary term, so
// the env, the file names and the CONTEXT entries all say the same word.
// `BINGBONG_RUN_TRACE=1` turns on everything a Run records;
// `BINGBONG_HOST_TRACE=1` turns on everything the app records outside a
// Run. Both are Env File flags in the established BINGBONG_* shape (#32,
// #34), off unless set — a deployed Kiosk writes neither. Everything a
// family holds rides its one flag; there is no per-kind opt-in, because a
// diagnostic that has to be enabled a second time is the one nobody has on
// when the bug happens.
//
// The perf log is deliberately not here: it carries no user words and no
// page content, and the eval rung reads it, so it stays always-on.

import { envFlagEnabled } from '../perf/envFlag'

/** Env opt-in for the Run Trace (#184): `BINGBONG_RUN_TRACE=1`. */
export const RUN_TRACE_ENV = 'BINGBONG_RUN_TRACE'

/** Env opt-in for the Host Trace (#184): `BINGBONG_HOST_TRACE=1`. */
export const HOST_TRACE_ENV = 'BINGBONG_HOST_TRACE'

/** Whether a Run may write any of its records — grading, reasoning, faults. */
export function runTraceEnabled(env: Record<string, string | undefined>): boolean {
  return envFlagEnabled(env, RUN_TRACE_ENV)
}

/** Whether anything outside a Run may write a record. */
export function hostTraceEnabled(env: Record<string, string | undefined>): boolean {
  return envFlagEnabled(env, HOST_TRACE_ENV)
}
