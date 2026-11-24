/** Connection-phase copy and StateDot mapping for scanner surfaces. */
import type { DocScannerConnectionPhase } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocScannerKey } from './locales.ts'

/** Dictionary key naming each connection phase; the record type keeps it exhaustive. */
const PHASE_LABEL_KEY: Record<DocScannerConnectionPhase, DocScannerKey> = {
  connecting: 'statusConnecting',
  device_missing: 'statusDeviceMissing',
  opening: 'statusOpening',
  ready: 'statusReady',
  capturing: 'statusCapturing',
  error: 'statusError',
  disconnected: 'statusDisconnected',
}

/**
 * Localized phase label, preferring a transport or action message when set.
 * @param phase - connection phase from the readiness mirror.
 * @param t - doc-scanner translator.
 * @param transportError - readiness stream failure, if any.
 * @param message - last local action failure, if any.
 * @returns `message` when non-empty; else the `transportError` copy when a transport error is set;
 *   else the copy for `phase` (`disconnected` when undefined).
 */
export function phaseLabel(
  phase: DocScannerConnectionPhase | undefined,
  t: (key: DocScannerKey) => string,
  transportError: string | null,
  message: string | null,
): string {
  if (message) return message
  if (transportError) return t('transportError')
  return t(PHASE_LABEL_KEY[phase ?? 'disconnected'])
}

/**
 * Map connection phase to a compact status glyph.
 * @param phase - connection phase from the readiness mirror.
 * @param transportError - readiness stream failure, if any.
 * @param actionMessage - last local action failure shown beside status, if any.
 * @returns `error` when either message is set; otherwise `done` for `ready`,
 *   `ongoing` for `connecting`/`opening`/`capturing`, `warning` for `error`/`device_missing`,
 *   and `idle` for the rest.
 */
export function phaseDot(
  phase: DocScannerConnectionPhase | undefined,
  transportError: string | null,
  actionMessage: string | null = null,
): StateDotState {
  if (transportError !== null || actionMessage !== null) return 'error'
  switch (phase) {
    case 'ready': return 'done'
    case 'connecting':
    case 'opening':
    case 'capturing':
      return 'ongoing'
    case 'error':
    case 'device_missing':
      return 'warning'
    default:
      return 'idle'
  }
}
