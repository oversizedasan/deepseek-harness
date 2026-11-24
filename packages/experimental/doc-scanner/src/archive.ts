/** Host-local still archival under a workspace root. */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DocScannerImageBytes } from './types.ts'

/**
 * Visible workspace folder for teacher batch archives (`Captures/<batchId>/`).
 * Kept out of `.dsh/` so Files / Finder can browse without enabling hidden items.
 */
export const DOC_SCANNER_CAPTURES_DIR = 'Captures'

/**
 * Build a default still file name when the provider omits `image.name`.
 * @param mimeType - still MIME type.
 * @param sequence - 1-based index within the batch folder.
 */
function defaultStillFileName(mimeType: string, sequence: number): string {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg'
  const now = new Date()
  const stamp = [
    now.getFullYear().toString(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  return `still-${stamp}-${String(sequence).padStart(3, '0')}.${ext}`
}

/**
 * Write still bytes under `{workspaceRoot}/Captures/<batchId>/`.
 * @param batchId - Client-owned batch folder name.
 * @param image - raw still to archive.
 * @param workspaceRoot - absolute Session or process workspace root.
 * @returns path relative to `workspaceRoot` (POSIX separators).
 */
export async function archiveCapture(
  batchId: string,
  image: DocScannerImageBytes,
  workspaceRoot: string = process.cwd(),
): Promise<string> {
  const safeBatch = batchId.replace(/[/\\]/g, '_')
  const dir = join(workspaceRoot, DOC_SCANNER_CAPTURES_DIR, safeBatch)
  await mkdir(dir, { recursive: true })
  const existing = await readdir(dir)
  const ext = image.mimeType === 'image/png' ? 'png' : 'jpg'
  const base = image.name?.replace(/[/\\]/g, '_')
    ?? defaultStillFileName(image.mimeType, existing.length + 1)
  const fileName = base.includes('.') ? base : `${base}.${ext}`
  await writeFile(join(dir, fileName), image.data)
  return [DOC_SCANNER_CAPTURES_DIR, safeBatch, fileName].join('/')
}
