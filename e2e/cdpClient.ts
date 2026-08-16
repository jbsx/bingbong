export interface CdpSocket {
  send(data: string): void
  close(): void
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
}

type EventHandler = (params: unknown) => void

interface PendingRequest {
  resolve: (result: never) => void
  reject: (error: Error) => void
}

export class CdpClient {
  private nextId = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly handlers = new Map<string, Set<EventHandler>>()

  constructor(private readonly socket: CdpSocket) {
    socket.onmessage = (event) => this.handleMessage(String(event.data))
    socket.onclose = () => this.handleClose()
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    const id = ++this.nextId
    const frame: Record<string, unknown> = { id, method, params }
    if (sessionId !== undefined) frame.sessionId = sessionId
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as PendingRequest['resolve'], reject })
    })
    this.socket.send(JSON.stringify(frame))
    return promise
  }

  on(method: string, handler: EventHandler): () => void {
    let set = this.handlers.get(method)
    if (!set) {
      set = new Set()
      this.handlers.set(method, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  close(): void {
    this.socket.close()
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as {
      id?: number
      result?: unknown
      error?: { message?: string }
      method?: string
      params?: unknown
    }
    if (message.id !== undefined) {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message ?? 'CDP error'))
      else request.resolve(message.result as never)
      return
    }
    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params)
    }
  }

  private handleClose(): void {
    const error = new Error('CDP socket closed')
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}

export async function connectCdp(webSocketUrl: string): Promise<CdpClient> {
  const socket = new WebSocket(webSocketUrl)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out connecting to ${webSocketUrl}`)), 10000)
    socket.onopen = () => {
      clearTimeout(timer)
      resolve()
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error(`failed to connect to ${webSocketUrl}`))
    }
  })
  return new CdpClient(socket as unknown as CdpSocket)
}
