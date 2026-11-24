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
})
