/** Structured failures for the document-scanner seam. */
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Document-scanner failure with a stable machine-routable code. */
export class DocScannerError extends HarnessError {}
