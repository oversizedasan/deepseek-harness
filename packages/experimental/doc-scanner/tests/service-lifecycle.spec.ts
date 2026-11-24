/** Document scanner registry: provider roster, observation streams, archive roots, and attachment hand-off. */
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DocScanner, { type DocScannerCaptureResult, type DocScannerImageBytes } from '../src/index.ts'
import { fakeProvider } from './fake-provider.ts'

const STILL: DocScannerImageBytes = {
  data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  mimeType: 'image/jpeg',
  width: 1,
  height: 1,
  name: 'p.jpg',
}

const cwdRestore = process.cwd()
const tempRoots: string[] = []
afterEach(async () => {
  process.chdir(cwdRestore)
  await Promise.all(tempRoots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true })
  }))
})

async function scratchRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-scanner-lifecycle-'))
  tempRoots.push(root)
  return root
}

describe('provider roster', () => {
  it('rejects a duplicate provider id and keeps the first registration', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      expect(() => ctx.docScanner.register(fakeProvider())).toThrow(
        expect.objectContaining({ code: 'DOC_SCANNER_DUPLICATE_PROVIDER' }),
      )
      expect(ctx.docScanner.snapshot().providers).toHaveLength(1)
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('removes a provider once and ignores a second disposer call', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      const dispose = ctx.docScanner.register(fakeProvider())
      await dispose()
      await dispose()
      expect(ctx.docScanner.snapshot().providers).toHaveLength(0)
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('clears the active provider when it is removed', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      const dispose = ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      expect(ctx.docScanner.snapshot().activeProviderId).toBe('fake')
      await dispose()
      expect(ctx.docScanner.snapshot().activeProviderId).toBeUndefined()
      expect(ctx.docScanner.snapshot().connection.phase).toBe('disconnected')
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('still unloads when a provider fails to close', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      const dispose = ctx.docScanner.register(fakeProvider({ closeError: new Error('device busy') }))
      await expect(dispose()).resolves.toBeUndefined()
      expect(ctx.docScanner.snapshot().providers).toHaveLength(0)
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('closes every provider and refuses new registrations after the service fiber disposes', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(DocScanner)
    await fiber
    const service = ctx.docScanner
    const closed = fakeProvider({ id: 'other' })
    const close = vi.spyOn(closed, 'close')
    service.register(closed)
    await fiber.dispose()
    expect(close).toHaveBeenCalledOnce()
    expect(() => service.register(fakeProvider())).toThrow('Document scanner disposed')
  })
})

describe('provider selection', () => {
  it('requires an explicit choice when several providers are registered', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider({ id: 'a' }))
      ctx.docScanner.register(fakeProvider({ id: 'b' }))
      await expect(ctx.docScanner.connect(undefined, AbortSignal.timeout(1_000)))
        .rejects.toMatchObject({ code: 'DOC_SCANNER_NO_PROVIDER' })
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('reports no provider when none is registered', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      await expect(ctx.docScanner.connect(undefined, AbortSignal.timeout(1_000)))
        .rejects.toMatchObject({ code: 'DOC_SCANNER_NO_PROVIDER' })
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('reports an unknown provider id as unavailable', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      await expect(ctx.docScanner.connect(fakeProvider({ id: 'missing' }).info.id, AbortSignal.timeout(1_000)))
        .rejects.toMatchObject({ code: 'DOC_SCANNER_PROVIDER_UNAVAILABLE' })
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('refuses capture before the provider is ready', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      await expect(ctx.docScanner.capture(AbortSignal.timeout(1_000)))
        .rejects.toMatchObject({ code: 'DOC_SCANNER_NOT_READY' })
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('treats close without an active provider as a no-op', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      await expect(ctx.docScanner.close()).resolves.toBeUndefined()
    } finally {
      await ctx.parallel('dispose')
    }
  })
})

describe('follow', () => {
  it('yields a snapshot per change and ends when the caller aborts', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      const lifetime = new AbortController()
      const iterator = ctx.docScanner.follow(lifetime.signal)[Symbol.asyncIterator]()

      const initial = await iterator.next()
      if (initial.done === true) throw new Error('follow ended before the first snapshot')
      expect(initial.value.connection.phase).toBe('disconnected')

      const changed = iterator.next()
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      const afterConnect = await changed
      if (afterConnect.done === true) throw new Error('follow ended before the connect snapshot')
      expect(afterConnect.value.activeProviderId).toBe('fake')

      // Drain trailing change notifications until the stream blocks waiting for the next one.
      let pending = iterator.next()
      for (;;) {
        const settled = await Promise.race([
          pending,
          new Promise<'idle'>((resolve) => { setImmediate(() => { resolve('idle') }) }),
        ])
        if (settled === 'idle') break
        pending = iterator.next()
      }
      lifetime.abort()
      await expect(pending).resolves.toMatchObject({ done: true })
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('rejects an already aborted caller', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      const iterator = ctx.docScanner.follow(AbortSignal.abort(new Error('gone')))[Symbol.asyncIterator]()
      await expect(iterator.next()).rejects.toThrow('gone')
    } finally {
      await ctx.parallel('dispose')
    }
  })
})

describe('followStills', () => {
  it('waits for a pushed still and stops when the caller aborts while idle', async () => {
    const root = await scratchRoot()
    process.chdir(root)
    const listeners = new Set<(image: DocScannerImageBytes) => void>()
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider({
        subscribeStills: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }))
      const lifetime = new AbortController()
      const iterator = ctx.docScanner.followStills(lifetime.signal, { batchId: 'idle' })[Symbol.asyncIterator]()

      const first = iterator.next()
      for (const listener of listeners) listener(STILL)
      const result = await first
      if (result.done === true) throw new Error('followStills ended before the pushed still')
      expect(result.value.workspacePath).toBe('Captures/idle/p.jpg')

      const idle = iterator.next()
      lifetime.abort()
      await expect(idle).resolves.toMatchObject({ done: true })
      expect(listeners.size).toBe(1)
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('rejects an already aborted caller', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      const iterator = ctx.docScanner.followStills(AbortSignal.abort(new Error('gone')))[Symbol.asyncIterator]()
      await expect(iterator.next()).rejects.toThrow('gone')
    } finally {
      await ctx.parallel('dispose')
    }
  })
})

describe('archive root', () => {
  it('uses the process directory when a Session id arrives without workspace services', async () => {
    const root = await scratchRoot()
    process.chdir(root)
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    try {
      ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      const result = await ctx.docScanner.capture(AbortSignal.timeout(5_000), { batchId: 'b', sessionId: 's1' })
      expect(result.workspacePath).toBe('Captures/b/x.jpg')
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('uses the policy workspace when the Session is not live', async () => {
    const processRoot = await scratchRoot()
    const policyRoot = await scratchRoot()
    process.chdir(processRoot)
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    ctx.provide('sessions', { get: () => undefined })
    ctx.provide('sandboxPolicy', { workspaceRoot: policyRoot, resolve: () => ({ workspaceRoot: processRoot }) })
    try {
      ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      await ctx.docScanner.capture(AbortSignal.timeout(5_000), { batchId: 'b', sessionId: 'gone' })
      expect(await readdir(join(policyRoot, 'Captures', 'b'))).toEqual(['x.jpg'])
    } finally {
      await ctx.parallel('dispose')
    }
  })
})

describe('attachment hand-off', () => {
  it('returns the stored attachment id with the archived path', async () => {
    const root = await scratchRoot()
    process.chdir(root)
    const saveImages = vi.fn(() => Promise.resolve([{ attachmentId: 'att-1' }]))
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    ctx.provide('attachments', { saveImages })
    try {
      ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      const result: DocScannerCaptureResult = await ctx.docScanner.capture(AbortSignal.timeout(5_000), { batchId: 'b' })
      expect(result.attachmentId).toBe('att-1')
      expect(result.workspacePath).toBe('Captures/b/x.jpg')
      expect(saveImages).toHaveBeenCalledWith([expect.objectContaining({ mediaType: 'image/jpeg', name: 'x.jpg' })])
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('sends unnamed stills to the store without a name', async () => {
    const saveImages = vi.fn(() => Promise.resolve([{ attachmentId: 'att-2' }]))
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    ctx.provide('attachments', { saveImages })
    try {
      const provider = fakeProvider()
      provider.capture = () => Promise.resolve({ data: STILL.data, mimeType: 'image/jpeg', width: 1, height: 1 })
      ctx.docScanner.register(provider)
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      const result = await ctx.docScanner.capture(AbortSignal.timeout(5_000))
      expect(result.attachmentId).toBe('att-2')
      expect(result.name).toBeUndefined()
    } finally {
      await ctx.parallel('dispose')
    }
  })

  it('fails when the store returns no reference', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    ctx.provide('attachments', { saveImages: () => Promise.resolve([]) })
    try {
      ctx.docScanner.register(fakeProvider())
      await ctx.docScanner.connect(undefined, AbortSignal.timeout(5_000))
      await expect(ctx.docScanner.capture(AbortSignal.timeout(5_000)))
        .rejects.toMatchObject({ code: 'DOC_SCANNER_ATTACH_FAILED' })
    } finally {
      await ctx.parallel('dispose')
    }
  })
})
