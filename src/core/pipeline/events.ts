export type PipelineStatus = 'thinking' | 'acting' | 'speaking'

export type PipelineEvent =
  | { type: 'command'; text: string; at: number }
  | { type: 'status'; status: PipelineStatus; at: number }
  | { type: 'tool_call'; callId: string; name: string; args: Record<string, unknown>; at: number }
  | {
      type: 'tool_result'
      callId: string
      name: string
      ok: boolean
      result?: unknown
      error?: string
      at: number
    }
  | {
      type: 'confirmation_requested'
      confirmationId: string
      callId: string
      toolName: string
      prompt: string
      at: number
    }
  | {
      type: 'confirmation_resolved'
      confirmationId: string
      approved: boolean
      reason: 'user' | 'timeout'
      at: number
    }
  | { type: 'speak'; text: string; at: number }
  | { type: 'display'; text: string; at: number }
  | { type: 'error'; message: string; at: number }
  | { type: 'done'; at: number }
