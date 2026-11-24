/** Client WebSocket construction and open handshake shared by the CZUR Command and Video clients. */
import type { WebSocket, ClientOptions } from 'ws'
import { WebSocket as WsWebSocket } from 'ws'

/** WebSocket members that the CZUR clients use; test doubles implement this subset. */
export type CzurCommandWebSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'on' | 'off' | 'once' | 'removeAllListeners'>

/** Constructor that opens a {@link CzurCommandWebSocket} to `url` with `ws` client options. */
export type CzurWebSocketConstructor = new (url: string, options?: ClientOptions) => CzurCommandWebSocket

/** Connection settings common to both CZUR WebSocket clients. */
export interface CzurSocketOptions {
  readonly url: string
  readonly allowInsecureTls: boolean
  readonly WebSocketImpl?: CzurWebSocketConstructor
}

/**
 * Start connecting a client socket; the caller must pass it to {@link awaitSocketOpen}.
 * @param options - target URL, TLS policy, and optional constructor override.
 * @returns the connecting socket.
 */
function createSocket(options: CzurSocketOptions): CzurCommandWebSocket {
  const Impl = options.WebSocketImpl ?? WsWebSocket
  return new Impl(options.url, {
    ...options.allowInsecureTls ? { rejectUnauthorized: false } : {},
  })
}

/**
 * Wait for `socket` to open.
 * @param socket - socket returned by {@link createSocket}.
 * @param signal - caller cancellation; aborting closes `socket` and rejects with the abort reason.
 * @returns resolves once the socket is open; rejects on socket error or abort.
 */
function awaitSocketOpen(socket: CzurCommandWebSocket, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup()
      try {
        socket.close()
      } catch (error) {
        // `ws` throws when close() runs before the handshake finishes.
        void error
      }
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
    }
    const onOpen = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
      socket.off('open', onOpen)
      socket.off('error', onError)
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.once('open', onOpen)
    socket.once('error', onError)
  })
}

/** Base for the CZUR clients: owns the single socket, its options, and the closed flag. */
export abstract class CzurSocketClient<Options extends CzurSocketOptions> {
  /** Socket opened by {@link beginOpen}; `undefined` before connect and after close. */
  protected socket: CzurCommandWebSocket | undefined
  /** Set once by the subclass `close()`; never reset. */
  protected closed = false

  constructor(protected readonly options: Options) {}

  /**
   * Start opening the socket unless one already exists.
   * @param signal - caller cancellation; aborting closes the socket and rejects `opened` with the abort reason.
   * @returns the connecting socket and a promise that settles when it opens, or `undefined` when this client is already connected.
   */
  protected beginOpen(signal: AbortSignal): { socket: CzurCommandWebSocket; opened: Promise<void> } | undefined {
    signal.throwIfAborted()
    if (this.socket !== undefined) return undefined
    const socket = createSocket(this.options)
    this.socket = socket
    return { socket, opened: awaitSocketOpen(socket, signal) }
  }
}
