/** Resolve the Session-relative archive directory for a teacher batch. */

/**
 * Visible workspace folder for teacher batch archives.
 * Must stay aligned with Host `DOC_SCANNER_CAPTURES_DIR` in `dsh-doc-scanner`.
 */
export const DOC_SCANNER_CAPTURES_DIR = 'Captures'

/**
 * Prefer the parent of a still's `workspacePath`; otherwise `Captures/<batchId>`.
 * `batchId` is a local-time stamp from {@link createBatchId}.
 * Returned path has no trailing slash (mention grammar adds it for directories).
 * @param captures - tray stills that may already carry Host archive paths.
 * @param batchId - Client-owned batch folder name (same id sent with capture / followStills).
 * @returns the parent directory of the first capture whose non-empty `workspacePath` contains a `/`,
 *   with `\` converted to `/`; otherwise `Captures/<batchId>` with `/` and `\` in `batchId` replaced by `_`.
 */
export function batchArchiveDir(
  captures: readonly { readonly workspacePath?: string }[],
  batchId: string,
): string {
  for (const capture of captures) {
    const path = capture.workspacePath
    if (path === undefined || path.length === 0) continue
    const normalized = path.replaceAll('\\', '/')
    const slash = normalized.lastIndexOf('/')
    if (slash > 0) return normalized.slice(0, slash)
  }
  const safeBatch = batchId.replace(/[/\\]/g, '_')
  return `${DOC_SCANNER_CAPTURES_DIR}/${safeBatch}`
}
