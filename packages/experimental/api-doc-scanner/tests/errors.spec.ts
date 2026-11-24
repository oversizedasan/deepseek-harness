/** Document-scanner Remote maps registry failures to wire error codes and honors Client cancellation. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DocScannerError } from '@deepseek-ai/dsh-doc-scanner'
import DocScannerController from '../src/index.ts'

type Registry = Context['docScanner']

/** Build a controller over a registry stand-in that implements only the members a test drives. */
function controllerOver(registry: Partial<Registry>): DocScannerController {
  const ctx = new Context()
  ctx.provide('docScanner', registry)
  return new DocScannerController(ctx)
}

function failing(error: unknown): () => Promise<never> {
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- tests also drive non-Error rejections.
  return () => Promise.reject(error)
}

const CODES: readonly (readonly [string, string])[] = [
  ['DOC_SCANNER_NOT_READY', 'doc-scanner/not-ready'],
  ['DOC_SCANNER_NO_PROVIDER', 'doc-scanner/no-provider'],
  ['DOC_SCANNER_PROVIDER_UNAVAILABLE', 'doc-scanner/provider-unavailable'],
  ['DOC_SCANNER_DUPLICATE_PROVIDER', 'doc-scanner/duplicate-provider'],
  ['DOC_SCANNER_ATTACH_FAILED', 'doc-scanner/attach-failed'],
  ['DOC_SCANNER_SOMETHING_ELSE', 'doc-scanner/failed'],
]

describe('error mapping', () => {
  it.each(CODES)('maps %s to %s', async (code, wire) => {
    const api = controllerOver({ connect: failing(new DocScannerError('scanner said no', code)) })
    await expect(api.connect({}, AbortSignal.timeout(1_000))).rejects.toMatchObject({
      code: wire,
      message: 'scanner said no',
    })
  })

  it('maps an unexpected Error and a thrown string to doc-scanner/failed', async () => {
    const withError = controllerOver({ connect: failing(new Error('boom')) })
    await expect(withError.connect({}, AbortSignal.timeout(1_000))).rejects.toMatchObject({
      code: 'doc-scanner/failed',
      message: 'boom',
    })
    // The registry contract is typed, but a provider can still throw a bare string at runtime.
    const withString = controllerOver({ connect: failing('plain text') })
    await expect(withString.connect({}, AbortSignal.timeout(1_000))).rejects.toMatchObject({
      code: 'doc-scanner/failed',
      message: 'plain text',
    })
  })
})

describe('cancellation', () => {
  it('rethrows the abort reason instead of a mapped failure for connect and capture', async () => {
    const aborted = AbortSignal.abort(new Error('cancelled'))
    const api = controllerOver({
      connect: failing(new Error('late failure')),
      capture: failing(new Error('late failure')),
    })
    await expect(api.connect({}, aborted)).rejects.toThrow('cancelled')
    await expect(api.capture({}, aborted)).rejects.toThrow('cancelled')
  })

  it('maps capture failures while the Client is still attached', async () => {
    const api = controllerOver({ capture: failing(new DocScannerError('not ready', 'DOC_SCANNER_NOT_READY')) })
    await expect(api.capture({}, AbortSignal.timeout(1_000))).rejects.toMatchObject({ code: 'doc-scanner/not-ready' })
  })
})

describe('close', () => {
  it('maps a provider close failure', async () => {
    const api = controllerOver({ close: failing(new Error('device busy')) })
    await expect(api.close()).rejects.toMatchObject({ code: 'doc-scanner/failed', message: 'device busy' })
  })
})

describe('followStills', () => {
  it('forwards pushed stills', async () => {
    const still = { mimeType: 'image/jpeg', width: 1, height: 1, dataBase64: 'AA==' }
    const api = controllerOver({
      followStills: async function* () { yield await Promise.resolve(still) },
    })
    const seen: unknown[] = []
    for await (const item of api.followStills({ batchId: 'b' }, AbortSignal.timeout(1_000))) seen.push(item)
    expect(seen).toEqual([still])
  })

  it('maps a stream failure', async () => {
    const api = controllerOver({
      followStills: async function* () { throw new DocScannerError('stopped', 'DOC_SCANNER_NOT_READY') },
    })
    await expect(api.followStills({}, AbortSignal.timeout(1_000))[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'doc-scanner/not-ready' })
  })

  it('rethrows the abort reason when the Client has detached', async () => {
    const api = controllerOver({
      followStills: async function* () { throw new Error('torn down') },
    })
    await expect(api.followStills({}, AbortSignal.abort(new Error('cancelled')))[Symbol.asyncIterator]().next())
      .rejects.toThrow('cancelled')
  })
})

describe('preview', () => {
  const frame = (ts?: number): { data: Uint8Array; mimeType: string; width: number; height: number; ts?: number } => ({
    data: new Uint8Array([1, 2, 3]),
    mimeType: 'image/jpeg',
    width: 4,
    height: 5,
    ...ts === undefined ? {} : { ts },
  })

  it('encodes frames and carries the timestamp only when the provider set one', async () => {
    const api = controllerOver({
      preview: async function* () {
        yield await Promise.resolve(frame())
        yield await Promise.resolve(frame(7))
        yield await Promise.resolve({ ...frame(), rects: [] })
        yield await Promise.resolve({ ...frame(), rects: [{ x: 1, y: 2, width: 3, height: 4 }] })
      },
    })
    const seen = []
    for await (const wire of api.preview(AbortSignal.timeout(1_000))) seen.push(wire)
    expect(seen).toEqual([
      { dataBase64: 'AQID', mimeType: 'image/jpeg', width: 4, height: 5 },
      { dataBase64: 'AQID', mimeType: 'image/jpeg', width: 4, height: 5, ts: 7 },
      { dataBase64: 'AQID', mimeType: 'image/jpeg', width: 4, height: 5 },
      { dataBase64: 'AQID', mimeType: 'image/jpeg', width: 4, height: 5, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
    ])
  })

  it('stores a capture profile and maps a failure', async () => {
    const seen: unknown[] = []
    const api = controllerOver({
      setCaptureProfile: async (profile) => { seen.push(profile) },
    })
    const profile = { pageProcessing: 'curved_book' as const, colorMode: 'black_white' as const }
    await api.setCaptureProfile({ profile })
    expect(seen).toEqual([profile])
    const failingApi = controllerOver({
      setCaptureProfile: failing(new DocScannerError('not ready', 'DOC_SCANNER_NOT_READY')),
    })
    await expect(failingApi.setCaptureProfile({ profile })).rejects.toMatchObject({ code: 'doc-scanner/not-ready' })
  })

  it('maps a stream failure', async () => {
    const api = controllerOver({
      preview: async function* () { throw new DocScannerError('lost', 'DOC_SCANNER_NOT_READY') },
    })
    await expect(api.preview(AbortSignal.timeout(1_000))[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'doc-scanner/not-ready' })
  })

  it('stops with the abort reason when the Client detaches between frames', async () => {
    const lifetime = new AbortController()
    const api = controllerOver({
      preview: async function* () { yield await Promise.resolve(frame()) },
    })
    const iterator = api.preview(lifetime.signal)[Symbol.asyncIterator]()
    const first = iterator.next()
    lifetime.abort(new Error('cancelled'))
    await expect(first).rejects.toThrow('cancelled')
  })
})

describe('follow', () => {
  it('forwards registry snapshots', async () => {
    const snapshot = { providers: [], connection: { phase: 'disconnected' as const } }
    const api = controllerOver({
      follow: async function* () { yield await Promise.resolve(snapshot) },
      snapshot: () => snapshot,
    })
    const seen = []
    for await (const item of api.follow(AbortSignal.timeout(1_000))) seen.push(item)
    expect(seen).toEqual([snapshot])
    expect(api.snapshot()).toBe(snapshot)
  })
})
