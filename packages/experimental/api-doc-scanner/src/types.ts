/** Wire types for the document-scanner Remote. */
import type {
  DocScannerCaptureProfile,
  DocScannerCaptureResult,
  DocScannerColorMode,
  DocScannerConnectionPhase,
  DocScannerFrameRect,
  DocScannerPageProcessing,
  DocScannerPreviewFrameWire,
  DocScannerProviderId,
  DocScannerSnapshot,
} from '@deepseek-ai/dsh-doc-scanner'

export type {
  DocScannerCaptureProfile,
  DocScannerCaptureResult,
  DocScannerColorMode,
  DocScannerConnectionPhase,
  DocScannerFrameRect,
  DocScannerPageProcessing,
  DocScannerPreviewFrameWire,
  DocScannerProviderId,
  DocScannerSnapshot,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'doc-scanner/not-ready': { readonly reason: string }
    'doc-scanner/no-provider': { readonly reason: string }
    'doc-scanner/provider-unavailable': { readonly reason: string }
    'doc-scanner/duplicate-provider': { readonly reason: string }
    'doc-scanner/attach-failed': { readonly reason: string }
    'doc-scanner/failed': { readonly reason: string }
  }
}

/** Connect request; omit providerId when exactly one provider is registered. */
export interface DocScannerConnectRequest {
  readonly providerId?: DocScannerProviderId
}

/** Capture / still-stream request with optional Client batch folder. */
export interface DocScannerCaptureRequest {
  /** Client-owned batch id for `Captures/<batchId>/` archival. */
  readonly batchId?: string
  /**
   * Session whose workspace root receives the batch archive.
   * Omission archives under the Host process working directory.
   */
  readonly sessionId?: string
  /** Treatment shared with the live viewfinder. Omission keeps the Host profile. */
  readonly profile?: DocScannerCaptureProfile
}

/** Live profile update; does not reopen the device. */
export interface DocScannerProfileRequest {
  readonly profile: DocScannerCaptureProfile
}
