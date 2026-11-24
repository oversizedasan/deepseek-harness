/** Process-local UI state shared by the composer chip and preview pane. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DocScannerCaptureResult } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBatchId } from './batch-id.ts'

export { createBatchId } from './batch-id.ts'

/** Capture tray and in-flight notice shared across scanner surfaces. */
export interface DocScannerSessionUi {
  /** Ordered stills in the current teacher batch. */
  readonly captures: readonly DocScannerCaptureResult[]
  /**
   * Client-owned batch folder name under `Captures/` (`YYYY-MM-DD_HHmmss`).
   * Sent with capture / followStills; also the Files listing segment.
   */
  readonly batchId: string
  /**
   * Session whose workspace receives batch archival.
   * Set when the preview tab opens for a Session; sent with capture / followStills.
   */
  readonly archiveSessionId: SessionId | null
  /** True while a connect / capture / draft / close action runs. */
  readonly working: boolean
  /** Localized or transport error shown beside phase status. */
  readonly message: string | null
  /**
   * Folder mention last inserted by attach (`@Captures/<batchId>/`).
   * Used to avoid stacking duplicate archive chips on repeated attach.
   */
  readonly attachedFolderRef: string | null
  /**
   * Capture keys already pushed onto the composer rail for this batch.
   * Repeated attach skips these so the rail does not stack duplicate stills.
   */
  readonly attachedCaptureKeys: readonly string[]
}

/**
 * Create the Host store mirrored into chip and preview inject hooks.
 * @returns a store with an empty tray, a fresh {@link createBatchId} batch id, and no Session, message, or attached keys.
 */
export function createSessionUiStore(): SnapshotStore<DocScannerSessionUi> {
  return createSnapshotStore<DocScannerSessionUi>({
    captures: [],
    batchId: createBatchId(),
    archiveSessionId: null,
    working: false,
    message: null,
    attachedFolderRef: null,
    attachedCaptureKeys: [],
  })
}

/**
 * Stable id for one tray still across repeated attach clicks.
 * Prefers the archived workspace path; otherwise fingerprints wire bytes.
 * @param capture - one still from the tray.
 * @returns `path:<workspacePath>` when the still has a non-empty `workspacePath`; otherwise `bytes:<mimeType>:<name>:<dataBase64>`.
 */
export function captureAttachKey(capture: DocScannerCaptureResult): string {
  if (capture.workspacePath !== undefined && capture.workspacePath.length > 0) {
    return `path:${capture.workspacePath}`
  }
  return `bytes:${capture.mimeType}:${capture.name ?? ''}:${capture.dataBase64}`
}

/**
 * Decode capture wire bytes into a browser File for draft admission.
 * @param capture - one still from the tray.
 * @returns a File with the decoded bytes, the capture's MIME type, and its name (`capture.jpg` when unnamed).
 * @throws DOMException when `dataBase64` is not valid base64.
 */
export function base64ToFile(capture: DocScannerCaptureResult): File {
  const binary = atob(capture.dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], capture.name ?? 'capture.jpg', { type: capture.mimeType })
}
