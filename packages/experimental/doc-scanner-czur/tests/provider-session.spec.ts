/** Provider preview streaming, device removal, and session teardown against the fake Runtime. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocScannerPreviewFrame } from '@deepseek-ai/dsh-doc-scanner'
import { CzurCommandError } from '../src/command-client.ts'
import type { RuntimeCall } from './fake-runtime.ts'
import { disposeRigs, refusedHttpBase, startConnectedRig, startRig, type ProviderRig } from './provider-rig.ts'

afterEach(async () => {
  await disposeRigs()
})

const INLINE_BASE64 = Buffer.from('still').toString('base64')
const pause = async (ms: number): Promise<void> => { await new Promise<void>((resolve) => { setTimeout(resolve, ms) }) }

/** Answer `method` with `handler`; every other request keeps its default reply. */
function answering(method: string, handler: (call: RuntimeCall) => void): (call: RuntimeCall) => boolean {
  return (call) => {
    if (call.method !== method) return false
    handler(call)
    return true
  }
}

type FrameIterator = AsyncIterator<DocScannerPreviewFrame>

/**
 * Start a preview and wait for its first frame, pushing frames until the video
 * client is listening; leaves the iterator idle with no frame in flight.
 */
async function startPreview(rig: ProviderRig, signal: AbortSignal): Promise<{ frames: FrameIterator; first: DocScannerPreviewFrame }> {
  const frames = rig.provider.preview(signal)[Symbol.asyncIterator]()
  const pump = setInterval(() => { rig.runtime.sendVideoFrame() }, 10)
  let first: IteratorResult<DocScannerPreviewFrame>
  try {
    first = await frames.next()
  } finally {
    clearInterval(pump)
  }
  // Frames sent before the pump stopped may still be in flight.
  await pause(60)
  if (first.done === true) throw new Error('preview ended before its first frame')
  return { frames, first: first.value }
}

describe('preview stream start', () => {
  it('fails with the Runtime error when video.start is rejected', async () => {
    const rig = await startConnectedRig({ intercept: answering('video.start', (call) => { call.reply(5, 'camera busy') }) })
    const frames = rig.provider.preview(AbortSignal.timeout(5_000))[Symbol.asyncIterator]()
    const error: unknown = await frames.next().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CzurCommandError)
    expect(error).toMatchObject({ code: 5, message: 'camera busy' })
  })

  it('fails with the transport error when the Command socket drops during video.start', async () => {
    const rig = await startConnectedRig({ intercept: answering('video.start', (call) => { call.closeSocket() }) })
    await expect(rig.provider.preview(AbortSignal.timeout(5_000))[Symbol.asyncIterator]().next()).rejects.toThrow(/Command WS closed/)
  })

  it.each([
    { label: 'accepts the stop', stopReply: (call: RuntimeCall) => { call.reply(0, 'ok') } },
    { label: 'rejects the stop', stopReply: (call: RuntimeCall) => { call.reply(9, 'no such stream') } },
  ])('stops a stream owned by another connection and retries once when the Runtime $label', async ({ stopReply }) => {
    const rig = await startConnectedRig({
      intercept: (call) => {
        if (call.method === 'video.start' && call.count === 1) {
          call.reply(1301, 'Device already streaming')
          return true
        }
        if (call.method === 'video.stop' && call.count === 1) {
          stopReply(call)
          return true
        }
        return false
      },
    })
    const controller = new AbortController()
    const { first } = await startPreview(rig, controller.signal)
    controller.abort()
    expect(first.mimeType).toBe('image/jpeg')
    const methods = rig.runtime.requests.map(row => row.method)
    expect(methods.filter(method => method === 'video.start')).toHaveLength(2)
    expect(rig.runtime.requests.find(row => row.method === 'video.stop')?.params).toEqual({ device_id: 'dev-1' })
  })

  it.each<{ label: string; data: unknown }>([
    { label: 'no data', data: undefined },
    { label: 'null data', data: null },
    { label: 'text data', data: 'started' },
    { label: 'no session_token', data: { stream_id: 's' } },
    { label: 'no stream_id', data: { session_token: 't' } },
  ])('fails when video.start returns $label', async ({ data }) => {
    const rig = await startConnectedRig({ intercept: answering('video.start', (call) => { call.reply(0, 'ok', data) }) })
    await expect(rig.provider.preview(AbortSignal.timeout(5_000))[Symbol.asyncIterator]().next())
      .rejects.toThrow('CZUR video.start did not return stream_id and session_token')
  })

  it('fails when the Video WebSocket cannot be reached', async () => {
    const videoWsBaseUrl = (await refusedHttpBase()).replace('http:', 'ws:')
    const rig = await startConnectedRig({}, { videoWsBaseUrl })
    await expect(rig.provider.preview(AbortSignal.timeout(5_000))[Symbol.asyncIterator]().next()).rejects.toThrow(/ECONNREFUSED/)
  })

  it('shares one stream between concurrent previews', async () => {
    const rig = await startConnectedRig()
    const controller = new AbortController()
    const first = rig.provider.preview(controller.signal)[Symbol.asyncIterator]()
    const second = rig.provider.preview(controller.signal)[Symbol.asyncIterator]()
    const [one, two] = await Promise.all([first.next(), second.next()])
    controller.abort()
    expect(one.done).toBe(false)
    expect(two.done).toBe(false)
    expect(rig.runtime.requests.filter(row => row.method === 'video.start')).toHaveLength(1)
  })
})

describe('preview iteration', () => {
  it('ends quietly when the signal aborts while waiting for a frame', async () => {
    const rig = await startConnectedRig({ videoFrameIntervalMs: 0 })
    const controller = new AbortController()
    const { frames } = await startPreview(rig, controller.signal)
    const next = frames.next()
    controller.abort(new Error('viewer left'))
    expect((await next).done).toBe(true)
  })

  it('rethrows a failure thrown into the iterator by its consumer', async () => {
    const rig = await startConnectedRig({ videoFrameIntervalMs: 0 })
    const controller = new AbortController()
    const { frames } = await startPreview(rig, controller.signal)
    await expect(frames.throw?.(new Error('consumer failed'))).rejects.toThrow('consumer failed')
    controller.abort()
  })

  it('stops yielding once the provider leaves the previewable phases', async () => {
    const rig = await startConnectedRig({ videoFrameIntervalMs: 0 })
    const controller = new AbortController()
    const { frames } = await startPreview(rig, controller.signal)
    const next = frames.next()
    rig.runtime.closeCommandSockets()
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('error') })
    rig.runtime.sendVideoFrame()
    expect((await next).done).toBe(true)
    controller.abort()
  })
})

describe('device removal', () => {
  it.each<{ label: string; payload: unknown }>([
    { label: 'a payload naming the open device', payload: { device_id: 'dev-1' } },
    { label: 'no payload', payload: undefined },
    { label: 'a payload without a device id', payload: {} },
    { label: 'a payload that is not an object', payload: 'dev-1' },
  ])('marks the device missing and stops the video stream on $label', async ({ payload }) => {
    const rig = await startConnectedRig()
    const controller = new AbortController()
    await startPreview(rig, controller.signal)
    controller.abort()
    rig.runtime.emitEvent('device.removed', payload)
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('device_missing') })
    expect(rig.provider.snapshot().message).toBe('CZUR device was removed')
    await vi.waitFor(() => {
      expect(rig.runtime.requests.find(row => row.method === 'video.stop')?.params).toEqual({ stream_id: 'stream-1', device_id: 'dev-1' })
    })
  })

  it('ignores removal of another device and repeated removal of the same one', async () => {
    const rig = await startConnectedRig()
    const stills: number[] = []
    rig.provider.subscribeStills((image) => { stills.push(image.data.byteLength) })
    const sentinel = (): void => {
      rig.runtime.emitEvent('hardgrab.completed', { task_id: 's', status: 'succeeded', image_base64: INLINE_BASE64 })
    }
    rig.runtime.emitEvent('device.removed', { device_id: 'other-device' })
    sentinel()
    await vi.waitFor(() => { expect(stills).toHaveLength(1) })
    expect(rig.provider.snapshot().phase).toBe('ready')

    rig.runtime.emitEvent('device.removed', { device_id: 'dev-1' })
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('device_missing') })
    rig.runtime.emitEvent('device.removed', undefined)
    rig.runtime.emitEvent('hardgrab.completed', { task_id: 's2', status: 'succeeded', image_base64: INLINE_BASE64 })
    await vi.waitFor(() => { expect(stills).toHaveLength(2) })
    expect(rig.provider.snapshot().phase).toBe('device_missing')
  })
})

describe('device removed while the stream is starting', () => {
  it('stops the stream by id alone when the device is gone by teardown', async () => {
    const rig = await startConnectedRig({
      intercept: answering('video.start', (call) => {
        call.emit('device.removed', { device_id: 'dev-1' })
        call.reply(0, 'ok', { stream_id: 'stream-1', session_token: 'video-sess' })
      }),
    })
    const frames = rig.provider.preview(AbortSignal.timeout(5_000))[Symbol.asyncIterator]()
    const next = frames.next()
    let ended = false
    const pump = setInterval(() => { rig.runtime.sendVideoFrame() }, 10)
    try {
      await next.finally(() => { ended = true })
    } finally {
      clearInterval(pump)
    }
    expect(ended).toBe(true)
    expect(rig.provider.snapshot().phase).toBe('device_missing')
    await rig.provider.close()
    expect(rig.runtime.requests.filter(row => row.method === 'video.stop').map(row => row.params)).toContainEqual({ stream_id: 'stream-1' })
  })
})

describe('capture interrupted by the session', () => {
  /** Accept capture.take and keep the task running so nothing finishes on its own. */
  const hangingCapture = (call: RuntimeCall): boolean => {
    if (call.method === 'capture.take') {
      call.reply(0, 'ok', { task_id: 't1' })
      return true
    }
    if (call.method === 'capture.get') {
      call.reply(0, 'ok', { task_id: 't1', status: 'running' })
      return true
    }
    return false
  }

  /** Start a capture and wait until the Runtime accepted it; `settled` resolves with the capture's failure. */
  async function startHangingCapture(rig: ProviderRig, signal: AbortSignal): Promise<{ settled: Promise<unknown> }> {
    const settled = rig.provider.capture(signal).catch((error: unknown) => error)
    await vi.waitFor(() => { expect(rig.runtime.requests.some(row => row.method === 'capture.get')).toBe(true) })
    return { settled }
  }

  it('rejects the capture when the signal aborts while waiting for completion', async () => {
    const rig = await startConnectedRig({ intercept: hangingCapture })
    const controller = new AbortController()
    const { settled } = await startHangingCapture(rig, controller.signal)
    controller.abort(new Error('operator cancelled'))
    await expect(settled).resolves.toMatchObject({ message: 'operator cancelled' })
    expect(rig.provider.snapshot().phase).toBe('ready')
  })

  it.each([
    { label: 'an Error reason', reason: new Error('late cancel'), message: 'late cancel' },
    { label: 'a non-Error reason', reason: 'late cancel', message: 'Aborted' },
  ])('rejects the capture when $label aborts before its waiter is registered', async ({ reason, message }) => {
    const controller = new AbortController()
    const rig = await startConnectedRig({
      intercept: answering('capture.take', (call) => {
        call.reply(0, 'ok', { task_id: 't1' })
        controller.abort(reason)
      }),
    })
    await expect(rig.provider.capture(controller.signal)).rejects.toThrow(message)
  })

  it('rejects the capture when the provider is closed meanwhile', async () => {
    const rig = await startConnectedRig({ intercept: hangingCapture })
    const { settled } = await startHangingCapture(rig, AbortSignal.timeout(5_000))
    await rig.provider.close()
    await expect(settled).resolves.toMatchObject({ message: 'CZUR session closed' })
    expect(rig.provider.snapshot().phase).toBe('disconnected')
  })

  it('keeps the device_missing phase when the device is removed during the capture', async () => {
    const rig = await startConnectedRig({ intercept: hangingCapture })
    const controller = new AbortController()
    const { settled } = await startHangingCapture(rig, controller.signal)
    rig.runtime.emitEvent('device.removed', { device_id: 'dev-1' })
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('device_missing') })
    controller.abort(new Error('give up'))
    await expect(settled).resolves.toMatchObject({ message: 'give up' })
    expect(rig.provider.snapshot().phase).toBe('device_missing')
  })

  it('keeps the error phase when the Command socket drops during the capture', async () => {
    const rig = await startConnectedRig({ intercept: hangingCapture })
    const controller = new AbortController()
    const { settled } = await startHangingCapture(rig, controller.signal)
    rig.runtime.closeCommandSockets()
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('error') })
    controller.abort(new Error('give up'))
    await expect(settled).resolves.toMatchObject({ message: 'give up' })
    expect(rig.provider.snapshot()).toMatchObject({ phase: 'error', message: 'CZUR Command WS closed unexpectedly' })
  })
})

describe('session teardown', () => {
  it('closes cleanly when the Runtime rejects video.stop and device.close', async () => {
    const rig = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'video.stop' && call.method !== 'device.close') return false
        call.reply(9, 'refused')
        return true
      },
    })
    const controller = new AbortController()
    await startPreview(rig, controller.signal)
    controller.abort()
    await rig.provider.close()
    expect(rig.provider.snapshot().phase).toBe('disconnected')
    const methods = rig.runtime.requests.map(row => row.method)
    expect(methods).toContain('video.stop')
    expect(methods).toContain('device.close')
  })

  it('closes without device.close when no device was opened', async () => {
    const rig = await startConnectedRig({ devices: [] })
    await rig.provider.close()
    expect(rig.provider.snapshot().phase).toBe('disconnected')
    expect(rig.runtime.requests.map(row => row.method)).not.toContain('device.close')
  })

  it('closes a provider that never connected', async () => {
    const rig = await startRig()
    await rig.provider.close()
    expect(rig.provider.snapshot().phase).toBe('disconnected')
    expect(rig.runtime.requests).toEqual([])
  })
})
