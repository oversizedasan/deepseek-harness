/** Document-scanner Remote forwards connect/capture/close onto the registry. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import DocScanner from '@deepseek-ai/dsh-doc-scanner'
import { MockDocScannerProvider } from '@deepseek-ai/dsh-doc-scanner-mock'
import DocScannerController from '../src/index.ts'

const roots: Context[] = []
const cwdRestore = process.cwd()
const tempRoots: string[] = []
afterEach(async () => {
  process.chdir(cwdRestore)
  await Promise.all(tempRoots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true })
  }))
  await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
})

async function fixture(): Promise<{ api: DocScannerController; provider: MockDocScannerProvider }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(DocScanner)
  const provider = new MockDocScannerProvider()
  await ctx.inject(['docScanner'], (scope) => {
    scope.effect(() => scope.docScanner.register(provider))
  })
  return { api: new DocScannerController(ctx), provider }
}

it('snapshots providers and follows connection phases through connect and close', async () => {
  const { api } = await fixture()
  expect(api.snapshot().providers).toEqual([
    expect.objectContaining({ id: 'mock-czur', kind: 'mock', name: 'Mock CZUR' }),
  ])
  expect(api.snapshot().connection.phase).toBe('disconnected')
  const lifetime = new AbortController()
  const observation = api.follow(lifetime.signal)[Symbol.asyncIterator]()
  expect((await observation.next()).value).toMatchObject({ connection: { phase: 'disconnected' } })
  await api.connect({}, AbortSignal.timeout(5_000))
  expect(api.snapshot().connection.phase).toBe('ready')
  expect(api.snapshot().connection.displayName).toBe('Mock CZUR')
  lifetime.abort()
  await observation.next()
  await api.close()
  expect(api.snapshot().connection.phase).toBe('disconnected')
})

it('captures preview bytes only after ready and maps not-ready failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-api-doc-scanner-'))
  tempRoots.push(root)
  process.chdir(root)
  const { api } = await fixture()
  await expect(api.capture({}, AbortSignal.timeout(1_000))).rejects.toMatchObject({ code: 'doc-scanner/not-ready' })
  await api.connect({}, AbortSignal.timeout(5_000))
  const result = await api.capture({ batchId: 'test-batch' }, AbortSignal.timeout(5_000))
  expect(result.mimeType).toBe('image/jpeg')
  expect(result.width).toBe(1)
  expect(result.height).toBe(1)
  expect(result.dataBase64.length).toBeGreaterThan(10)
  expect(result.attachmentId).toBeUndefined()
  expect(result.workspacePath).toMatch(/^Captures\/test-batch\//)
})

it('streams wire preview frames after connect', async () => {
  const { api } = await fixture()
  await expect(api.preview(AbortSignal.timeout(1_000))[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'doc-scanner/not-ready' })
  await api.connect({}, AbortSignal.timeout(5_000))
  const lifetime = new AbortController()
  const frames = []
  for await (const frame of api.preview(lifetime.signal)) {
    frames.push(frame)
    if (frames.length >= 1) lifetime.abort()
  }
  expect(frames[0]?.mimeType).toBe('image/jpeg')
  expect(frames[0]?.dataBase64.length).toBeGreaterThan(10)
})
