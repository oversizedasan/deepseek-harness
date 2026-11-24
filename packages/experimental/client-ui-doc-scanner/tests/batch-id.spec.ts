/** Local-time batch folder ids. */
import { afterEach, expect, it } from 'vitest'
import {
  createBatchId,
  formatBatchStamp,
  parseBatchStamp,
  resetBatchIdClockForTests,
} from '../src/client/batch-id.ts'

afterEach(() => {
  resetBatchIdClockForTests()
})

it('formats a local YYYY-MM-DD_HHmmss stamp', () => {
  expect(formatBatchStamp(new Date(2026, 10, 20, 16, 59, 22))).toBe('2026-11-20_165922')
})

it('creates stamp ids and disambiguates the same second', () => {
  const now = new Date(2026, 10, 20, 16, 59, 22)
  expect(createBatchId(now)).toBe('2026-11-20_165922')
  expect(createBatchId(now)).toBe('2026-11-20_165922-2')
  expect(createBatchId(now)).toBe('2026-11-20_165922-3')
  expect(createBatchId(new Date(2026, 10, 20, 16, 59, 23))).toBe('2026-11-20_165923')
})

it('parses stamp segments including disambiguation suffixes', () => {
  expect(parseBatchStamp('2026-11-20_165922')).toEqual({
    year: 2026, month: 11, day: 20, hours: 16, minutes: 59, seconds: 22,
  })
  expect(parseBatchStamp('2026-11-20_165922-2')).toEqual({
    year: 2026, month: 11, day: 20, hours: 16, minutes: 59, seconds: 22,
  })
  expect(parseBatchStamp('not-a-stamp')).toBeNull()
})
