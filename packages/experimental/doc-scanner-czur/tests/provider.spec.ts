/** CZUR provider against a loopback fake Runtime (no hardware). */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CzurDocScannerProvider } from '../src/provider.ts'
import { deriveVideoWsBaseUrl, downloadBytes } from '../src/urls.ts'
import { FAKE_JPEG, startFakeRuntime } from './fake-runtime.ts'

describe('deriveVideoWsBaseUrl', () => {
  it('maps 18090 to 18091 and 17090 to 17091', () => {
    expect(deriveVideoWsBaseUrl('wss://sdk-runtime.localhost:18090')).toBe('wss://sdk-runtime.localhost:18091')
    expect(deriveVideoWsBaseUrl('ws://127.0.0.1:17090')).toBe('ws://127.0.0.1:17091')
  })
})

describe('downloadBytes', () => {
  it('sends Authorization Bearer when provided', async () => {
    const seen: string[] = []
    const server = createServer((req, res) => {
      if (typeof req.headers.authorization === 'string') seen.push(req.headers.authorization)
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      res.end(FAKE_JPEG)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const addr = server.address()
    if (addr === null || typeof addr === 'string') throw new Error('bind failed')
    try {
      const bytes = await downloadBytes(`http://127.0.0.1:${String(addr.port)}/asset`, {
        allowInsecureTls: true,
        authorizationBearer: 'sess-token',
      })
      expect(bytes.byteLength).toBe(FAKE_JPEG.byteLength)
      expect(seen).toEqual(['Bearer sess-token'])
    } finally {
      await new Promise<void>((resolve) => { server.close(() =>{  resolve() }) })
    }
  })

  it('fails with HTTP 401 when Bearer is required but missing', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(401)
      res.end('unauthorized')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const addr = server.address()
    if (addr === null || typeof addr === 'string') throw new Error('bind failed')
    try {
      await expect(downloadBytes(`http://127.0.0.1:${String(addr.port)}/asset`, {
        allowInsecureTls: true,
      })).rejects.toThrow(/HTTP 401/)
    } finally {
      await new Promise<void>((resolve) => { server.close(() =>{  resolve() }) })
    }
  })
})

describe('CzurDocScannerProvider', () => {
  let closeRuntime: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (closeRuntime !== undefined) {
      await closeRuntime()
      closeRuntime = undefined
    }
  })

  it('connects to ready through auth, list, and open', async () => {
    const runtime = await startFakeRuntime()
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => 'test-token',
    })
    const phases: string[] = []
    provider.subscribe(() => { phases.push(provider.snapshot().phase) })
    await provider.connect(AbortSignal.timeout(5_000))
    expect(provider.snapshot().phase).toBe('ready')
    expect(provider.snapshot().displayName).toBe('Fake CZUR')
    expect(provider.snapshot().deviceId).toBe('dev-1')
    expect(phases).toContain('connecting')
    expect(phases).toContain('opening')
    expect(phases).toContain('ready')
    expect(runtime.requests.map(row => row.method)).toEqual(expect.arrayContaining([
      'auth.create_session',
      'device.list',
      'device.open',
    ]))
    await provider.close()
    expect(provider.snapshot().phase).toBe('disconnected')
  })

  it('reports device_missing when the list is empty', async () => {
    const runtime = await startFakeRuntime({ devices: [] })
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => 'test-token',
    })
    await provider.connect(AbortSignal.timeout(5_000))
    expect(provider.snapshot().phase).toBe('device_missing')
    await provider.close()
  })

  it('captures a JPEG after connect and returns to ready', async () => {
    const runtime = await startFakeRuntime()
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => 'test-token',
    })
    await provider.connect(AbortSignal.timeout(5_000))
    const image = await provider.capture(AbortSignal.timeout(5_000))
    expect(image.mimeType).toBe('image/jpeg')
    expect(image.data.byteLength).toBeGreaterThan(10)
    expect(provider.snapshot().phase).toBe('ready')
    await provider.close()
  })

  it('downloads capture assets with the auth session Bearer', async () => {
    const runtime = await startFakeRuntime({ assetViaHttp: true })
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => 'test-token',
    })
    await provider.connect(AbortSignal.timeout(5_000))
    const image = await provider.capture(AbortSignal.timeout(5_000))
    expect(image.data.byteLength).toBe(FAKE_JPEG.byteLength)
    expect(runtime.assetAuthHeaders).toEqual(['Bearer sess'])
    expect(provider.snapshot().phase).toBe('ready')
    await provider.close()
  })

  it('retries capture after RateLimited once', async () => {
    const runtime = await startFakeRuntime({ rateLimitFirstCapture: true })
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => 'test-token',
    })
    await provider.connect(AbortSignal.timeout(5_000))
    const image = await provider.capture(AbortSignal.timeout(5_000))
    expect(image.data.byteLength).toBeGreaterThan(10)
    const takes = runtime.requests.filter(row => row.method === 'capture.take')
    expect(takes.length).toBeGreaterThanOrEqual(2)
    await provider.close()
  })

  it('streams preview frames and stops when aborted', async () => {
    const runtime = await startFakeRuntime()
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => 'test-token',
    })
    await expect(provider.preview(AbortSignal.timeout(1_000))[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'DOC_SCANNER_NOT_READY',
    })
    await provider.connect(AbortSignal.timeout(5_000))
    const lifetime = new AbortController()
    const frames = []
    for await (const frame of provider.preview(lifetime.signal)) {
      frames.push(frame)
      if (frames.length >= 2) lifetime.abort()
    }
    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(frames[0]?.mimeType).toBe('image/jpeg')
    expect(frames[0]?.data.byteLength).toBeGreaterThan(10)
    await provider.close()
  })

  it('refuses capture after close', async () => {
    const runtime = await startFakeRuntime()
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => 'test-token',
    })
    await provider.connect(AbortSignal.timeout(5_000))
    await provider.close()
    await expect(provider.capture(AbortSignal.timeout(1_000))).rejects.toMatchObject({
      code: 'DOC_SCANNER_NOT_READY',
    })
  })

  it('enters error when the API token is missing', async () => {
    const runtime = await startFakeRuntime()
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      resolveToken: async () => undefined,
    })
    await provider.connect(AbortSignal.timeout(5_000))
    expect(provider.snapshot().phase).toBe('error')
    expect(provider.snapshot().message).toMatch(/token/i)
    await provider.close()
  })

  it('enables turn detect on connect and pushes hardgrab stills', async () => {
    const runtime = await startFakeRuntime()
    closeRuntime = runtime.close
    const provider = new CzurDocScannerProvider({
      commandWsUrl: runtime.commandUrl,
      videoWsBaseUrl: runtime.videoBaseUrl,
      allowInsecureTls: true,
      autoCapture: true,
      resolveToken: async () => 'test-token',
    })
    const stills: { mimeType: string; byteLength: number }[] = []
    const stopStills = provider.subscribeStills((image) => {
      stills.push({ mimeType: image.mimeType, byteLength: image.data.byteLength })
    })
    await provider.connect(AbortSignal.timeout(5_000))
    expect(runtime.requests.find(row => row.method === 'capture.set_turn_detect')?.params).toMatchObject({
      enabled: true,
      auto_capture: false,
      scan_device_type: 0,
    })
    runtime.emitHardgrab()
    await vi.waitFor(() => {
      expect(stills.length).toBeGreaterThanOrEqual(1)
    })
    expect(stills[0]?.mimeType).toBe('image/jpeg')
    expect(stills[0]?.byteLength).toBeGreaterThan(10)
    stopStills()
    await provider.close()
  })
})
