/** Scriptable in-memory WebSocket for driving the CZUR clients without a network server. */
import { WebSocket, type ClientOptions, type RawData } from 'ws'

/** Behavior switches a test sets before the client constructs its socket. */
export interface FakeSocketScript {
  /** Emit `open` in a microtask after construction; a predicate decides per socket URL. */
  autoOpen: boolean | ((url: string) => boolean)
  /** Runs inside the constructor, before `open` is scheduled. */
  onConstruct?: (socket: FakeSocket) => void
  /** Runs right after `open` is emitted, still in the same microtask. */
  afterOpen?: (socket: FakeSocket) => void
  /** Runs inside `send`; throw to simulate a failing socket. */
  onSend?: (data: string, socket: FakeSocket) => void
  /** Runs inside `close`; throw to simulate a socket that is already gone. */
  onClose?: () => void
  /** Emit the `close` event in a later macrotask, like a real network close; default is synchronous. */
  deferClose?: boolean
}

/** Minimal `ws` look-alike; construct it through `WebSocketImpl`. */
export class FakeSocket extends WebSocket {
  static last: FakeSocket | undefined
  /** Every socket constructed since the last reset, in construction order. */
  static instances: FakeSocket[] = []
  static script: FakeSocketScript = { autoOpen: true }

  /** Reset the shared script and the remembered socket. */
  static reset(): void {
    FakeSocket.last = undefined
    FakeSocket.instances = []
    FakeSocket.script = { autoOpen: true }
  }

  override readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN
  readonly sent: string[] = []
  override readonly url: string
  readonly options: ClientOptions | undefined

  constructor(url: string, options?: ClientOptions) {
    // @ts-expect-error -- ws accepts a null address for sockets that never dial; its type declarations only list string and URL.
    super(null, undefined, { autoPong: false })
    this.url = url
    this.options = options
    FakeSocket.last = this
    FakeSocket.instances.push(this)
    const script = FakeSocket.script
    script.onConstruct?.(this)
    if (typeof script.autoOpen === 'function' ? script.autoOpen(url) : script.autoOpen) {
      queueMicrotask(() => {
        this.emit('open')
        script.afterOpen?.(this)
      })
    }
  }

  override send(data: string): void {
    FakeSocket.script.onSend?.(data, this)
    this.sent.push(data)
  }

  override close(code = 1000, reason = ''): void {
    FakeSocket.script.onClose?.()
    this.readyState = WebSocket.CLOSED
    if (FakeSocket.script.deferClose === true) {
      setTimeout(() => { this.emit('close', code, Buffer.from(reason)) }, 0)
      return
    }
    this.emit('close', code, Buffer.from(reason))
  }

  /** Deliver one inbound message the way Node `ws` does. */
  push(data: RawData | string, isBinary = false): void {
    this.emit('message', data, isBinary)
  }

  /** Deliver one JSON text message. */
  pushJson(value: unknown): void {
    this.push(JSON.stringify(value))
  }
}

/** Parsed Command request frame. */
export interface SentRequest {
  readonly request_id: string
  readonly method: string
  readonly params: Record<string, unknown>
  readonly client: { readonly name: string; readonly version: string }
}

/**
 * Parse the nth frame a client sent.
 * @param socket - socket that received the frame.
 * @param index - zero-based frame index.
 */
export function sentRequest(socket: FakeSocket, index = 0): SentRequest {
  const frame = socket.sent[index]
  if (frame === undefined) throw new Error(`no frame ${String(index)} was sent`)
  return JSON.parse(frame) as SentRequest
}

/** Result a scripted Command handler returns for one request. */
export interface ScriptedReply {
  readonly code?: number
  readonly message?: string
  readonly data?: unknown
}

/**
 * Build an `onSend` script that answers a normal Command session in a microtask:
 * session token `sess`, one device `dev-1`, and empty success for everything else.
 * @param overrides - per-method replies replacing the defaults.
 */
export function answerCommands(
  overrides: Readonly<Record<string, (params: Record<string, unknown>) => ScriptedReply>> = {},
): (data: string, socket: FakeSocket) => void {
  const defaults: Record<string, (params: Record<string, unknown>) => ScriptedReply> = {
    'auth.create_session': () => ({ data: { session_token: 'sess' } }),
    'device.list': () => ({ data: { devices: [{ device_id: 'dev-1', display_name: 'Fake CZUR' }] } }),
    'video.start': () => ({ data: { stream_id: 'stream-1', session_token: 'video-sess' } }),
  }
  return (data, socket) => {
    const request = JSON.parse(data) as SentRequest
    const handler: (params: Record<string, unknown>) => ScriptedReply
      = overrides[request.method] ?? defaults[request.method] ?? (() => ({}))
    const reply = handler(request.params)
    queueMicrotask(() => {
      socket.pushJson({
        request_id: request.request_id,
        code: reply.code ?? 0,
        message: reply.message ?? 'ok',
        ...reply.data === undefined ? {} : { data: reply.data },
      })
    })
  }
}
