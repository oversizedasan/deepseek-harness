/** Local-time batch folder ids for teacher-readable archive paths. */

/** Last emitted `YYYY-MM-DD_HHmmss` stamp (process-local collision guard). */
let lastStamp = ''
/** 1-based sequence within the same second as {@link lastStamp}. */
let stampSeq = 0

/**
 * Format a local wall-clock stamp used as the batch folder name segment.
 * @param now - clock instant (injectable for tests).
 * @returns `YYYY-MM-DD_HHmmss` in the local timezone.
 */
export function formatBatchStamp(now: Date = new Date()): string {
  const y = now.getFullYear().toString()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d}_${h}${mi}${s}`
}

/**
 * Create a Client-owned batch folder name under `Captures/`.
 * Uses a local timestamp so Files listings stay scannable; appends `-N` when
 * two batches start in the same second.
 * @param now - clock instant (injectable for tests).
 * @returns the `YYYY-MM-DD_HHmmss` stamp for the first batch in a second,
 *   then `<stamp>-2`, `<stamp>-3`, … for later calls in the same second within this process.
 */
export function createBatchId(now: Date = new Date()): string {
  const stamp = formatBatchStamp(now)
  if (stamp === lastStamp) {
    stampSeq += 1
    return `${stamp}-${stampSeq}`
  }
  lastStamp = stamp
  stampSeq = 1
  return stamp
}

/**
 * Reset the in-process stamp collision counter (tests only).
 */
export function resetBatchIdClockForTests(): void {
  lastStamp = ''
  stampSeq = 0
}

/** Parsed fields from a time-based batch folder segment. */
export interface BatchStampParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
}

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:-\d+)?$/u

/**
 * Parse a batch folder segment produced by {@link createBatchId}.
 * @param segment - last path segment under `Captures/`, or a full batch id.
 * @returns parts when the segment matches the stamp grammar; otherwise `null`.
 */
export function parseBatchStamp(segment: string): BatchStampParts | null {
  const match = STAMP_RE.exec(segment)
  if (match === null) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hours: Number(match[4]),
    minutes: Number(match[5]),
    seconds: Number(match[6]),
  }
}
