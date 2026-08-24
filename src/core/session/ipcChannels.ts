import type { SessionDecision } from './sessionRuntime'

export const SESSION_IPC = {
  extend: 'session:extend',
  decline: 'session:decline',
} as const

export type SessionDecisionRequest = SessionDecision
