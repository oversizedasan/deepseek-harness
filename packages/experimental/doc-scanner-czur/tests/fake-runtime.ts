/** Loopback Command + Video WebSocket servers that speak enough CZUR Open for unit tests. */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'

/** 1×1 JPEG used by the fake Runtime. */
export const FAKE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
  'base64',
)

/** One Command request as seen by {@link FakeRuntimeOptions.intercept}. */
export interface RuntimeCall {
  readonly method: string
  readonly params: Record<string, unknown>
  /** Number of requests with this method received so far, including this one. */
  readonly count: number
  /** Answer the request. */
  readonly reply: (code: number, message: string, data?: unknown) => void
  /** Push an event to the requesting socket. */
  readonly emit: (event: string, payload?: unknown) => void
  /** Send one raw text frame to the requesting socket. */
  readonly sendText: (text: string) => void
  /** Close the requesting socket. */
  readonly closeSocket: (code?: number, reason?: string) => void
}

export interface FakeRuntimeOptions {
  readonly devices?: readonly { readonly device_id: string; readonly display_name?: string }[]
  /** When true, the first `capture.take` returns RateLimited 1004. */
  readonly rateLimitFirstCapture?: boolean
  /**
   * When true, capture results omit inline base64 and require Asset HTTP download
   * with `Authorization: Bearer sess`.
   */
  readonly assetViaHttp?: boolean
  /** Milliseconds between automatic preview frames; 0 sends frames only through `sendVideoFrame`. Defaults to 40. */
  readonly videoFrameIntervalMs?: number
  /** Take over a request; return true when it was handled, false to use the default reply. */
  readonly intercept?: (call: RuntimeCall) => boolean
}

interface PendingRequest {
  readonly request_id: string
  readonly method: string
  readonly params: Record<string, unknown>
}

/**
 * Start Command (HTTP upgrade) and Video WS servers on ephemeral ports.
 */
export async function startFakeRuntime(options: FakeRuntimeOptions = {}): Promise<{
  commandUrl: string
  videoBaseUrl: string
  /** Base URL of the Asset HTTP server; undefined unless `assetViaHttp` is set. */
  assetBaseUrl: string | undefined
  close: () => Promise<void>
  requests: PendingRequest[]
  /** Authorization headers seen by the optional Asset HTTP server. */
  assetAuthHeaders: string[]
  /** Push a hardware still that has no matching capture.take waiter. */
  emitHardgrab: () => void
  /** Push one event to every connected Command socket. */
  emitEvent: (event: string, payload?: unknown) => void
  /** Send one frame_meta plus JPEG pair to every connected Video socket. */
  sendVideoFrame: () => void
  /** Close every connected Command socket from the server side. */
  closeCommandSockets: (code?: number, reason?: string) => void
}> {
  const devices = options.devices ?? [{ device_id: 'dev-1', display_name: 'Fake CZUR' }]
  const assetViaHttp = options.assetViaHttp === true
  let rateLimited = options.rateLimitFirstCapture === true
  let captureSeq = 0
  let hardgrabSeq = 0
  const requests: PendingRequest[] = []
  const assetAuthHeaders: string[] = []
  const commandSockets = new Set<WebSocket>()
  const videoSockets = new Set<WebSocket>()
  const methodCounts = new Map<string, number>()
  const frameIntervalMs = options.videoFrameIntervalMs ?? 40
  const commandHttp: HttpServer = createServer()
  const commandWss = new WebSocketServer({ server: commandHttp })
  const videoHttp: HttpServer = createServer()
  const videoWss = new WebSocketServer({ server: videoHttp })
  const assetHttp: HttpServer | undefined = assetViaHttp
    ? createServer((req: IncomingMessage, res: ServerResponse) => {
      const auth = req.headers.authorization
      if (typeof auth === 'string') assetAuthHeaders.push(auth)
      if (auth !== 'Bearer sess') {
        res.writeHead(401)
        res.end('unauthorized')
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.end(FAKE_JPEG)
    })
    : undefined

  commandWss.on('connection', (socket) => {
    commandSockets.add(socket)
    socket.on('close', () => { commandSockets.delete(socket) })
    socket.on('message', (data: RawData) => {
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : ''
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(text) as Record<string, unknown>
      } catch {
        return
      }
      const request_id = typeof parsed.request_id === 'string' ? parsed.request_id : undefined
      const method = typeof parsed.method === 'string' ? parsed.method : undefined
      if (request_id === undefined || method === undefined) return
      const params = parsed.params !== null && typeof parsed.params === 'object'
        ? parsed.params as Record<string, unknown>
        : {}
      requests.push({ request_id, method, params })
      const reply = (code: number, message: string, data?: unknown): void => {
        socket.send(JSON.stringify({ request_id, code, message, data, ts: Date.now() }))
      }
      const emit = (event: string, payload: unknown): void => {
        socket.send(JSON.stringify({ code: 0, event, message: 'ok', payload, ts: Date.now() }))
      }
      const count = (methodCounts.get(method) ?? 0) + 1
      methodCounts.set(method, count)
      const handled = options.intercept?.({
        method,
        params,
        count,
        reply,
        emit,
        sendText: (frame) => { socket.send(frame) },
        closeSocket: (code, reason) => { socket.close(code, reason) },
      })
      if (handled === true) return
      switch (method) {
        case 'auth.create_session':
          reply(0, 'ok', { session_token: 'sess', expires_in: 3600 })
          break
        case 'device.list':
          reply(0, 'ok', { devices })
          break
        case 'device.open':
          reply(0, 'ok', { opened: true, device_id: params.device_id })
          break
        case 'device.close':
          reply(0, 'ok', { closed: true })
          break
        case 'device.set_turn_detect':
          reply(0, 'ok', { enabled: params.enabled !== false, device_id: params.device_id })
          break
        case 'video.start':
          reply(0, 'ok', {
            device_id: params.device_id,
            stream_id: 'stream-1',
            session_token: 'video-sess',
            width: 1,
            height: 1,
            fps: 5,
            pixel_format: 'mjpeg',
          })
          break
        case 'video.stop':
          reply(0, 'ok', { stopped: true })
          break
        case 'capture.take': {
          if (rateLimited) {
            rateLimited = false
            reply(1004, 'RateLimited', { retry_after_ms: 20 })
            break
          }
          captureSeq += 1
          const task_id = `task-${String(captureSeq)}`
          reply(0, 'ok', { accepted: true, task_id, status: 'queued' })
          setTimeout(() => {
            const assetAddr = assetHttp?.address()
            const assetPort = assetAddr !== null && assetAddr !== undefined && typeof assetAddr !== 'string'
              ? assetAddr.port
              : undefined
            emit('capture.completed', {
              task_id,
              status: 'succeeded',
              device_id: params.device_id,
              ...assetViaHttp
                ? {
                  assets: [{
                    asset_id: 'asset-final',
                    kind: 'final',
                    content_type: 'image/jpeg',
                    width: 1,
                    height: 1,
                    size: FAKE_JPEG.byteLength,
                    download_url: `http://127.0.0.1:${String(assetPort)}/api/assets/${task_id}/asset-final/download`,
                  }],
                }
                : {
                  image_base64: FAKE_JPEG.toString('base64'),
                  assets: [{
                    asset_id: 'asset-final',
                    kind: 'final',
                    content_type: 'image/jpeg',
                    width: 1,
                    height: 1,
                    size: FAKE_JPEG.byteLength,
                    data_base64: FAKE_JPEG.toString('base64'),
                  }],
                },
            })
          }, 15)
          break
        }
        case 'capture.get': {
          const task_id = typeof params.task_id === 'string' ? params.task_id : 'unknown'
          const assetAddr = assetHttp?.address()
          const assetPort = assetAddr !== null && assetAddr !== undefined && typeof assetAddr !== 'string'
            ? assetAddr.port
            : undefined
          reply(0, 'ok', {
            task_id,
            status: 'succeeded',
            ...assetViaHttp
              ? {
                assets: [{
                  asset_id: 'asset-final',
                  kind: 'final',
                  content_type: 'image/jpeg',
                  width: 1,
                  height: 1,
                  download_url: `http://127.0.0.1:${String(assetPort)}/api/assets/${task_id}/asset-final/download`,
                }],
              }
              : {
                image_base64: FAKE_JPEG.toString('base64'),
                assets: [{
                  asset_id: 'asset-final',
                  kind: 'final',
                  content_type: 'image/jpeg',
                  width: 1,
                  height: 1,
                }],
              },
          })
          break
        }
        default:
          reply(1, `unknown method ${method}`)
      }
    })
  })

  const sendFramePair = (socket: WebSocket): void => {
    if (socket.readyState !== socket.OPEN) return
    socket.send(JSON.stringify({
      event: 'stream.frame_meta',
      payload: {
        device_id: 'dev-1',
        stream_id: 'stream-1',
        frame_seq: Date.now(),
        timestamp_ms: Date.now(),
        width: 1,
        height: 1,
        pixel_format: 'mjpeg',
      },
    }))
    socket.send(FAKE_JPEG)
  }

  videoWss.on('connection', (socket: WebSocket) => {
    videoSockets.add(socket)
    socket.send(JSON.stringify({ event: 'video.ready', code: 0, message: 'ok' }))
    const timer = frameIntervalMs > 0
      ? setInterval(() => { sendFramePair(socket) }, frameIntervalMs)
      : undefined
    socket.on('close', () => {
      videoSockets.delete(socket)
      clearInterval(timer)
    })
  })

  const broadcast = (event: string, payload: unknown): void => {
    for (const socket of commandSockets) {
      if (socket.readyState !== socket.OPEN) continue
      socket.send(JSON.stringify({ code: 0, event, message: 'ok', payload, ts: Date.now() }))
    }
  }

  commandHttp.listen(0, '127.0.0.1')
  videoHttp.listen(0, '127.0.0.1')
  assetHttp?.listen(0, '127.0.0.1')
  await Promise.all([
    once(commandHttp, 'listening'),
    once(videoHttp, 'listening'),
    ...assetHttp === undefined ? [] : [once(assetHttp, 'listening')],
  ])
  const commandAddr = commandHttp.address()
  const videoAddr = videoHttp.address()
  if (commandAddr === null || typeof commandAddr === 'string') throw new Error('command bind failed')
  if (videoAddr === null || typeof videoAddr === 'string') throw new Error('video bind failed')
  const assetBound = assetHttp?.address()
  const boundAssetPort = assetBound !== null && assetBound !== undefined && typeof assetBound !== 'string' ? assetBound.port : undefined

  return {
    commandUrl: `ws://127.0.0.1:${String(commandAddr.port)}`,
    videoBaseUrl: `ws://127.0.0.1:${String(videoAddr.port)}`,
    assetBaseUrl: boundAssetPort === undefined ? undefined : `http://127.0.0.1:${String(boundAssetPort)}`,
    requests,
    assetAuthHeaders,
    emitEvent: (event, payload) => { broadcast(event, payload) },
    sendVideoFrame: () => {
      for (const socket of videoSockets) sendFramePair(socket)
    },
    closeCommandSockets: (code, reason) => {
      for (const socket of commandSockets) socket.close(code, reason)
    },
    emitHardgrab: () => {
      hardgrabSeq += 1
      const task_id = `hardgrab-${String(hardgrabSeq)}`
      const payload = {
        task_id,
        status: 'succeeded',
        device_id: devices[0]?.device_id ?? 'dev-1',
        image_base64: FAKE_JPEG.toString('base64'),
        assets: [{
          asset_id: 'asset-hardgrab',
          kind: 'final',
          content_type: 'image/jpeg',
          width: 1,
          height: 1,
          size: FAKE_JPEG.byteLength,
          data_base64: FAKE_JPEG.toString('base64'),
        }],
      }
      broadcast('capture.hardgrab', payload)
    },
    close: async () => {
      for (const socket of [...commandSockets, ...videoSockets]) socket.terminate()
      await Promise.all([
        new Promise<void>((resolve) => { commandWss.close(() => { commandHttp.close(() =>{  resolve() }) }) }),
        new Promise<void>((resolve) => { videoWss.close(() => { videoHttp.close(() =>{  resolve() }) }) }),
        ...assetHttp === undefined
          ? []
          : [new Promise<void>((resolve) => { assetHttp.close(() =>{  resolve() }) })],
      ])
    },
  }
}
