/** Captures archive path helpers. */
import { describe, expect, it } from 'vitest'
import {
  capturesArchiveDirsFromDraft,
  isArchiveImageName,
  isCapturesArchiveDir,
  mentionPath,
  mimeTypeForArchiveImage,
} from '../src/client/archive-path.ts'

describe('archive-path', () => {
  it('decodes mentions and recognizes Captures batch directories', () => {
    expect(mentionPath('@Captures/2026-11-20_165922/')).toBe('Captures/2026-11-20_165922/')
    expect(isCapturesArchiveDir('Captures/2026-11-20_165922/')).toBe(true)
    expect(isCapturesArchiveDir('Captures/2026-11-20_165922/scan.jpg')).toBe(false)
    expect(isCapturesArchiveDir('Other/2026-11-20_165922')).toBe(false)
  })

  it('collects unique Captures folder chips from a draft, preferring doc-scanner source', () => {
    expect(capturesArchiveDirsFromDraft([
      { source: 'reference', ref: '@Captures/other/', appearance: 'folder' },
      { source: 'doc-scanner', ref: '@Captures/2026-11-20_165922/', appearance: 'folder' },
      { source: 'doc-scanner', ref: '@Captures/2026-11-20_165922/', appearance: 'folder' },
      { source: 'doc-scanner', ref: '@file.jpg', appearance: 'file' },
    ], 'doc-scanner')).toEqual([
      'Captures/2026-11-20_165922',
      'Captures/other',
    ])
  })

  it('ignores folder chips whose ref is not a mention', () => {
    expect(capturesArchiveDirsFromDraft([
      { source: 'doc-scanner', ref: 'Captures/2026-11-20_165922/', appearance: 'folder' },
      { source: 'doc-scanner', ref: '@"Captures/2026-11-20_170000"', appearance: 'folder' },
    ], 'doc-scanner')).toEqual(['Captures/2026-11-20_170000'])
  })

  it('classifies archive image names', () => {
    expect(isArchiveImageName('scan.JPG')).toBe(true)
    expect(isArchiveImageName('notes.txt')).toBe(false)
    expect(mimeTypeForArchiveImage('a.png')).toBe('image/png')
    expect(mimeTypeForArchiveImage('a.jpg')).toBe('image/jpeg')
    expect(mimeTypeForArchiveImage('a.webp')).toBe('image/jpeg')
  })
})
