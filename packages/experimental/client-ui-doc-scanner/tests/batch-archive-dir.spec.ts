import { describe, expect, it } from 'vitest'
import { batchArchiveDir } from '../src/client/batch-archive-dir.ts'

describe('batchArchiveDir', () => {
  it('uses the parent of the first workspacePath', () => {
    expect(batchArchiveDir(
      [
        { workspacePath: 'Captures/2026-11-20_165922/scan.jpg' },
        { workspacePath: 'Captures/2026-11-20_170000/x.jpg' },
      ],
      'ignored',
    )).toBe('Captures/2026-11-20_165922')
  })

  it('normalizes Windows separators before taking the parent', () => {
    expect(batchArchiveDir(
      [{ workspacePath: 'Captures\\2026-11-20_165922\\scan.jpg' }],
      '2026-11-20_165922',
    )).toBe('Captures/2026-11-20_165922')
  })

  it('uses Captures/<batchId> when no path is present', () => {
    expect(batchArchiveDir(
      [{}, { workspacePath: '' }],
      '2026-11-20_165922',
    )).toBe('Captures/2026-11-20_165922')
  })

  it('skips a path with no parent directory and falls back to the batch folder', () => {
    expect(batchArchiveDir(
      [{ workspacePath: 'scan.jpg' }, { workspacePath: '/scan.jpg' }],
      '2026-11-20_165922',
    )).toBe('Captures/2026-11-20_165922')
  })

  it('sanitizes path separators in the batch id', () => {
    expect(batchArchiveDir([], 'a/b\\c')).toBe('Captures/a_b_c')
  })
})
