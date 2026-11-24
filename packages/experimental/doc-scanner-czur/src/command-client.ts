/** Host-side CZUR Command WebSocket JSON-RPC client. */
import { randomUUID } from 'node:crypto'
import { WebSocket, type RawData } from 'ws'
import {
  asCzurEvent,
  asCzurResponse,
  type CzurEvent,
  type CzurResponse,
} from './protocol.ts'
import { CzurSocketClient, type CzurSocketOptions } from './websocket.ts'

/** Options for one Command WS session. */
export interface CzurCommandClientOptions extends CzurSocketOptions {
  readonly onEvent?: (event: CzurEvent) => void
  readonly onClose?: (code: number, reason: string) => void
}

/** Structured failure from a non-zero Command response. */
export class CzurCommandError extends Error {
  /** Non-zero `code` from the Command response. */
  readonly code: number
  /** `data` field of the failed response; `undefined` when the response carried none. */
  readonly data: unknown

  constructor(message: string, code: number, data?: unknown) {
    super(message)
    this.name = 'CzurCommandError'
    this.code = code
    this.data = data
  }
}

interface Pending {
  readonly resolve: (response: CzurResponse) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * One Command WS connection: request/response correlation and event fan-out.
 */
export class CzurCommandClient extends CzurSocketClient<CzurCommandClientOptions> {
  private readonly pending = new Map<string, Pending>()

  /**
   * Open the Command WebSocket.
   * @param signal - caller cancellation while connecting.
   */
  async connect(signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<void> {
    const connecting = this.beginOpen(signal)
    if (connecting === undefined) return
    await connecting.opened
    const { socket } = connecting
    socket.on('message', (data: RawData) => { this.handleMessage(data) })
    socket.on('close', (code: number, reason: Buffer) => {
      this.failAll(new Error(`Command WS closed (${String(code)}): ${reason.toString() || 'no reason'}`))
      this.options.onClose?.(code, reason.toString())
    })
  }

  /**
   * Send one RPC and wait for the matching response.
   * @param method - CZUR method name.
   * @param params - method params.
   * @param timeoutMs - per-call timeout; `0` or less disables it.
   * @returns the `data` field of the response with code `0`.
   * @throws CzurCommandError when the response code is non-zero.
   */
  async request(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed || this.socket === undefined || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Command WS is not connected')
    }
    const request_id = randomUUID()
    const payload = JSON.stringify({
      request_id,
      method,
      params,
      client: { name: 'dsh-doc-scanner-czur', version: '0.2.2' },
    })
    const response = await new Promise<CzurResponse>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(request_id)
          reject(new Error(`Command WS request timed out: ${method}`))
        }, timeoutMs)
        : undefined
      this.pending.set(request_id, { resolve, reject, timer })
      try {
        this.socket?.send(payload)
      } catch (error) {
        if (timer !== undefined) clearTimeout(timer)
        this.pending.delete(request_id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    if (response.code !== 0) {
      throw new CzurCommandError(response.message || `CZUR ${method} failed`, response.code, response.data)
    }
    return response.data
  }

  /** Close the socket and reject in-flight requests. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.failAll(new Error('Command WS closed'))
    try {
      this.socket?.close()
    } catch (error) {
      // Best-effort teardown; the socket may already be gone.
      void error
    }
    this.socket = undefined
  }

  private handleMessage(data: RawData): void {
    const text = rawText(data)
    if (text === undefined) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      // Ignore non-JSON frames on the Command channel.
      void error
      return
    }
    const response = asCzurResponse(parsed)
    if (response !== undefined) {
      const waiter = this.pending.get(response.request_id)
      if (waiter !== undefined) {
        this.pending.delete(response.request_id)
        if (waiter.timer !== undefined) clearTimeout(waiter.timer)
        waiter.resolve(response)
      }
      return
    }
    const event = asCzurEvent(parsed)
    if (event !== undefined) this.options.onEvent?.(event)
  }

  private failAll(error: Error): void {
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id)
      if (waiter.timer !== undefined) clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
}

function rawText(data: RawData): string | undefined {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return undefined
}
