/** Host-side CZUR Video WebSocket: frame_meta text paired with the next binary JPEG. */
import type { RawData } from 'ws'
import { sleepUnlessAborted, type DocScannerPreviewFrame } from '@deepseek-ai/dsh-doc-scanner'
import { CzurSocketClient, type CzurSocketOptions } from './websocket.ts'

/** Options for one Video WS stream. */
export interface CzurVideoClientOptions extends CzurSocketOptions {}

interface FrameMeta {
  readonly width: number
  readonly height: number
  readonly timestamp_ms?: number
  readonly pixel_format?: string
}

/**
 * Connect to Video WS and yield JPEG preview frames until closed or aborted.
 */
export class CzurVideoClient extends CzurSocketClient<CzurVideoClientOptions> {
  private pendingMeta: FrameMeta | undefined
  private readonly waiters: Array<(frame: DocScannerPreviewFrame | undefined) => void> = []
  private readyResolved = false
  private readyWaiters: Array<() => void> = []

  /**
   * Open Video WS and wait for `video.ready` when the Runtime sends it.
   * @param signal - caller cancellation.
   */
  async connect(signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<void> {
    const connecting = this.beginOpen(signal)
    if (connecting === undefined) return
    await connecting.opened
    const { socket } = connecting
    socket.on('message', (data: RawData, isBinary: boolean) => { this.handleMessage(data, isBinary) })
    socket.on('close', () => { this.shutdown() })
    // Some Runtimes omit video.ready; proceed after a short grace if still waiting.
    await Promise.race([
      this.waitReady(signal),
      sleepUnlessAborted(500, signal).catch(() => undefined),
    ])
  }

  /**
   * Async iterator of viewfinder frames.
   * @param signal - ends the iterator when aborted.
   * @returns a stream of frames that ends when the socket closes.
   */
  async *frames(signal: AbortSignal): AsyncIterable<DocScannerPreviewFrame> {
    signal.throwIfAborted()
    while (!signal.aborted && !this.closed) {
      const frame = await this.nextFrame(signal)
      if (frame === undefined) return
      yield frame
    }
  }

  /** Close the Video socket and unblock waiters. */
  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.socket?.close()
    } catch (error) {
      void error
    }
    this.socket = undefined
    this.shutdown()
  }

  private waitReady(signal: AbortSignal): Promise<void> {
    if (this.readyResolved) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.readyWaiters.push(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      })
    })
  }

  private nextFrame(signal: AbortSignal): Promise<DocScannerPreviewFrame | undefined> {
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        // The abort listener and the waiter entry are added and removed together.
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
      }
      const waiter = (frame: DocScannerPreviewFrame | undefined): void => {
        signal.removeEventListener('abort', onAbort)
        resolve(frame)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (this.closed) return
    // Node `ws` delivers text frames as Buffer with isBinary=false. Never use
    // Buffer.isBuffer alone — that mistook stream.frame_meta JSON for JPEG.
    if (!isBinary) {
      const text = typeof data === 'string' ? data : utf8Text(data)
      if (text !== undefined) this.handleControlText(text)
      return
    }
    const bytes = toBytes(data)
    if (bytes === undefined || bytes.byteLength === 0) return
    // Some Runtimes mark JSON control frames as binary; JPEG always starts FF D8.
    if (!isJpegSoi(bytes)) {
      const text = Buffer.from(bytes).toString('utf8')
      if (text.trimStart().startsWith('{')) this.handleControlText(text)
      return
    }
    const meta = this.pendingMeta ?? { width: 0, height: 0 }
    this.pendingMeta = undefined
    const frame: DocScannerPreviewFrame = {
      data: bytes,
      mimeType: 'image/jpeg',
      width: meta.width > 0 ? meta.width : 1,
      height: meta.height > 0 ? meta.height : 1,
      ...meta.timestamp_ms !== undefined ? { ts: meta.timestamp_ms } : { ts: Date.now() },
    }
    const waiter = this.waiters.shift()
    if (waiter !== undefined) waiter(frame)
  }

  private handleControlText(text: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      // Non-JSON text on the Video channel is ignored.
      void error
      return
    }
    if (parsed === null || typeof parsed !== 'object') return
    const record = parsed as Record<string, unknown>
    const event = typeof record.event === 'string' ? record.event : undefined
    if (event === 'video.ready') {
      this.markReady()
      return
    }
    if (event === 'stream.frame_meta') {
      const payload = record.payload !== null && typeof record.payload === 'object'
        ? record.payload as Record<string, unknown>
        : record
      this.pendingMeta = {
        width: typeof payload.width === 'number' ? payload.width : 0,
        height: typeof payload.height === 'number' ? payload.height : 0,
        ...typeof payload.timestamp_ms === 'number' ? { timestamp_ms: payload.timestamp_ms } : {},
        ...typeof payload.pixel_format === 'string' ? { pixel_format: payload.pixel_format } : {},
      }
      this.markReady()
    }
  }

  private markReady(): void {
    if (this.readyResolved) return
    this.readyResolved = true
    const waiters = this.readyWaiters
    this.readyWaiters = []
    for (const waiter of waiters) waiter()
  }

  private shutdown(): void {
    this.closed = true
    this.markReady()
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.(undefined)
    }
  }
}

function toBytes(data: RawData): Uint8Array | undefined {
  if (Buffer.isBuffer(data)) return new Uint8Array(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (typeof data === 'string') return undefined
  return undefined
}

function utf8Text(data: RawData): string | undefined {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return undefined
}

/** JPEG Start Of Image marker. */
function isJpegSoi(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
}
