/** Helpers shared by {@link DocScannerProvider} implementations. */
import type { DocScannerConnectionState } from './types.ts'

/**
 * Whether a provider can stream viewfinder frames in `phase`.
 * @param phase - provider connection phase.
 * @returns `true` for `ready` and `capturing`.
 */
export function isPreviewPhase(phase: DocScannerConnectionState['phase']): boolean {
  return phase === 'ready' || phase === 'capturing'
}

/**
 * Wait `ms` milliseconds unless `signal` aborts first.
 * @param ms - delay in milliseconds.
 * @param signal - cancellation; the promise rejects with the abort reason when it is an `Error`, otherwise with `Error('Aborted')`.
 * @returns resolves after the delay.
 */
export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
    }
    if (signal.aborted) {
      clearTimeout(timer)
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Observable {@link DocScannerConnectionState} holder that provider implementations extend. */
export class ConnectionStateStore {
  /** Current connection state; change it only through {@link setState}. */
  protected state: DocScannerConnectionState = { phase: 'disconnected' }
  private readonly listeners = new Set<() => void>()

  /**
   * Replace the state and notify every subscriber synchronously.
   * @param next - the new connection state.
   */
  protected setState(next: DocScannerConnectionState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /**
   * Read the current connection state.
   * @returns the state most recently passed to {@link setState}, initially `disconnected`.
   */
  snapshot(): DocScannerConnectionState {
    return this.state
  }

  /**
   * Observe state changes.
   * @param listener - called after each {@link setState}.
   * @returns idempotent unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
