/** Batch archive file naming under Captures/<batchId>/. */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { archiveCapture, type DocScannerImageBytes } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true })
  }))
})

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-doc-scanner-archive-'))
  roots.push(dir)
  return dir
}

function still(overrides: Partial<DocScannerImageBytes>): DocScannerImageBytes {
  return { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', width: 1, height: 1, ...overrides }
}

describe('archiveCapture', () => {
  it('appends an extension by MIME type when the provider name has none', async () => {
    const dir = await root()
    expect(await archiveCapture('b', still({ name: 'scan' }), dir)).toBe('Captures/b/scan.jpg')
    expect(await archiveCapture('b', still({ name: 'page', mimeType: 'image/png' }), dir)).toBe('Captures/b/page.png')
  })

  it('keeps a provider name that already has an extension', async () => {
    const dir = await root()
    expect(await archiveCapture('b', still({ name: 'page.jpeg' }), dir)).toBe('Captures/b/page.jpeg')
  })

  it('generates a PNG file name for unnamed PNG stills', async () => {
    const dir = await root()
    const path = await archiveCapture('b', still({ mimeType: 'image/png' }), dir)
    expect(path).toMatch(/^Captures\/b\/still-\d{8}-\d{6}-001\.png$/)
    expect((await readFile(join(dir, path))).byteLength).toBe(3)
  })

  it('flattens path separators in the batch id and file name', async () => {
    const dir = await root()
    const path = await archiveCapture('a/b\\c', still({ name: '../evil.jpg' }), dir)
    expect(path).toBe('Captures/a_b_c/.._evil.jpg')
    expect(await readdir(join(dir, 'Captures'))).toEqual(['a_b_c'])
  })
})
