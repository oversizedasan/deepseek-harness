/** Video WS client: connection lifecycle and frame_meta/JPEG pairing. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, type RawData } from 'ws'
import type { DocScannerPreviewFrame } from '@deepseek-ai/dsh-doc-scanner'
import { CzurVideoClient } from '../src/video-client.ts'
import { FAKE_JPEG, startFakeRuntime } from './fake-runtime.ts'
import { FakeSocket } from './fake-socket.ts'

/** Push `video.ready` after the client attached its listeners. */
function readyAfterOpen(): void {
  FakeSocket.script.afterOpen = (socket) => {
    queueMicrotask(() => { socket.pushJson({ event: 'video.ready' }) })
  }
}

function newClient(allowInsecureTls = true): CzurVideoClient {
  return new CzurVideoClient({ url: 'ws://127.0.0.1:9', allowInsecureTls, WebSocketImpl: FakeSocket })
}

/** Connect a client to a fresh fake socket that announces `video.ready`. */
async function connectedClient(): Promise<{ client: CzurVideoClient; socket: FakeSocket }> {
  readyAfterOpen()
  const client = newClient()
  await client.connect(AbortSignal.timeout(2_000))
  const socket = FakeSocket.last
  if (socket === undefined) throw new Error('socket missing')
  return { client, socket }
}

/** Start waiting for one frame; the waiter is registered before this returns. */
function waitForFrame(client: CzurVideoClient, signal: AbortSignal): Promise<IteratorResult<DocScannerPreviewFrame>> {
  return client.frames(signal)[Symbol.asyncIterator]().next()
}

const META = { event: 'stream.frame_meta', payload: { width: 640, height: 480, timestamp_ms: 7, pixel_format: 'mjpeg' } }

beforeEach(() => { FakeSocket.reset() })
afterEach(() => { vi.useRealTimers() })

describe('CzurVideoClient frame pairing', () => {
  it('does not treat Buffer text frame_meta as a JPEG frame', async () => {
    const { client, socket } = await connectedClient()

    const meta = Buffer.from(JSON.stringify({
      code: 0,
      event: 'stream.frame_meta',
      message: 'ok',
      payload: { width: 1280, height: 720, pixel_format: 'mjpeg', timestamp_ms: 1 },
    }), 'utf8')

    const frames: { byteLength: number; width: number; height: number }[] = []
    const lifetime = new AbortController()
    const consume = (async () => {
      for await (const frame of client.frames(lifetime.signal)) {
        frames.push({
          byteLength: frame.data.byteLength,
          width: frame.width,
          height: frame.height,
        })
        if (frames.length >= 1) lifetime.abort()
      }
    })()

    // Node `ws` delivers a text opcode as a Buffer with isBinary=false.
    socket.push(meta, false)
    socket.push(FAKE_JPEG, true)

    await consume
    expect(frames).toHaveLength(1)
    expect(frames[0]?.byteLength).toBe(FAKE_JPEG.byteLength)
    expect(frames[0]?.width).toBe(1280)
    expect(frames[0]?.height).toBe(720)
    client.close()
  })

  it('parses binary-marked JSON control frames without emitting them as JPEG', async () => {
    const { client, socket } = await connectedClient()

    const meta = Buffer.from(JSON.stringify({
      event: 'stream.frame_meta',
      payload: { width: 640, height: 480, timestamp_ms: 2 },
    }), 'utf8')

    const frames: number[] = []
    const lifetime = new AbortController()
    const consume = (async () => {
      for await (const frame of client.frames(lifetime.signal)) {
        frames.push(frame.data.byteLength)
        lifetime.abort()
      }
    })()

    socket.push(meta, true)
    socket.push(FAKE_JPEG, true)
    await consume
    expect(frames).toEqual([FAKE_JPEG.byteLength])
    client.close()
  })

  it('stamps a frame with its metadata timestamp, size, and a flat metadata form', async () => {
    const { client, socket } = await connectedClient()
    const lifetime = new AbortController()
    const first = waitForFrame(client, lifetime.signal)
    socket.pushJson(META)
    socket.push(FAKE_JPEG, true)
    expect((await first).value).toMatchObject({ mimeType: 'image/jpeg', width: 640, height: 480, ts: 7 })

    const second = waitForFrame(client, lifetime.signal)
    socket.pushJson({ event: 'stream.frame_meta', width: 320, height: 200 })
    socket.push(FAKE_JPEG, true)
    expect((await second).value).toMatchObject({ width: 320, height: 200 })
    client.close()
  })

  it('substitutes a 1x1 size and the receive time when metadata is missing or unusable', async () => {
    vi.useFakeTimers({ now: 1_234 })
    const { client, socket } = await connectedClient()
    const lifetime = new AbortController()
    const noMeta = waitForFrame(client, lifetime.signal)
    socket.push(FAKE_JPEG, true)
    expect((await noMeta).value).toMatchObject({ width: 1, height: 1, ts: 1_234 })

    const badMeta = waitForFrame(client, lifetime.signal)
    socket.pushJson({ event: 'stream.frame_meta', payload: { width: 'wide', height: 'tall' } })
    socket.push(FAKE_JPEG, true)
    expect((await badMeta).value).toMatchObject({ width: 1, height: 1, ts: 1_234 })
    client.close()
  })

  it('uses a null payload as the flat metadata record', async () => {
    const { client, socket } = await connectedClient()
    const next = waitForFrame(client, new AbortController().signal)
    socket.pushJson({ event: 'stream.frame_meta', payload: null, width: 5, height: 6 })
    socket.push(FAKE_JPEG, true)
    expect((await next).value).toMatchObject({ width: 5, height: 6 })
    client.close()
  })

  it('drops a JPEG nobody is waiting for', async () => {
    const { client, socket } = await connectedClient()
    socket.push(FAKE_JPEG, true)
    const lifetime = new AbortController()
    const next = waitForFrame(client, lifetime.signal)
    socket.push(FAKE_JPEG, true)
    expect((await next).done).toBe(false)
    client.close()
  })

  it('ignores empty, non-JPEG, non-JSON binary frames and unusable payload kinds', async () => {
    const { client, socket } = await connectedClient()
    const next = waitForFrame(client, new AbortController().signal)
    socket.push(Buffer.alloc(0), true)
    socket.push(Buffer.from('plain bytes'), true)
    socket.push('text in a binary frame', true)
    socket.emit('message', 42, true)
    socket.emit('message', 42, false)
    socket.push(Buffer.from('not json'), false)
    socket.push('5', false)
    socket.push('null', false)
    socket.pushJson({ event: 'other' })
    socket.pushJson({ noEvent: true })
    socket.push(FAKE_JPEG, true)
    expect((await next).done).toBe(false)
    client.close()
  })

  it.each<{ label: string; data: RawData }>([
    { label: 'a Buffer list', data: [Buffer.from(JSON.stringify(META).slice(0, 10)), Buffer.from(JSON.stringify(META).slice(10))] },
    { label: 'an ArrayBuffer', data: Uint8Array.from(Buffer.from(JSON.stringify(META))).buffer },
  ])('decodes text control frames sent as $label', async ({ data }) => {
    const { client, socket } = await connectedClient()
    const next = waitForFrame(client, new AbortController().signal)
    socket.push(data, false)
    socket.push(FAKE_JPEG, true)
    expect((await next).value).toMatchObject({ width: 640, height: 480 })
    client.close()
  })

  it.each<{ label: string; data: () => RawData }>([
    { label: 'a Buffer list', data: () => [FAKE_JPEG.subarray(0, 8), FAKE_JPEG.subarray(8)] },
    { label: 'an ArrayBuffer', data: () => Uint8Array.from(FAKE_JPEG).buffer },
  ])('decodes JPEG frames sent as $label', async ({ data }) => {
    const { client, socket } = await connectedClient()
    const next = waitForFrame(client, new AbortController().signal)
    socket.push(data(), true)
    const frame = (await next).value as DocScannerPreviewFrame
    expect(Buffer.from(frame.data).equals(FAKE_JPEG)).toBe(true)
    client.close()
  })

  it('ignores messages after close', async () => {
    const { client, socket } = await connectedClient()
    client.close()
    expect(() => { socket.push(FAKE_JPEG, true) }).not.toThrow()
  })
})

describe('CzurVideoClient.frames', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const { client } = await connectedClient()
    const controller = new AbortController()
    controller.abort(new Error('done'))
    await expect(waitForFrame(client, controller.signal)).rejects.toThrow('done')
    client.close()
  })

  it.each([
    { label: 'an Error reason', reason: new Error('viewer left'), message: 'viewer left' },
    { label: 'a non-Error reason', reason: 'left', message: 'Aborted' },
  ])('rejects a pending frame wait when $label aborts', async ({ reason, message }) => {
    const { client } = await connectedClient()
    const controller = new AbortController()
    const next = waitForFrame(client, controller.signal)
    controller.abort(reason)
    await expect(next).rejects.toThrow(message)
    client.close()
  })

  it('ends when the client is closed or the server closes the socket', async () => {
    const closedByClient = await connectedClient()
    const first = waitForFrame(closedByClient.client, new AbortController().signal)
    closedByClient.client.close()
    expect((await first).done).toBe(true)
    expect((await waitForFrame(closedByClient.client, new AbortController().signal)).done).toBe(true)

    const closedByServer = await connectedClient()
    const second = waitForFrame(closedByServer.client, new AbortController().signal)
    closedByServer.socket.close()
    expect((await second).done).toBe(true)
  })
})

describe('CzurVideoClient.connect', () => {
  it('skips certificate verification only when allowInsecureTls is set', async () => {
    readyAfterOpen()
    const insecure = newClient(true)
    await insecure.connect(AbortSignal.timeout(2_000))
    expect(FakeSocket.last?.options).toEqual({ rejectUnauthorized: false })
    const strict = newClient(false)
    await strict.connect(AbortSignal.timeout(2_000))
    expect(FakeSocket.last?.options).toEqual({})
    insecure.close()
    strict.close()
  })

  it('opens once and ignores a second connect', async () => {
    const { client, socket } = await connectedClient()
    await client.connect(AbortSignal.timeout(2_000))
    expect(FakeSocket.last).toBe(socket)
    client.close()
  })

  it('proceeds after a short grace when the Runtime sends no video.ready', async () => {
    vi.useFakeTimers()
    const client = newClient()
    let connected = false
    const pending = client.connect().then(() => { connected = true })
    await vi.advanceTimersByTimeAsync(499)
    expect(connected).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(connected).toBe(true)
    client.close()
  })

  it('connects to a real server through the default WebSocket implementation', async () => {
    const runtime = await startFakeRuntime()
    const client = new CzurVideoClient({ url: runtime.videoBaseUrl, allowInsecureTls: false })
    try {
      await client.connect(AbortSignal.timeout(2_000))
      const frame = await waitForFrame(client, AbortSignal.timeout(2_000))
      expect(frame.done).toBe(false)
    } finally {
      client.close()
      await runtime.close()
    }
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('too late'))
    await expect(newClient().connect(controller.signal)).rejects.toThrow('too late')
    expect(FakeSocket.last).toBeUndefined()
  })

  it.each([
    { label: 'an Error reason', reason: new Error('caller cancelled'), message: 'caller cancelled' },
    { label: 'a non-Error reason', reason: 'cancelled', message: 'Aborted' },
  ])('closes the socket when $label aborts the handshake', async ({ reason, message }) => {
    FakeSocket.script = { autoOpen: false }
    const controller = new AbortController()
    const pending = newClient().connect(controller.signal)
    const socket = FakeSocket.last
    controller.abort(reason)
    await expect(pending).rejects.toThrow(message)
    expect(socket?.readyState).toBe(WebSocket.CLOSED)
  })

  it('closes the socket when the signal aborts while the socket is being constructed', async () => {
    const controller = new AbortController()
    FakeSocket.script = {
      autoOpen: false,
      onConstruct: () => { controller.abort(new Error('aborted during construction')) },
    }
    await expect(newClient().connect(controller.signal)).rejects.toThrow('aborted during construction')
    expect(FakeSocket.last?.readyState).toBe(WebSocket.CLOSED)
  })

  it('rejects with the socket error raised before open', async () => {
    FakeSocket.script = { autoOpen: false }
    const pending = newClient().connect(AbortSignal.timeout(2_000))
    FakeSocket.last?.emit('error', new Error('handshake refused'))
    await expect(pending).rejects.toThrow('handshake refused')
  })

  it.each([
    { label: 'an Error reason', reason: new Error('caller cancelled'), message: 'caller cancelled' },
    { label: 'a non-Error reason', reason: 'cancelled', message: 'Aborted' },
  ])('rejects when $label aborts while waiting for video.ready', async ({ reason, message }) => {
    const controller = new AbortController()
    // The abort lands after the client attached its listeners and started waiting.
    FakeSocket.script.afterOpen = () => {
      queueMicrotask(() => { controller.abort(reason) })
    }
    await expect(newClient().connect(controller.signal)).rejects.toThrow(message)
  })

  it('rejects when the signal aborts right after the socket opens', async () => {
    const controller = new AbortController()
    FakeSocket.script = {
      autoOpen: true,
      afterOpen: () => { controller.abort(new Error('aborted after open')) },
    }
    await expect(newClient().connect(controller.signal)).rejects.toThrow('aborted after open')
  })

  it('connects again after close without waiting for a second video.ready', async () => {
    const client = newClient()
    client.close()
    await client.connect(AbortSignal.timeout(2_000))
    expect(FakeSocket.last).toBeDefined()
  })
})

describe('CzurVideoClient.close', () => {
  it('treats a second close as a no-op and works before connect', async () => {
    newClient().close()
    const { client, socket } = await connectedClient()
    client.close()
    const closes = vi.spyOn(socket, 'close')
    client.close()
    expect(closes).not.toHaveBeenCalled()
  })

  it('swallows a failure from the socket while closing', async () => {
    const { client } = await connectedClient()
    FakeSocket.script.onClose = () => { throw new Error('already gone') }
    expect(() => { client.close() }).not.toThrow()
  })
})
