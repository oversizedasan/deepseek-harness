/** Browser entry for the optional document-scanner Remote contribution and composer control. */
import type { Context } from '@deepseek-ai/cordis'
import docScannerRemote from '@deepseek-ai/dsh-api-doc-scanner/remote'
import { mountDocScanner } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental document-scanner contribution.
 * @param ctx - Client runtime.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountDocScanner(ctx, docScannerRemote)
}
