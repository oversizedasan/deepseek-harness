/** Provider-neutral document scanner connection and capture vocabulary. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'

/** Configured identity of one document-scanner provider. */
export type DocScannerProviderId = Branded<'DocScannerProviderId'>

/** Public provider facts; credentials and filesystem paths are excluded. */
export interface DocScannerProviderInfo {
  readonly id: DocScannerProviderId
  readonly name: string
  readonly kind: 'mock' | 'czur' | 'other'
}

/**
 * Process-local connection state shared by Mock and hardware providers.
 * This is not a Session event; only captured images may later enter durable history.
 */
export type DocScannerConnectionPhase =
  | 'disconnected'
  | 'connecting'
  | 'device_missing'
  | 'opening'
  | 'ready'
  | 'capturing'
  | 'error'

/** One connection observation for UI and Remote consumers. */
export interface DocScannerConnectionState {
  readonly phase: DocScannerConnectionPhase
  readonly providerId?: DocScannerProviderId
  readonly deviceId?: string
  readonly displayName?: string
  readonly message?: string
}

/** Provider roster plus the active connection observation. */
export interface DocScannerSnapshot {
  readonly providers: readonly DocScannerProviderInfo[]
  readonly connection: DocScannerConnectionState
  readonly activeProviderId?: DocScannerProviderId
}

/** Bytes and metadata returned before optional attachment persistence. */
export interface DocScannerImageBytes {
  readonly data: Uint8Array
  readonly mimeType: 'image/jpeg' | 'image/png'
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** Capture outcome after optional `ctx.attachments` persistence. */
export interface DocScannerCaptureResult {
  readonly mimeType: 'image/jpeg' | 'image/png'
  readonly width: number
  readonly height: number
  readonly name?: string
  /** Present when `ctx.attachments` saved the image. */
  readonly attachmentId?: AttachmentId
  /** Canonical base64 of the captured bytes for immediate Client preview. */
  readonly dataBase64: string
  /**
   * Workspace-relative path under `Captures/<batchId>/` when Host archived the still.
   * Absent when disk archival was skipped.
   */
  readonly workspacePath?: string
}

/** Options for one still capture or Host batch archival. */
export interface DocScannerCaptureOptions {
  /**
   * Client-owned batch folder name under `Captures/`.
   * Prefer a local-time stamp (`YYYY-MM-DD_HHmmss`) so Files listings stay scannable.
   */
  readonly batchId?: string
  /**
   * Session whose workspace root receives `Captures/<batchId>/`.
   * Omission archives under `process.cwd()` (tests / no-session fallback).
   */
  readonly sessionId?: string
}

/**
 * One live viewfinder frame for the Client preview pane.
 * Separate from {@link DocScannerSnapshot}; frames never enter Session history by themselves.
 */
export interface DocScannerPreviewFrame {
  readonly data: Uint8Array
  readonly mimeType: 'image/jpeg' | 'image/png'
  readonly width: number
  readonly height: number
  /** Host monotonic timestamp in milliseconds when the frame was produced. */
  readonly ts?: number
}

/** Wire-safe preview frame after base64 encoding for Typert streams. */
export interface DocScannerPreviewFrameWire {
  readonly dataBase64: string
  readonly mimeType: 'image/jpeg' | 'image/png'
  readonly width: number
  readonly height: number
  readonly ts?: number
}

/** One hardware or mock backend owned by a contributing fiber. */
export interface DocScannerProvider {
  readonly info: DocScannerProviderInfo
  /**
   * Open or reconnect the preferred device until ready, device_missing, or error.
   * @param signal - caller cancellation.
   */
  connect(signal: AbortSignal): Promise<void>
  /**
   * Capture one still image while the provider reports ready.
   * @param signal - caller cancellation.
   */
  capture(signal: AbortSignal): Promise<DocScannerImageBytes>
  /**
   * Stream viewfinder frames while the provider is ready or capturing.
   * Ends when the signal aborts or the device leaves a previewable phase.
   * @param signal - caller cancellation.
   */
  preview(signal: AbortSignal): AsyncIterable<DocScannerPreviewFrame>
  /** Release the device and return to disconnected or device_missing. */
  close(): Promise<void>
  /** Read the provider-owned connection observation. */
  snapshot(): DocScannerConnectionState
  /**
   * Observe connection changes; the disposer removes the listener.
   * @param listener - called after each state change.
   */
  subscribe(listener: () => void): () => void
  /**
   * Optional push path for hardware stills (hardgrab / auto-capture).
   * When present, the registry forwards each image through `DocScanner.followStills`.
   * @param listener - called with raw still bytes before Host persistence.
   */
  subscribeStills?(listener: (image: DocScannerImageBytes) => void): () => void
}
