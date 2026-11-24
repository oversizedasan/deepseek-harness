/** Teacher-facing archive folder chip labels. */
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import {
  archiveBatchSegment,
  formatBatchWhen,
  formatFolderChipLabel,
} from '../src/client/batch-label.ts'
import type { DocScannerKey } from '../src/client/locales.ts'

function bind(dict: Record<DocScannerKey, string>): (
  key: DocScannerKey,
  params?: Record<string, string | number>,
) => string {
  return (key, params) => {
    let text = dict[key]
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

it('takes the batch segment from an archive directory', () => {
  expect(archiveBatchSegment('Captures/2026-11-20_165922')).toBe('2026-11-20_165922')
  expect(archiveBatchSegment('Captures/2026-11-20_165922/')).toBe('2026-11-20_165922')
  expect(archiveBatchSegment('2026-11-20_165922')).toBe('2026-11-20_165922')
})

it('formats today vs other-day when clauses', () => {
  const t = bind(zh)
  const now = new Date(2026, 10, 20, 18, 0, 0)
  expect(formatBatchWhen('2026-11-20_165922', t, now)).toBe('今天 16:59')
  expect(formatBatchWhen('2026-11-19_090500', t, now)).toBe('11月19日 09:05')
  expect(() => formatBatchWhen('not-a-stamp', t, now)).toThrow(/YYYY-MM-DD_HHmmss/)
})

it('builds a human chip label without exposing the storage path', () => {
  const tZh = bind(zh)
  const tEn = bind(en)
  const now = new Date(2026, 10, 20, 18, 0, 0)
  expect(formatFolderChipLabel('Captures/2026-11-20_165922', 4, tZh, now))
    .toBe('本批扫描 · 今天 16:59（4 张）')
  expect(formatFolderChipLabel('Captures/2026-11-20_165922', 4, tEn, now))
    .toBe('Batch scan · Today 16:59 (4)')
})
