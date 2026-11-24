/** Detect and normalize Session-relative `Captures/<batchId>` archive directories. */
import { DOC_SCANNER_CAPTURES_DIR } from './batch-archive-dir.ts'

/** Draft reference fields needed to find a doc-scanner archive folder chip. */
export interface ArchiveFolderReference {
  readonly source: string
  readonly ref: string
  readonly appearance?: 'session' | 'file' | 'folder' | undefined
}

/**
 * Decode the path a complete `@path` or `@"quoted path"` mention names.
 * @param mention - mention spelling starting with `@`.
 * @returns the path without the leading `@` and without surrounding double quotes.
 */
export function mentionPath(mention: string): string {
  return mention.slice(1).replace(/^"|"$/gu, '')
}

/**
 * Whether `path` is exactly `Captures/<batchId>` (with or without a trailing slash).
 * @param path - Session-relative path from a folder mention.
 * @returns `true` when the path, after converting `\` to `/` and trimming trailing slashes, has exactly one segment after `Captures/`.
 */
export function isCapturesArchiveDir(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/u, '')
  const prefix = `${DOC_SCANNER_CAPTURES_DIR}/`
  if (!normalized.startsWith(prefix)) return false
  const rest = normalized.slice(prefix.length)
  return rest.length > 0 && !rest.includes('/')
}

/**
 * Collect unique `Captures/<batchId>` dirs from draft folder chips (draft order).
 * Prefers references from the doc-scanner source; other folder chips under Captures still count.
 * @param references - persisted draft references.
 * @param docScannerSource - composer source id that owns archive folder chips.
 * @returns normalized `Captures/<batchId>` paths without trailing slashes, deduplicated, doc-scanner-source references first.
 */
export function capturesArchiveDirsFromDraft(
  references: readonly ArchiveFolderReference[],
  docScannerSource: string,
): readonly string[] {
  const dirs: string[] = []
  const seen = new Set<string>()
  const ordered = [
    ...references.filter(item => item.source === docScannerSource),
    ...references.filter(item => item.source !== docScannerSource),
  ]
  for (const reference of ordered) {
    if (reference.appearance !== 'folder') continue
    if (!reference.ref.startsWith('@')) continue
    const path = mentionPath(reference.ref).replaceAll('\\', '/').replace(/\/+$/u, '')
    if (!isCapturesArchiveDir(path) || seen.has(path)) continue
    seen.add(path)
    dirs.push(path)
  }
  return dirs
}

/**
 * Image basenames accepted when listing a batch archive.
 * @param name - file basename under the archive directory.
 * @returns `true` when the name ends in `.jpg`, `.jpeg`, `.png`, `.webp`, or `.gif` (case-insensitive).
 */
export function isArchiveImageName(name: string): boolean {
  return /\.(?:jpe?g|png|webp|gif)$/iu.test(name)
}

/** MIME types the tray / capture wire accept for restored archive stills. */
export type ArchiveImageMime = 'image/jpeg' | 'image/png'

/**
 * Guess an image MIME type from a file name.
 * WebP/GIF restore as JPEG-typed blobs for the tray wire union.
 * @param name - basename under the archive directory.
 * @returns `image/png` for `.png` names; `image/jpeg` for every other name.
 */
export function mimeTypeForArchiveImage(name: string): ArchiveImageMime {
  if (/\.png$/iu.test(name)) return 'image/png'
  return 'image/jpeg'
}
