/** Document scanner registry coordinates connect and capture. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocScanner, {
  type DocScannerImageBytes,
  type DocScannerPreviewFrame,
} from '../src/index.ts'
import { fakeProvider } from './fake-provider.ts'

const cwdRestore = process.cwd()
const tempRoots: string[] = []
afterEach(async () => {
  process.chdir(cwdRestore)
  await Promise.all(tempRoots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true })
  }))
})

describe('DocScanner', () => {
  it('connects a provider and captures preview bytes', async () => {
    const ctx = new Context()
    const base = ctx.plugin(DocScanner)
    await base
    try {
      const dispose = ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      expect(ctx.docScanner.snapshot().connection.phase).toBe('ready')
      const result = await ctx.docScanner.capture(AbortSignal.timeout(5_000))
      expect(result.mimeType).toBe('image/jpeg')
      expect(result.dataBase64.length).toBeGreaterThan(0)
      expect(result.attachmentId).toBeUndefined()
      const frames: DocScannerPreviewFrame[] = []
      const lifetime = new AbortController()
      for await (const frame of ctx.docScanner.preview(lifetime.signal)) {
        frames.push(frame)
        lifetime.abort()
      }
      expect(frames).toHaveLength(1)
      expect(frames[0]?.mimeType).toBe('image/jpeg')
      await ctx.docScanner.close()
      expect(ctx.docScanner.snapshot().connection.phase).toBe('disconnected')
      await dispose()
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('refuses preview before connect', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      const iterator = ctx.docScanner.preview(AbortSignal.timeout(1_000))[Symbol.asyncIterator]()
      await expect(iterator.next()).rejects.toMatchObject({ code: 'DOC_SCANNER_NOT_READY' })
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('archives capture bytes under Captures/<batchId>/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doc-scanner-'))
    tempRoots.push(root)
    process.chdir(root)
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      const result = await ctx.docScanner.capture(AbortSignal.timeout(5_000), { batchId: 'b1' })
      expect(result.workspacePath).toBe('Captures/b1/x.jpg')
      const bytes = await readFile(join(root, 'Captures', 'b1', 'x.jpg'))
      expect(bytes.byteLength).toBeGreaterThan(0)
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('archives under the Session workspace when sessionId is provided', async () => {
    const processRoot = await mkdtemp(join(tmpdir(), 'dsh-doc-scanner-cwd-'))
    const sessionRoot = await mkdtemp(join(tmpdir(), 'dsh-doc-scanner-session-'))
    tempRoots.push(processRoot, sessionRoot)
    process.chdir(processRoot)
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    ctx.provide('sessions', {
      get: (id: string) => id === 's1' ? { id: 's1' } : undefined,
    })
    ctx.provide('sandboxPolicy', {
      workspaceRoot: processRoot,
      resolve: ({ session }: { session?: { id?: string } }) => ({
        workspaceRoot: session?.id === 's1' ? sessionRoot : processRoot,
      }),
    })
    try {
      ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      const result = await ctx.docScanner.capture(AbortSignal.timeout(5_000), {
        batchId: 'b1',
        sessionId: 's1',
      })
      expect(result.workspacePath).toBe('Captures/b1/x.jpg')
      const bytes = await readFile(join(sessionRoot, 'Captures', 'b1', 'x.jpg'))
      expect(bytes.byteLength).toBeGreaterThan(0)
      await expect(readFile(join(processRoot, 'Captures', 'b1', 'x.jpg'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('names unnamed stills with a timestamp sequence under the batch folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doc-scanner-unnamed-'))
    tempRoots.push(root)
    process.chdir(root)
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      const provider = fakeProvider()
      provider.capture = async () => ({
        data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
      })
      ctx.docScanner.register(provider)
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      const first = await ctx.docScanner.capture(AbortSignal.timeout(5_000), { batchId: 'b2' })
      const second = await ctx.docScanner.capture(AbortSignal.timeout(5_000), { batchId: 'b2' })
      expect(first.workspacePath).toMatch(/^Captures\/b2\/still-\d{8}-\d{6}-001\.jpg$/)
      expect(second.workspacePath).toMatch(/^Captures\/b2\/still-\d{8}-\d{6}-002\.jpg$/)
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('forwards provider stills through followStills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doc-scanner-stills-'))
    tempRoots.push(root)
    process.chdir(root)
    const stillListeners = new Set<(image: DocScannerImageBytes) => void>()
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider({
        subscribeStills: (listener) => {
          stillListeners.add(listener)
          return () => { stillListeners.delete(listener) }
        },
      }))
      const lifetime = new AbortController()
      const iterator = ctx.docScanner.followStills(lifetime.signal, { batchId: 'push' })[Symbol.asyncIterator]()
      const pending = iterator.next()
      for (const listener of stillListeners) {
        listener({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg', width: 1, height: 1, name: 'h.jpg' })
      }
      const first = await pending
      if (first.done === true) throw new Error('followStills ended before yielding the pushed still')
      expect(first.value.name).toBe('h.jpg')
      expect(first.value.workspacePath).toBe('Captures/push/h.jpg')
      expect(first.value.dataBase64.length).toBeGreaterThan(0)
      lifetime.abort()
      await iterator.next()
    } finally {
      await ctx.parallel('dispose')
    }
  })
})
