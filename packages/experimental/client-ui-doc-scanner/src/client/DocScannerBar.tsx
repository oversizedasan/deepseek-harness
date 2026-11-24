/** Compact composer status chip: opens the camera, or attaches the batch when N≥1. */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocScannerSnapshot } from '@deepseek-ai/dsh-api-doc-scanner/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocScannerReadiness } from './readiness.ts'
import type { DocScannerSessionUi } from './session-ui.ts'
import { phaseDot, phaseLabel } from './status.ts'
import { NS } from './locales.ts'
import css from './DocScannerBar.module.css'

/** Host calls injected without exposing Cordis to React. */
export interface DocScannerBarActions {
  openPreview: (sessionId: SessionId) => void
  /**
   * Attach the current batch without prefill and focus the composer.
   * @param sessionId - current Session.
   */
  attachBatchToDraft: (sessionId: SessionId) => void
  /**
   * Restore rail previews from a persisted `@Captures/<batchId>/` draft chip after reload.
   * @param sessionId - current Session.
   * @returns `pending-draft` while the folder chip is not yet in the draft projection.
   */
  rehydrateArchiveAttachments: (sessionId: SessionId) => Promise<
    'restored' | 'ready' | 'pending-draft' | 'unavailable'
  >
  /**
   * Run a scanner action while updating the shared session-ui working flag.
   * @param action - async work to perform.
   */
  run: (action: () => Promise<void>) => Promise<void>
}

/** Entry-injected Host readiness and session UI. */
export interface DocScannerBarInjected extends DocScannerBarActions {
  hooks: {
    docScannerReadiness: HostObservable<DocScannerReadiness>
    docScannerSessionUi: HostObservable<DocScannerSessionUi>
  }
}

export type DocScannerBarProps =
  & Pick<PropsRuntime<'conversation.input.right'>, 'sessionId'>
  & PropsLocale<typeof NS>
  & InjectFace<DocScannerBarInjected>

/** Compact scanner status chip beside the composer submit controls. */
export function DocScannerBar({
  sessionId,
  openPreview,
  attachBatchToDraft,
  rehydrateArchiveAttachments,
  run,
  useDocScannerReadiness,
  useDocScannerSessionUi,
  t,
}: DocScannerBarProps) {
  useEffect(() => {
    let cancelled = false
    const wait = (ms: number): Promise<void> => new Promise((resolve) => {
      window.setTimeout(resolve, ms)
    })
    void (async () => {
      // Draft restore can land after the first paint; retry while the folder chip is still pending.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the effect cleanup flips this while the rehydrate await is pending
      for (let attempt = 0; attempt < 40 && !cancelled; attempt += 1) {
        const result = await rehydrateArchiveAttachments(sessionId)
        if (result !== 'pending-draft') return
        await wait(50)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, rehydrateArchiveAttachments])
  const readiness = useDocScannerReadiness(value => value)
  const sessionUi = useDocScannerSessionUi(value => value)
  const snapshot: DocScannerSnapshot | null = readiness.snapshot
  const phase = snapshot?.connection.phase
  const count = sessionUi.captures.length
  const hasBatch = count > 0
  const label = hasBatch
    ? t('chipBatch', { count })
    : phaseLabel(phase, t, readiness.error, sessionUi.message)
  const working = sessionUi.working
  const dot = <StateDot state={phaseDot(phase, readiness.error, hasBatch ? null : sessionUi.message)} />

  if (hasBatch) {
    return (
      <div className={css.chip}>
        <Tooltip label={t('chipOpenWhileBatch')} side="top" delayMs={500} portal>
          <button
            type="button"
            className={css.dotHit}
            aria-label={t('chipOpenWhileBatch')}
            disabled={working}
            onClick={() => {
              openPreview(sessionId)
            }}
          >
            {dot}
          </button>
        </Tooltip>
        <Tooltip label={label} side="top" delayMs={500} portal>
          <button
            type="button"
            className={css.labelHit}
            aria-label={label}
            disabled={working}
            onClick={() => {
              void run(() => {
                attachBatchToDraft(sessionId)
                return Promise.resolve()
              })
            }}
          >
            <span className={css.label}>{label}</span>
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <Tooltip label={t('chipOpen')} side="top" delayMs={500} portal>
      <button
        type="button"
        className={css.chip}
        aria-label={t('chipOpen')}
        disabled={working}
        onClick={() => {
          openPreview(sessionId)
        }}
      >
        {dot}
        <span className={css.label}>{label}</span>
      </button>
    </Tooltip>
  )
}
