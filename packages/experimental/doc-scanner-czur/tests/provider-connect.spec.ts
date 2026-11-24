/** Provider connect sequence: authentication, device selection, open, and failure reporting. */
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { CzurDocScannerProvider } from '../src/provider.ts'
import { FakeSocket } from './fake-socket.ts'
import { disposeRigs, refusedHttpBase, startConnectedRig, startRig } from './provider-rig.ts'

afterEach(async () => {
  FakeSocket.reset()
  await disposeRigs()
})

const signal = (): AbortSignal => AbortSignal.timeout(5_000)

describe('connect failures', () => {
  it('rejects without touching the Runtime when the signal is already aborted', async () => {
    const { runtime, provider } = await startRig()
    const controller = new AbortController()
    controller.abort(new Error('not now'))
    await expect(provider.connect(controller.signal)).rejects.toThrow('not now')
    expect(provider.snapshot().phase).toBe('disconnected')
    expect(runtime.requests).toEqual([])
  })

  it('enters error and rethrows when the signal aborts while the socket is being opened', async () => {
    const controller = new AbortController()
    FakeSocket.script = {
      autoOpen: false,
      onConstruct: () => { controller.abort(new Error('aborted while connecting')) },
    }
    const provider = new CzurDocScannerProvider({
      commandWsUrl: 'ws://sdk.test:18090',
      allowInsecureTls: false,
      resolveToken: async () => 'tok',
      WebSocketImpl: FakeSocket,
    })
    await expect(provider.connect(controller.signal)).rejects.toThrow('aborted while connecting')
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: 'aborted while connecting' })
  })

  it('enters error when the Command WebSocket cannot be reached', async () => {
    const commandWsUrl = (await refusedHttpBase()).replace('http:', 'ws:')
    const { provider } = await startRig({}, { commandWsUrl })
    await provider.connect(signal())
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: expect.stringContaining('ECONNREFUSED') as string })
  })

  it('treats an empty API token as unconfigured', async () => {
    const { provider, runtime } = await startRig({}, { resolveToken: async () => '' })
    await provider.connect(signal())
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: expect.stringMatching(/token is not configured/) as string })
    expect(runtime.requests).toEqual([])
  })

  it('reports the Runtime message when auth.create_session fails', async () => {
    const { provider } = await startRig({
      intercept: (call) => {
        if (call.method !== 'auth.create_session') return false
        call.reply(2, 'invalid token')
        return true
      },
    })
    await provider.connect(signal())
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: 'invalid token' })
  })

  it.each<{ label: string; data: unknown }>([
    { label: 'no data', data: undefined },
    { label: 'null data', data: null },
    { label: 'non-object data', data: 'session' },
    { label: 'data without session_token', data: { expires_in: 1 } },
    { label: 'an empty session_token', data: { session_token: '' } },
  ])('enters error when auth.create_session returns $label', async ({ data }) => {
    const { provider } = await startRig({
      intercept: (call) => {
        if (call.method !== 'auth.create_session') return false
        call.reply(0, 'ok', data)
        return true
      },
    })
    await provider.connect(signal())
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: 'CZUR auth.create_session did not return session_token' })
  })

  it('enters error and closes the device when device.open reports opened=false', async () => {
    const { provider, runtime } = await startRig({
      intercept: (call) => {
        if (call.method !== 'device.open') return false
        call.reply(0, 'ok', { opened: false })
        return true
      },
    })
    await provider.connect(signal())
    expect(provider.snapshot()).toMatchObject({ phase: 'error', message: 'CZUR device.open did not report opened' })
    expect(runtime.requests.map(row => row.method)).toContain('device.close')
  })
})

describe('device.open replies', () => {
  it.each<{ label: string; data: unknown }>([
    { label: 'no data', data: undefined },
    { label: 'null data', data: null },
    { label: 'an object that says neither opened nor failed', data: { device_id: 'dev-1' } },
    { label: 'status opened', data: { status: 'opened' } },
  ])('reaches ready when the Runtime answers $label', async ({ data }) => {
    const { provider } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'device.open') return false
        call.reply(0, 'ok', data)
        return true
      },
    })
    expect(provider.snapshot().phase).toBe('ready')
  })
})

describe('turn detect', () => {
  it('is not requested when autoCapture is false and is requested by default', async () => {
    const off = await startConnectedRig({}, { autoCapture: false })
    expect(off.runtime.requests.map(row => row.method)).not.toContain('device.set_turn_detect')
    const on = await startConnectedRig()
    expect(on.runtime.requests.map(row => row.method)).toContain('device.set_turn_detect')
  })

  it('does not block ready when the Runtime rejects it', async () => {
    const { provider } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'device.set_turn_detect') return false
        call.reply(7, 'unsupported')
        return true
      },
    })
    expect(provider.snapshot().phase).toBe('ready')
  })
})

describe('device selection', () => {
  it.each<{
    label: string
    devices: { device_id: string; display_name?: string; name?: string; model?: string }[]
    preferred?: string
    expected: string
  }>([
    {
      label: 'the preferred device id when present',
      devices: [{ device_id: 'a' }, { device_id: 'b' }],
      preferred: 'b',
      expected: 'b',
    },
    {
      label: 'the best-scoring device when the preferred id is unknown',
      devices: [{ device_id: 'a' }, { device_id: 'usb:1' }],
      preferred: 'missing',
      expected: 'usb:1',
    },
    {
      label: 'the first device when every device scores the same',
      devices: [{ device_id: 'a' }, { device_id: 'b' }],
      expected: 'a',
    },
    {
      label: 'a USB-style id over plain ids and built-in cameras',
      devices: [{ device_id: 'cam', display_name: 'FaceTime HD' }, { device_id: 'plain' }, { device_id: 'usb:7' }],
      expected: 'usb:7',
    },
    {
      label: 'a document-camera label over a USB-style id',
      devices: [{ device_id: 'usb:7' }, { device_id: 'x', name: 'Aura scanner' }],
      expected: 'x',
    },
    {
      label: 'a model label that names a document camera',
      devices: [{ device_id: 'plain' }, { device_id: 'y', model: 'ET16' }],
      expected: 'y',
    },
    {
      label: 'a later document camera over a built-in camera that is listed first',
      devices: [{ device_id: 'iphone:1', name: 'iPhone Continuity Camera' }, { device_id: 'z', display_name: 'CZUR' }],
      expected: 'z',
    },
  ])('selects $label', async ({ devices, preferred, expected }) => {
    const { provider } = await startConnectedRig({ devices }, preferred === undefined ? {} : { preferredDeviceId: preferred })
    expect(provider.snapshot()).toMatchObject({ phase: 'ready', deviceId: expected })
  })

  it.each([
    { label: 'display name', device: { device_id: 'd', display_name: 'Desk', name: 'n', model: 'm' }, expected: 'Desk' },
    { label: 'name', device: { device_id: 'd', name: 'n', model: 'm' }, expected: 'n' },
    { label: 'model', device: { device_id: 'd', model: 'm' }, expected: 'm' },
    { label: 'fixed default', device: { device_id: 'd' }, expected: 'CZUR' },
  ])('labels the device with its $label', async ({ device, expected }) => {
    const { provider } = await startConnectedRig({ devices: [device] })
    expect(provider.snapshot()).toMatchObject({ phase: 'ready', displayName: expected })
  })

  it('reports device_missing for an empty list without opening a device', async () => {
    const { provider, runtime } = await startConnectedRig({ devices: [] })
    expect(provider.snapshot()).toMatchObject({ phase: 'device_missing', message: 'No CZUR device is connected' })
    expect(runtime.requests.map(row => row.method)).not.toContain('device.open')
  })
})

describe('reconnecting', () => {
  it('closes the previous session before connecting again', async () => {
    const { provider, runtime } = await startConnectedRig()
    await provider.connect(signal())
    expect(provider.snapshot().phase).toBe('ready')
    const methods = runtime.requests.map(row => row.method)
    expect(methods.filter(method => method === 'device.close')).toHaveLength(1)
    expect(methods.filter(method => method === 'auth.create_session')).toHaveLength(2)
  })
})

describe('real WebSocket implementation injection', () => {
  it('connects and captures when the ws constructor is injected explicitly', async () => {
    const { provider } = await startConnectedRig({}, { WebSocketImpl: WebSocket })
    const image = await provider.capture(signal())
    expect(image.mimeType).toBe('image/jpeg')
  })
})
