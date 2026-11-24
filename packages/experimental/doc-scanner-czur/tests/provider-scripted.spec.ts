/** Provider races that need exact socket timing, driven through scripted in-memory sockets. */
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CzurDocScannerProvider, type CzurDocScannerProviderOptions } from '../src/provider.ts'
import { answerCommands, FakeSocket, type ScriptedReply } from './fake-socket.ts'

beforeEach(() => { FakeSocket.reset() })
afterEach(() => { FakeSocket.reset() })

const signal = (): AbortSignal => AbortSignal.timeout(5_000)
const pause = async (ms: number): Promise<void> => { await new Promise<void>((resolve) => { setTimeout(resolve, ms) }) }

/** Announce `video.ready` on every Video socket once the client is listening. */
function videoReadyAfterOpen(socket: FakeSocket): void {
  if (!socket.url.includes('stream_id')) return
  queueMicrotask(() => { socket.pushJson({ event: 'video.ready' }) })
}

/** Provider wired to scripted sockets that answer a normal Command session. */
function scriptedProvider(
  overrides: Readonly<Record<string, (params: Record<string, unknown>) => ScriptedReply>> = {},
  options: Partial<CzurDocScannerProviderOptions> = {},
): CzurDocScannerProvider {
  FakeSocket.script = {
    autoOpen: true,
    afterOpen: videoReadyAfterOpen,
    onSend: answerCommands(overrides),
    deferClose: true,
  }
  return new CzurDocScannerProvider({
    commandWsUrl: 'ws://sdk.test:18090',
    allowInsecureTls: false,
    resolveToken: async () => 'tok',
    WebSocketImpl: FakeSocket,
    ...options,
  })
}

/** The Command socket is always the first socket a provider opens. */
function commandSocket(): FakeSocket {
  const socket = FakeSocket.instances[0]
  if (socket === undefined) throw new Error('command socket missing')
  return socket
}

describe('subscribe', () => {
  it('stops notifying a listener after it unsubscribes', async () => {
    const provider = scriptedProvider()
    const seen: string[] = []
    const stop = provider.subscribe(() => { seen.push(provider.snapshot().phase) })
    stop()
    await provider.connect(signal())
    expect(seen).toEqual([])
    await provider.close()
  })
})

describe('connect cancellation', () => {
  it('rethrows a non-Error abort reason raised while the token is being resolved', async () => {
    const controller = new AbortController()
    const provider = scriptedProvider({}, {
      resolveToken: async () => {
        controller.abort('operator stop')
        return 'tok'
      },
    })
    await expect(provider.connect(controller.signal)).rejects.toBe('operator stop')
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: 'operator stop' })
  })
})

describe('Command socket close events', () => {
  it('reports an unexpected close from a ready session with its device', async () => {
    const provider = scriptedProvider()
    await provider.connect(signal())
    const socket = commandSocket()
    socket.close(1006, 'cable pulled')
    await once(socket, 'close')
    expect(provider.snapshot()).toMatchObject({
      phase: 'error',
      message: 'CZUR Command WS closed unexpectedly',
      deviceId: 'dev-1',
      displayName: 'Fake CZUR',
    })
  })

  it('reports an unexpected close before any device is selected without device fields', async () => {
    const provider = scriptedProvider()
    const messages: (string | undefined)[] = []
    provider.subscribe(() => { messages.push(provider.snapshot().message) })
    FakeSocket.script.onSend = (data, socket) => {
      if (data.includes('"auth.create_session"')) {
        socket.close(1011, 'runtime crashed')
        return
      }
      answerCommands()(data, socket)
    }
    await provider.connect(signal())
    expect(messages).toContain('CZUR Command WS closed unexpectedly')
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: expect.stringMatching(/Command WS closed/) as string })
    expect(provider.snapshot().deviceId).toBeUndefined()
  })

  it('keeps device_missing when the socket closes afterwards', async () => {
    const provider = scriptedProvider({ 'device.list': () => ({ data: { devices: [] } }) })
    await provider.connect(signal())
    const socket = commandSocket()
    socket.close(1006)
    await once(socket, 'close')
    expect(provider.snapshot()).toMatchObject({ phase: 'device_missing', message: 'No CZUR device is connected' })
  })

  it('keeps disconnected when the closed socket reports its close after provider.close', async () => {
    const provider = scriptedProvider()
    await provider.connect(signal())
    const socket = commandSocket()
    await provider.close()
    await once(socket, 'close')
    expect(provider.snapshot()).toEqual({ phase: 'disconnected' })
  })

  it('keeps the original error when the torn-down socket reports its close later', async () => {
    const provider = scriptedProvider({ 'device.open': () => ({ data: { opened: false } }) })
    await provider.connect(signal())
    const socket = commandSocket()
    await once(socket, 'close')
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: 'CZUR device.open did not report opened' })
  })
})

describe('session closed while work is in flight', () => {
  it('fails a capture as not ready when the provider closes while the video stream connects', async () => {
    const provider = scriptedProvider()
    FakeSocket.script.autoOpen = (url) => { return !url.includes('stream_id') }
    await provider.connect(signal())
    const capture = provider.capture(signal())
    const settled = capture.catch((error: unknown) => error)
    await vi.waitFor(() => { expect(FakeSocket.instances).toHaveLength(2) })
    const videoSocket = FakeSocket.instances[1]
    if (videoSocket === undefined) throw new Error('video socket missing')

    await provider.close()
    videoSocket.emit('open')
    await pause(0)
    videoSocket.pushJson({ event: 'video.ready' })

    await expect(settled).resolves.toMatchObject({ code: 'DOC_SCANNER_NOT_READY', message: 'CZUR scanner is not ready' })
  })

  it('drops a hardware still that arrives after the session was closed', async () => {
    const provider = scriptedProvider()
    await provider.connect(signal())
    const stills: number[] = []
    provider.subscribeStills((image) => { stills.push(image.data.byteLength) })
    const socket = commandSocket()
    await provider.close()
    socket.pushJson({
      event: 'capture.hardgrab',
      payload: { task_id: 'late', status: 'succeeded', assets: [{ asset_id: 'a', kind: 'final', download_url: 'http://asset.test/x' }] },
    })
    await pause(10)
    expect(stills).toEqual([])
  })
})

describe('video base URL', () => {
  it('derives the Video endpoint from the Command URL when none is configured', async () => {
    const provider = scriptedProvider()
    await provider.connect(signal())
    const controller = new AbortController()
    const next = provider.preview(controller.signal)[Symbol.asyncIterator]().next()
    await vi.waitFor(() => { expect(FakeSocket.instances).toHaveLength(2) })
    expect(FakeSocket.instances[1]?.url).toBe('ws://sdk.test:18091/?session_token=video-sess&stream_id=stream-1')
    controller.abort()
    expect((await next).done).toBe(true)
    await provider.close()
  })

  it('fails the preview when no Video endpoint can be derived', async () => {
    const provider = scriptedProvider({}, { commandWsUrl: 'ws://sdk.test' })
    await provider.connect(signal())
    await expect(provider.preview(signal())[Symbol.asyncIterator]().next())
      .rejects.toThrow('CZUR video WebSocket base URL could not be derived; set videoWsBaseUrl')
    await provider.close()
  })

  it('uses the configured Video endpoint without deriving one', async () => {
    const provider = scriptedProvider({}, { commandWsUrl: 'ws://sdk.test', videoWsBaseUrl: 'ws://video.test:9000' })
    await provider.connect(signal())
    const controller = new AbortController()
    const next = provider.preview(controller.signal)[Symbol.asyncIterator]().next()
    await vi.waitFor(() => { expect(FakeSocket.instances).toHaveLength(2) })
    expect(FakeSocket.instances[1]?.url).toBe('ws://video.test:9000/?session_token=video-sess&stream_id=stream-1')
    controller.abort()
    await next
    await provider.close()
  })
})
