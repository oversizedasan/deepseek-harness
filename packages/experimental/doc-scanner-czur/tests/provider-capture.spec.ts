/** Provider capture: request retries, completion events, polling fallback, and image extraction. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CzurCommandError } from '../src/command-client.ts'
import type { RuntimeCall } from './fake-runtime.ts'
import { FAKE_JPEG } from './fake-runtime.ts'
import { disposeRigs, refusedHttpBase, startConnectedRig, type ProviderRig } from './provider-rig.ts'

afterEach(async () => {
  vi.useRealTimers()
  await disposeRigs()
})

const INLINE_BASE64 = FAKE_JPEG.toString('base64')
const SENTINEL_BASE64 = Buffer.from('sentinel-still').toString('base64')
const SENTINEL_LENGTH = 'sentinel-still'.length
const signal = (): AbortSignal => AbortSignal.timeout(5_000)
const pause = async (ms: number): Promise<void> => { await new Promise<void>((resolve) => { setTimeout(resolve, ms) }) }

/** Task snapshot the fake Runtime reports as finished. */
function succeeded(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { task_id: 't1', status: 'succeeded', ...extra }
}

/** Push `event` shortly after the capture.take reply, once the provider registered its waiter. */
function later(call: RuntimeCall, event: string, payload: unknown): void {
  setTimeout(() => { call.emit(event, payload) }, 15)
}

interface CaptureScript {
  /** Answers capture.get; omitted means the default immediate success. */
  readonly poll?: (call: RuntimeCall) => void
  /** Runs after capture.take was accepted as task `t1`. */
  readonly afterAccept?: (call: RuntimeCall) => void
}

/** Accept capture.take as task `t1`; answer capture.get through `poll` when given. */
function captureScript(script: CaptureScript): (call: RuntimeCall) => boolean {
  return (call) => {
    if (call.method === 'capture.take') {
      call.reply(0, 'ok', { task_id: 't1' })
      script.afterAccept?.(call)
      return true
    }
    if (call.method === 'capture.get' && script.poll !== undefined) {
      script.poll(call)
      return true
    }
    return false
  }
}

/** Poll answer that keeps the task unfinished so events decide the outcome. */
const stillRunning = (call: RuntimeCall): void => { call.reply(0, 'ok', { task_id: 't1', status: 'running' }) }

/** Connected rig whose first capture finishes through `event` with the payload `build` returns. */
async function rigCompletingBuilt(event: string, build: (rig: ProviderRig) => unknown): Promise<ProviderRig> {
  const holder: { rig?: ProviderRig } = {}
  holder.rig = await startConnectedRig({
    assetViaHttp: true,
    intercept: captureScript({
      poll: stillRunning,
      afterAccept: (call) => {
        if (holder.rig === undefined) throw new Error('rig not started')
        later(call, event, build(holder.rig))
      },
    }),
  })
  return holder.rig
}

/** Connected rig whose first capture finishes through `event` and `payload`. */
async function rigCompletingWith(event: string, payload: unknown): Promise<ProviderRig> {
  return await rigCompletingBuilt(event, () => payload)
}

describe('capture requests', () => {
  it('rejects when the signal is already aborted', async () => {
    const { provider } = await startConnectedRig()
    const controller = new AbortController()
    controller.abort(new Error('nope'))
    await expect(provider.capture(controller.signal)).rejects.toThrow('nope')
    expect(provider.snapshot().phase).toBe('ready')
  })

  it.each<{ label: string; data: unknown }>([
    { label: 'no data', data: undefined },
    { label: 'text data', data: 'slow down' },
    { label: 'a negative delay', data: { retry_after_ms: -5 } },
    { label: 'a non-numeric delay', data: { retry_after_ms: 'soon' } },
  ])('waits the default delay after a rate limit with $label and can be cancelled meanwhile', async ({ data }) => {
    const controller = new AbortController()
    const { provider } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take') return false
        call.reply(1004, 'RateLimited', data)
        setTimeout(() => { controller.abort(new Error('give up')) }, 20)
        return true
      },
    })
    await expect(provider.capture(controller.signal)).rejects.toThrow('give up')
    expect(provider.snapshot().phase).toBe('ready')
  })

  it.each([
    { label: 'an Error reason', reason: new Error('cancelled in flight'), message: 'cancelled in flight' },
    { label: 'a non-Error reason', reason: 'cancelled', message: 'Aborted' },
  ])('stops retrying when $label aborts before the rate-limit reply is handled', async ({ reason, message }) => {
    const controller = new AbortController()
    const { provider } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take') return false
        call.reply(1004, 'RateLimited', { retry_after_ms: 10_000 })
        controller.abort(reason)
        return true
      },
    })
    await expect(provider.capture(controller.signal)).rejects.toThrow(message)
  })

  it('retries once after the device reports busy', async () => {
    const { provider, runtime } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take' || call.count > 1) return false
        call.reply(1201, 'DeviceBusy')
        return true
      },
    })
    const image = await provider.capture(signal())
    expect(image.data.byteLength).toBeGreaterThan(10)
    expect(runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(2)
  })

  it('gives up after three rate-limited attempts', async () => {
    const { provider, runtime } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take') return false
        call.reply(1004, 'RateLimited', { retry_after_ms: 1 })
        return true
      },
    })
    const error: unknown = await provider.capture(signal()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CzurCommandError)
    expect(error).toMatchObject({ code: 1004 })
    expect(runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(3)
    expect(provider.snapshot().phase).toBe('ready')
  })

  it('starts the video stream once and reuses it for later captures', async () => {
    const { provider, runtime } = await startConnectedRig()
    await provider.capture(signal())
    await provider.capture(signal())
    expect(runtime.requests.filter(row => row.method === 'video.start')).toHaveLength(1)
    expect(runtime.requests.find(row => row.method === 'video.start')?.params).toMatchObject({
      width: 1536,
      height: 1152,
      fps: 30,
    })
    expect(runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(2)
  })

  it('does not retry other Runtime errors', async () => {
    const { provider, runtime } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take') return false
        call.reply(1500, 'lens cap on')
        return true
      },
    })
    await expect(provider.capture(signal())).rejects.toMatchObject({ code: 1500, message: 'lens cap on' })
    expect(runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(1)
  })

  it.each<{ label: string; data: unknown }>([
    { label: 'no data', data: undefined },
    { label: 'null data', data: null },
    { label: 'text data', data: 'queued' },
    { label: 'data without task_id', data: { accepted: true } },
  ])('fails when capture.take returns $label', async ({ data }) => {
    const { provider } = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take') return false
        call.reply(0, 'ok', data)
        return true
      },
    })
    await expect(provider.capture(signal())).rejects.toThrow('CZUR capture.take did not return task_id')
  })
})

describe('capture completion events', () => {
  it.each([
    { label: 'a failed event with an error', event: 'capture.failed', payload: { task_id: 't1', status: 'failed', error: 'lens jammed' }, message: 'lens jammed' },
    { label: 'a failed event without an error', event: 'capture.failed', payload: { task_id: 't1', status: 'queued' }, message: 'CZUR capture failed' },
    { label: 'a completed event with failed status and an error', event: 'capture.completed', payload: { task_id: 't1', status: 'failed', error: 'bad page' }, message: 'bad page' },
    { label: 'a completed event with failed status and no error', event: 'capture.completed', payload: { task_id: 't1', status: 'failed' }, message: 'CZUR capture failed' },
  ])('rejects on $label', async ({ event, payload, message }) => {
    const { provider } = await rigCompletingWith(event, payload)
    await expect(provider.capture(signal())).rejects.toThrow(message)
    expect(provider.snapshot().phase).toBe('ready')
  })

  it.each(['hardgrab.completed', 'capture.hardgrab'])('resolves a pending capture from a %s event for its task', async (event) => {
    const { provider } = await rigCompletingWith(event, succeeded({ image_base64: INLINE_BASE64 }))
    const image = await provider.capture(signal())
    expect(Buffer.from(image.data).equals(FAKE_JPEG)).toBe(true)
  })

  it('returns the left page and pushes the right page for a curved-book still', async () => {
    const left = Buffer.from('left-page')
    const right = Buffer.from('right-page')
    const original = Buffer.from('original-color')
    const { provider } = await startConnectedRig({
      intercept: captureScript({
        poll: stillRunning,
        afterAccept: (call) => {
          later(call, 'capture.completed', succeeded({
            image_base64: original.toString('base64'),
            assets: [
              { asset_id: 'o', kind: 'original', base64: original.toString('base64'), width: 6528, height: 4896 },
              { asset_id: 'l', kind: 'final_left', base64: left.toString('base64'), width: 3257, height: 4881 },
              { asset_id: 'r', kind: 'final_right', base64: right.toString('base64'), width: 3257, height: 4881 },
              { asset_id: 't', kind: 'final_thumbnail_left', base64: Buffer.from('thumb').toString('base64') },
            ],
          }))
        },
      }),
    })
    const extra: string[] = []
    provider.subscribeStills((image) => { extra.push(Buffer.from(image.data).toString()) })
    const image = await provider.capture(signal())
    expect(Buffer.from(image.data).toString()).toBe('left-page')
    expect(image).toMatchObject({ width: 3257, height: 4881, name: 'czur-capture-t1-final_left.jpg' })
    await vi.waitFor(() => { expect(extra).toEqual(['right-page']) })
  })

  it('ignores events without a usable task and for unrelated names', async () => {
    const { provider, runtime } = await startConnectedRig({
      intercept: captureScript({
        poll: stillRunning,
        afterAccept: (call) => {
          setTimeout(() => {
            call.emit('capture.completed', null)
            call.emit('capture.progress', succeeded())
            call.emit('capture.completed', succeeded({ image_base64: INLINE_BASE64 }))
          }, 15)
        },
      }),
    })
    const image = await provider.capture(signal())
    expect(image.data.byteLength).toBe(FAKE_JPEG.byteLength)
    expect(runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(1)
  })
})

describe('capture polling fallback', () => {
  it('resolves from capture.get when no event arrives', async () => {
    const { provider } = await startConnectedRig({
      intercept: captureScript({
        poll: (call) => { call.reply(0, 'ok', succeeded({ image_base64: INLINE_BASE64 })) },
      }),
    })
    const image = await provider.capture(signal())
    expect(Buffer.from(image.data).equals(FAKE_JPEG)).toBe(true)
  })

  it.each([
    { label: 'its error', error: 'sensor fault', message: 'sensor fault' },
    { label: 'a generic message', error: undefined, message: 'CZUR capture failed' },
  ])('rejects with $label when capture.get reports failure', async ({ error, message }) => {
    const { provider } = await startConnectedRig({
      intercept: captureScript({
        poll: (call) => { call.reply(0, 'ok', { task_id: 't1', status: 'failed', ...error === undefined ? {} : { error } }) },
      }),
    })
    await expect(provider.capture(signal())).rejects.toThrow(message)
  })

  it.each<{ label: string; answer: (call: RuntimeCall) => void }>([
    { label: 'unusable data', answer: (call) => { call.reply(0, 'ok', null) } },
    { label: 'an unfinished task', answer: stillRunning },
    { label: 'a Runtime error', answer: (call) => { call.reply(5, 'try later') } },
  ])('keeps waiting for the event after capture.get answers with $label', async ({ answer }) => {
    const { provider } = await startConnectedRig({
      intercept: captureScript({
        poll: (call) => {
          answer(call)
          later(call, 'capture.completed', succeeded({ image_base64: INLINE_BASE64 }))
        },
      }),
    })
    const image = await provider.capture(signal())
    expect(image.data.byteLength).toBe(FAKE_JPEG.byteLength)
  })

  it('ignores a terminal capture.get answer that arrives after the event completed the capture', async () => {
    const { provider } = await startConnectedRig({
      intercept: captureScript({
        poll: (call) => {
          call.emit('capture.completed', succeeded({ image_base64: INLINE_BASE64 }))
          call.reply(0, 'ok', succeeded({ image_base64: INLINE_BASE64 }))
        },
      }),
    })
    const image = await provider.capture(signal())
    expect(image.data.byteLength).toBe(FAKE_JPEG.byteLength)
    expect(provider.snapshot().phase).toBe('ready')
  })

  it('stops polling quietly once an event completed the capture', async () => {
    const { provider, runtime } = await startConnectedRig({
      intercept: captureScript({
        poll: stillRunning,
        afterAccept: (call) => { later(call, 'capture.completed', succeeded({ image_base64: INLINE_BASE64 })) },
      }),
    })
    await provider.capture(signal())
    // The poll loop wakes after its 200 ms pause and must exit without another request.
    await pause(260)
    expect(runtime.requests.filter(row => row.method === 'capture.get')).toHaveLength(1)
    expect(provider.snapshot().phase).toBe('ready')
  })

  it('stops polling after the capture deadline while the capture itself keeps waiting', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const controller = new AbortController()
    const { provider, runtime } = await startConnectedRig({
      intercept: captureScript({
        poll: (call) => {
          stillRunning(call)
          vi.setSystemTime(Date.now() + 100_000)
        },
      }),
    })
    const pending = provider.capture(controller.signal)
    const rejected = expect(pending).rejects.toThrow('stop waiting')
    await vi.waitFor(() => { expect(runtime.requests.some(row => row.method === 'capture.get')).toBe(true) })
    await pause(260)
    expect(runtime.requests.filter(row => row.method === 'capture.get')).toHaveLength(1)
    controller.abort(new Error('stop waiting'))
    await rejected
  })
})

describe('captured image extraction', () => {
  it.each<{ label: string; payload: Record<string, unknown>; mimeType: string; width: number; height: number }>([
    { label: 'top-level data_base64', payload: succeeded({ data_base64: INLINE_BASE64 }), mimeType: 'image/jpeg', width: 1, height: 1 },
    { label: 'an inline image without assets', payload: succeeded({ image_base64: INLINE_BASE64 }), mimeType: 'image/jpeg', width: 1, height: 1 },
    {
      label: 'asset base64 with PNG metadata',
      payload: succeeded({ assets: [{ asset_id: 'a', kind: 'final', content_type: 'image/png', width: 7, height: 9, base64: INLINE_BASE64 }] }),
      mimeType: 'image/png',
      width: 7,
      height: 9,
    },
    {
      label: 'asset data_base64 without metadata',
      payload: succeeded({ assets: [{ asset_id: 'a', kind: 'original', data_base64: INLINE_BASE64 }] }),
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
    },
  ])('returns inline bytes from $label', async ({ payload, mimeType, width, height }) => {
    const { provider } = await rigCompletingWith('capture.completed', payload)
    const image = await provider.capture(signal())
    expect(image).toMatchObject({ mimeType, width, height, name: 'czur-capture-t1.jpg' })
    expect(Buffer.from(image.data).equals(FAKE_JPEG)).toBe(true)
  })

  interface DownloadCase {
    label: string
    asset: (base: string) => Record<string, unknown>
    extra?: Record<string, unknown>
    mimeType: string
    width: number
    height: number
  }

  it.each<DownloadCase>([
    {
      label: 'an asset url',
      asset: base => ({ asset_id: 'a', kind: 'final', url: `${base}/api/assets/t1/a/download` }),
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
    },
    {
      label: 'an asset download_url with PNG metadata',
      asset: base => ({ asset_id: 'a', kind: 'final', download_url: `${base}/api/assets/t1/a/download`, content_type: 'image/png', width: 3, height: 4 }),
      mimeType: 'image/png',
      width: 3,
      height: 4,
    },
    {
      label: 'an asset url when the inline field is empty',
      asset: base => ({ asset_id: 'a', kind: 'final', url: `${base}/api/assets/t1/a/download` }),
      extra: { image_base64: '' },
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
    },
  ])('downloads bytes from $label with the session Bearer', async ({ asset, extra, mimeType, width, height }) => {
    const { provider, runtime } = await rigCompletingBuilt('capture.completed', (rig) => {
      const base = rig.runtime.assetBaseUrl
      if (base === undefined) throw new Error('asset server missing')
      return succeeded({ ...extra, assets: [asset(base)] })
    })
    const image = await provider.capture(signal())
    expect(image).toMatchObject({ mimeType, width, height })
    expect(Buffer.from(image.data).equals(FAKE_JPEG)).toBe(true)
    expect(runtime.assetAuthHeaders).toEqual(['Bearer sess'])
  })

  it('downloads both curved-book pages and ignores the task-level original', async () => {
    const { provider, runtime } = await rigCompletingBuilt('capture.completed', (rig) => {
      const base = rig.runtime.assetBaseUrl
      if (base === undefined) throw new Error('asset server missing')
      return succeeded({
        image_base64: Buffer.from('not-the-page').toString('base64'),
        assets: [
          { asset_id: 'o', kind: 'original', base64: Buffer.from('original').toString('base64') },
          { asset_id: 'l', kind: 'final_left', url: `${base}/api/assets/t1/l/download`, width: 11, height: 12 },
          { asset_id: 'r', kind: 'final_right', download_url: `${base}/api/assets/t1/r/download`, width: 13, height: 14 },
        ],
      })
    })
    const extra: number[] = []
    provider.subscribeStills((image) => { extra.push(image.width) })
    const image = await provider.capture(signal())
    expect(image).toMatchObject({ width: 11, height: 12, name: 'czur-capture-t1-final_left.jpg' })
    expect(Buffer.from(image.data).equals(FAKE_JPEG)).toBe(true)
    await vi.waitFor(() => { expect(extra).toEqual([13]) })
    expect(runtime.assetAuthHeaders).toEqual(['Bearer sess', 'Bearer sess'])
  })

  it.each<{ label: string; payload: Record<string, unknown> }>([
    { label: 'no assets', payload: succeeded({ assets: [] }) },
    { label: 'an asset without a url', payload: succeeded({ assets: [{ asset_id: 'a', kind: 'final' }] }) },
  ])('fails with ATTACH_FAILED when the task has $label', async ({ payload }) => {
    const { provider } = await rigCompletingWith('capture.completed', payload)
    await expect(provider.capture(signal())).rejects.toMatchObject({
      code: 'DOC_SCANNER_ATTACH_FAILED',
      message: 'CZUR capture completed without image bytes',
    })
    expect(provider.snapshot().phase).toBe('ready')
  })

  it('fails with ATTACH_FAILED and keeps the cause when the asset download fails', async () => {
    const refused = await refusedHttpBase()
    const { provider } = await rigCompletingWith('capture.completed', succeeded({
      assets: [{ asset_id: 'a', kind: 'final', download_url: `${refused}/api/assets/t1/a/download` }],
    }))
    const error: unknown = await provider.capture(signal()).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'DOC_SCANNER_ATTACH_FAILED',
      message: expect.stringMatching(/^CZUR asset download failed: .*ECONNREFUSED/) as string,
      cause: expect.objectContaining({ code: 'ECONNREFUSED' }) as object,
    })
  })
})

describe('hardware stills', () => {
  /** Subscribe, then emit `events` followed by a good still; resolves with the stills received. */
  async function stillsAfter(
    rig: ProviderRig,
    events: readonly (readonly [string, unknown])[],
  ): Promise<number[]> {
    const received: number[] = []
    const unsubscribe = rig.provider.subscribeStills((image) => { received.push(image.data.byteLength) })
    for (const [event, payload] of events) rig.runtime.emitEvent(event, payload)
    rig.runtime.emitEvent('hardgrab.completed', { task_id: 'sentinel', status: 'succeeded', image_base64: SENTINEL_BASE64 })
    await vi.waitFor(() => { expect(received).toContain(SENTINEL_LENGTH) })
    unsubscribe()
    return received
  }

  it('delivers hardgrab and hardgrab.completed stills and nothing for failures or noise', async () => {
    const rig = await startConnectedRig()
    const received = await stillsAfter(rig, [
      ['capture.failed', { task_id: 'f1', status: 'succeeded', image_base64: INLINE_BASE64 }],
      ['capture.hardgrab', { task_id: 'f2', status: 'failed', image_base64: INLINE_BASE64 }],
      ['capture.completed', null],
      ['device.something', { task_id: 'f3' }],
      ['capture.hardgrab', { task_id: 'ok1', status: 'succeeded', image_base64: INLINE_BASE64 }],
    ])
    expect(received).toEqual([FAKE_JPEG.byteLength, SENTINEL_LENGTH])
  })

  it('delivers both pages from one hardgrab', async () => {
    const rig = await startConnectedRig()
    const received = await stillsAfter(rig, [[
      'capture.hardgrab',
      {
        task_id: 'paged',
        status: 'succeeded',
        assets: [
          { asset_id: 'l', kind: 'final_left', base64: Buffer.from('L').toString('base64') },
          { asset_id: 'r', kind: 'final_right', base64: Buffer.from('RR').toString('base64') },
        ],
      },
    ]])
    expect(received.filter(length => length !== SENTINEL_LENGTH)).toEqual([1, 2])
  })

  it('swallows a still that carries no image bytes', async () => {
    const rig = await startConnectedRig()
    const received = await stillsAfter(rig, [
      ['capture.hardgrab', { task_id: 'empty', status: 'succeeded' }],
    ])
    expect(received).toEqual([SENTINEL_LENGTH])
  })

  it('does not decode stills nobody listens to and stops after unsubscribe', async () => {
    const rig = await startConnectedRig()
    rig.runtime.emitEvent('capture.hardgrab', { task_id: 'unheard', status: 'succeeded', image_base64: INLINE_BASE64 })
    await pause(50)
    const received = await stillsAfter(rig, [])
    expect(received).toEqual([SENTINEL_LENGTH])
    const late: number[] = []
    const unsubscribe = rig.provider.subscribeStills((image) => { late.push(image.data.byteLength) })
    unsubscribe()
    rig.runtime.emitEvent('capture.hardgrab', { task_id: 'late', status: 'succeeded', image_base64: INLINE_BASE64 })
    await pause(50)
    expect(late).toEqual([])
  })

  it('accepts one hardgrab task and does not take again for that press', async () => {
    const rig = await startConnectedRig()
    const received: string[] = []
    rig.provider.subscribeStills((image) => { received.push(image.name) })
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      task: { task_id: 'grab-1', status: 'succeeded', image_base64: INLINE_BASE64 },
    })
    rig.runtime.emitEvent('capture.completed', { task_id: 'grab-1', status: 'succeeded', image_base64: INLINE_BASE64 })
    await vi.waitFor(() => { expect(received).toEqual(['czur-capture-grab-1.jpg']) })
    await pause(30)
    expect(received).toEqual(['czur-capture-grab-1.jpg'])
    expect(rig.runtime.requests.some(row => row.method === 'capture.take')).toBe(false)
  })

  it('takes one still when a hardware button has no usable task', async () => {
    const rig = await startConnectedRig()
    const names: string[] = []
    rig.provider.subscribeStills((image) => { names.push(image.name) })
    rig.runtime.emitEvent('capture.hardgrab_detected', { accepted: false, code: 1201, device_id: 'dev-1' })
    rig.runtime.emitEvent('capture.hardgrab_detected', null)
    rig.runtime.emitEvent('capture.hardgrab_detected', { accepted: true, device_id: 'dev-1' })
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      device_id: 'dev-1',
      task: { task_id: 'nope', status: 'failed' },
    })
    await vi.waitFor(() => { expect(names).toEqual(['czur-capture-task-1.jpg']) })
    expect(rig.runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(1)
  })

  it('takes when a finished hardware-button notice has no still', async () => {
    const rig = await startConnectedRig()
    const names: string[] = []
    rig.provider.subscribeStills((image) => { names.push(image.name) })
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      device_id: 'dev-1',
      task: { task_id: 'grab-bare', status: 'succeeded' },
    })
    await vi.waitFor(() => { expect(names).toEqual(['czur-capture-task-1.jpg']) })
    expect(rig.runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(1)
  })

  it('takes when a hardware-button task finishes without a still', async () => {
    const rig = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.get') return false
        call.reply(0, 'ok', {
          task_id: 'grab-empty',
          status: 'succeeded',
          assets: [{ asset_id: 'thumb', kind: 'final_thumbnail' }],
        })
        return true
      },
    })
    const names: string[] = []
    rig.provider.subscribeStills((image) => { names.push(image.name) })
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      device_id: 'dev-1',
      task: { task_id: 'grab-empty', status: 'queued' },
    })
    await vi.waitFor(() => { expect(names).toEqual(['czur-capture-task-1.jpg']) })
    expect(rig.runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(1)
  })

  it('does not take for a hardware button after the session has started closing', async () => {
    const rig = await startConnectedRig({
      intercept: call => call.method === 'capture.get',
    })
    rig.provider.subscribeStills(() => undefined)
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      task: { task_id: 'grab-closed', status: 'queued' },
    })
    await rig.provider.close()
    await pause(30)
    expect(rig.runtime.requests.some(row => row.method === 'capture.take')).toBe(false)
  })

  it('polls a queued hardgrab once and does not call capture.take for it', async () => {
    const rig = await startConnectedRig()
    const received: string[] = []
    rig.provider.subscribeStills((image) => { received.push(image.name) })
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      task_id: 'grab-queued',
      task: { task_id: 'grab-queued', status: 'queued' },
    })
    await vi.waitFor(() => { expect(received).toEqual(['czur-capture-grab-queued.jpg']) })
    expect(rig.runtime.requests.some(row => row.method === 'capture.take')).toBe(false)
    expect(rig.runtime.requests.some(row => row.method === 'capture.get' && row.params.task_id === 'grab-queued')).toBe(true)
  })

  it('drops a queued hardgrab when the session closes before the task finishes', async () => {
    const rig = await startConnectedRig({
      intercept: call => call.method === 'capture.get',
    })
    rig.provider.subscribeStills(() => undefined)
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      task: { task_id: 'grab-closed', status: 'queued' },
    })
    await rig.provider.close()
  })

  it('ignores a second notice for a hardgrab already being followed or already saved', async () => {
    const rig = await startConnectedRig({
      intercept: call => call.method === 'capture.get',
    })
    const queued = { accepted: true, task: { task_id: 'grab-twice', status: 'queued' } }
    rig.runtime.emitEvent('capture.hardgrab_detected', queued)
    rig.runtime.emitEvent('capture.hardgrab_detected', queued)
    let saved = false
    rig.provider.subscribeStills(() => { saved = true })
    rig.runtime.emitEvent('capture.hardgrab', { task_id: 'grab-saved', status: 'succeeded', image_base64: INLINE_BASE64 })
    rig.runtime.emitEvent('capture.hardgrab', { task_id: 'grab-saved', status: 'succeeded', image_base64: INLINE_BASE64 })
    await vi.waitFor(() => { expect(saved).toBe(true) })
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      task: { task_id: 'grab-saved', status: 'queued' },
    })
    Object.assign(rig.provider, { command: undefined })
    rig.runtime.emitEvent('capture.hardgrab_detected', {
      accepted: true,
      task: { task_id: 'grab-closed', status: 'queued' },
    })
  })
})

describe('page-turn capture', () => {
  it('takes one still for this device and skips an overlapping or too-soon turn', async () => {
    const rig = await startConnectedRig()
    const names: string[] = []
    rig.provider.subscribeStills((image) => { names.push(image.name) })
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'other' })
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1', auto_capture: false })
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1', auto_capture: false })
    await vi.waitFor(() => { expect(names).toEqual(['czur-capture-task-1.jpg']) })
    const takes = (): number => rig.runtime.requests.filter(row => row.method === 'capture.take').length
    expect(takes()).toBe(1)
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1' })
    await pause(40)
    expect(takes()).toBe(1)
    expect(names).toEqual(['czur-capture-task-1.jpg'])
  })

  it('takes when the event omits a device id and ignores a turn with nobody listening', async () => {
    const quiet = await startConnectedRig()
    quiet.runtime.emitEvent('capture.turn_detected', null)
    await pause(30)
    expect(quiet.runtime.requests.some(row => row.method === 'capture.take')).toBe(false)
    const rig = await startConnectedRig()
    const names: string[] = []
    rig.provider.subscribeStills((image) => { names.push(image.name) })
    rig.runtime.emitEvent('capture.turn_detected', null)
    await vi.waitFor(() => { expect(names).toEqual(['czur-capture-task-1.jpg']) })
  })

  it('ignores a page turn when the command connection or device is already gone', async () => {
    const missingCommand = await startConnectedRig()
    missingCommand.provider.subscribeStills(() => undefined)
    Object.assign(missingCommand.provider, { command: undefined })
    missingCommand.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1' })
    const missingDevice = await startConnectedRig()
    missingDevice.provider.subscribeStills(() => undefined)
    Object.assign(missingDevice.provider, { deviceId: undefined })
    missingDevice.runtime.emitEvent('capture.turn_detected', {})
    await pause(20)
    expect(missingCommand.runtime.requests.some(row => row.method === 'capture.take')).toBe(false)
    expect(missingDevice.runtime.requests.some(row => row.method === 'capture.take')).toBe(false)
  })

  it('does not take for a page turn while a shutter capture is in progress', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const rig = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take' || call.count !== 1) return false
        void gate.then(() => {
          call.reply(0, 'ok', { accepted: true, task_id: 'held', status: 'queued' })
          call.emit('capture.completed', {
            task_id: 'held',
            status: 'succeeded',
            image_base64: INLINE_BASE64,
          })
        })
        return true
      },
    })
    const pending = rig.provider.capture(signal())
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('capturing') })
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1' })
    release()
    await pending
    expect(rig.runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(1)
  })

  it('keeps device_missing when the device leaves during a page-turn capture', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const rig = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take') return false
        void gate.then(() => { call.reply(1500, 'gone') })
        return true
      },
    })
    rig.provider.subscribeStills(() => undefined)
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1' })
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('capturing') })
    rig.runtime.emitEvent('device.removed', { device_id: 'dev-1' })
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('device_missing') })
    release()
    await pause(30)
    expect(rig.provider.snapshot().phase).toBe('device_missing')
  })

  it('leaves the connection ready when a page-turn capture fails', async () => {
    const rig = await startConnectedRig({
      intercept: (call) => {
        if (call.method !== 'capture.take') return false
        call.reply(1500, 'lens cap on')
        return true
      },
    })
    rig.provider.subscribeStills(() => undefined)
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1' })
    await vi.waitFor(() => {
      expect(rig.runtime.requests.filter(row => row.method === 'capture.take')).toHaveLength(1)
    })
    await vi.waitFor(() => { expect(rig.provider.snapshot().phase).toBe('ready') })
  })

  it('does not take for a page turn when autoCapture is off', async () => {
    const rig = await startConnectedRig({}, { autoCapture: false })
    rig.provider.subscribeStills(() => undefined)
    rig.runtime.emitEvent('capture.turn_detected', { device_id: 'dev-1' })
    await pause(30)
    expect(rig.runtime.requests.some(row => row.method === 'capture.take')).toBe(false)
    expect(rig.runtime.requests.some(row => row.method === 'capture.set_turn_detect')).toBe(false)
  })
})

describe('capture profile', () => {
  it('sends the selected page and color treatment on video start and capture.take', async () => {
    const rig = await startConnectedRig()
    await rig.provider.setCaptureProfile({ pageProcessing: 'curved_book', colorMode: 'black_white' })
    const lifetime = new AbortController()
    for await (const frame of rig.provider.preview(lifetime.signal)) {
      expect(frame.mimeType).toBe('image/jpeg')
      lifetime.abort()
    }
    await rig.provider.capture(signal(), { pageProcessing: 'keep_original', colorMode: 'grayscale' })
    const start = rig.runtime.requests.find(row => row.method === 'video.start')
    const take = rig.runtime.requests.find(row => row.method === 'capture.take')
    expect(start?.params.profile).toMatchObject({ capture: { page_processing: 'curved_book', color_mode: 'black_white' } })
    expect(take?.params.profile).toMatchObject({ capture: { page_processing: 'keep_original', color_mode: 'grayscale' } })
  })

  it('updates a running preview with video.set_profile', async () => {
    const rig = await startConnectedRig()
    const lifetime = new AbortController()
    for await (const frame of rig.provider.preview(lifetime.signal)) {
      expect(frame.mimeType).toBe('image/jpeg')
      lifetime.abort()
    }
    await rig.provider.setCaptureProfile({
      pageProcessing: 'selected_area',
      colorMode: 'ancient',
      selection: { x: 1, y: 2, width: 3, height: 4, sourceWidth: 8, sourceHeight: 9 },
    })
    const update = rig.runtime.requests.find(row => row.method === 'video.set_profile')
    expect(update?.params.profile).toMatchObject({
      capture: {
        page_processing: 'selected_area',
        color_mode: 'ancient',
        selected_area: { source: { width: 8, height: 9 } },
      },
    })
  })
})
