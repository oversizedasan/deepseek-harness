/** Mock provider reaches ready and returns a JPEG without hardware. */
import { Context } from '@deepseek-ai/cordis'
import DocScanner from '@deepseek-ai/dsh-doc-scanner'
import { describe, expect, it } from 'vitest'
import * as MockPlugin from '../src/index.ts'
import { MockDocScannerProvider } from '../src/index.ts'

describe('MockDocScannerProvider', () => {
  it('connects to ready and captures a JPEG', async () => {
    const provider = new MockDocScannerProvider()
    const phases: string[] = []
    provider.subscribe(() => { phases.push(provider.snapshot().phase) })
    await provider.connect(AbortSignal.timeout(5_000))
    expect(provider.snapshot().phase).toBe('ready')
    expect(provider.snapshot().displayName).toBe('Mock CZUR')
    const image = await provider.capture(AbortSignal.timeout(5_000))
    expect(image.mimeType).toBe('image/jpeg')
    expect(image.width).toBe(1)
    expect(image.height).toBe(1)
    expect(image.data.byteLength).toBeGreaterThan(10)
    expect(provider.snapshot().phase).toBe('ready')
    expect(phases).toContain('connecting')
    expect(phases).toContain('ready')
    expect(phases).toContain('capturing')
    await provider.close()
    expect(provider.snapshot().phase).toBe('disconnected')
  })

  it('refuses capture before connect', async () => {
    const provider = new MockDocScannerProvider()
    await expect(provider.capture(AbortSignal.timeout(1_000))).rejects.toMatchObject({ code: 'DOC_SCANNER_NOT_READY' })
  })

  it('streams preview frames after connect and stops when aborted', async () => {
    const provider = new MockDocScannerProvider()
    await expect(provider.preview(AbortSignal.timeout(1_000))[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'DOC_SCANNER_NOT_READY' })
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
  })

  it('ends the preview loop quietly when aborted with a non-Error reason', async () => {
    const provider = new MockDocScannerProvider()
    await provider.connect(AbortSignal.timeout(5_000))
    const lifetime = new AbortController()
    const frames = []
    for await (const frame of provider.preview(lifetime.signal)) {
      frames.push(frame)
      lifetime.abort('stop')
    }
    expect(frames).toHaveLength(1)
  })

  it('stops previewing when the caller timeout fires', async () => {
    const provider = new MockDocScannerProvider()
    await provider.connect(AbortSignal.timeout(5_000))
    const frames = []
    for await (const frame of provider.preview(AbortSignal.timeout(50))) frames.push(frame)
    expect(frames.length).toBeGreaterThanOrEqual(1)
  })
})

describe('mock plugin', () => {
  it('registers the provider on the scanner service and removes it on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(DocScanner)
    const fiber = await ctx.plugin(MockPlugin)
    try {
      expect(ctx.docScanner.snapshot().providers.map(provider => provider.id)).toEqual(['mock-czur'])
      await fiber.dispose()
      expect(ctx.docScanner.snapshot().providers).toEqual([])
    } finally {
      await ctx.parallel('dispose')
    }
  })
})
