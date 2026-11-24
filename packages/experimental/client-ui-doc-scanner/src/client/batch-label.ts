/** Teacher-facing labels for archive folder chips (display ≠ storage path). */
import { parseBatchStamp } from './batch-id.ts'
import type { DocScannerKey } from './locales.ts'

/** Locale binder used to format chip copy. */
export type BatchLabelTranslate = (
  key: DocScannerKey,
  params?: Record<string, string | number>,
) => string

/**
 * Basename of an archive directory path (`Captures/<batchId>` → `<batchId>`).
 * @param dir - Session-relative archive directory without a required trailing slash.
 * @returns the last path segment after converting `\` to `/` and trimming trailing slashes; the whole path when it has no `/`.
 */
export function archiveBatchSegment(dir: string): string {
  const normalized = dir.replaceAll('\\', '/').replace(/\/+$/u, '')
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? normalized : normalized.slice(slash + 1)
}

/**
 * Human-readable "when" clause for a batch stamp, relative to `now`.
 * Batch ids are always {@link createBatchId} stamps in this first version.
 * @param segment - batch folder segment from {@link createBatchId}.
 * @param t - locale binder.
 * @param now - comparison clock (injectable for tests).
 * @returns the `folderChipWhenToday` copy with `HH:mm` when the stamp is on `now`'s local date;
 *   otherwise the `folderChipWhenOther` copy with month, day, and `HH:mm`.
 * @throws Error when `segment` does not match the stamp grammar.
 */
export function formatBatchWhen(
  segment: string,
  t: BatchLabelTranslate,
  now: Date = new Date(),
): string {
  const parts = parseBatchStamp(segment)
  if (parts === null) {
    throw new Error(`doc-scanner batch id must be YYYY-MM-DD_HHmmss, got ${segment}`)
  }
  const hh = String(parts.hours).padStart(2, '0')
  const mm = String(parts.minutes).padStart(2, '0')
  const time = `${hh}:${mm}`
  const sameDay = parts.year === now.getFullYear()
    && parts.month === now.getMonth() + 1
    && parts.day === now.getDate()
  if (sameDay) return t('folderChipWhenToday', { time })
  return t('folderChipWhenOther', {
    month: parts.month,
    day: parts.day,
    time,
  })
}

/**
 * Composer folder-chip label: time + count for teachers; never the raw path.
 * `ref` / `clipboardText` still carry `@Captures/<batchId>/`.
 * @param dir - archive directory used for the mention path.
 * @param count - still count in the attached batch.
 * @param t - locale binder.
 * @param now - comparison clock (injectable for tests).
 * @returns the `folderChipLabel` copy combining the batch time clause and `count`.
 * @throws Error when the last segment of `dir` does not match the stamp grammar.
 */
export function formatFolderChipLabel(
  dir: string,
  count: number,
  t: BatchLabelTranslate,
  now: Date = new Date(),
): string {
  return t('folderChipLabel', {
    when: formatBatchWhen(archiveBatchSegment(dir), t, now),
    count,
  })
}
