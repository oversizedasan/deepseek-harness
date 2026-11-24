/** Right-sidebar document-camera viewfinder with overlay shutter and batch strip. */
import { useEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DocScannerCaptureProfile,
  DocScannerCaptureResult,
  DocScannerSnapshot,
} from '@deepseek-ai/dsh-api-doc-scanner/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, ImageLightbox, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocScannerPreviewFeed } from './preview-feed.ts'
import type { DocScannerReadiness } from './readiness.ts'
import type { DocScannerSessionUi } from './session-ui.ts'
import { DOC_SCANNER_MAX_IMAGES_PER_MESSAGE } from './batch-limit.ts'
import { containedFrameBox, overlayPointList, overlayRect, type ContainedFrameBox } from './preview-geometry.ts'
import { phaseDot, phaseLabel } from './status.ts'
import { NS } from './locales.ts'
import css from './DocScannerPreviewBody.module.css'

/** Host calls injected without exposing Cordis to React. */
export interface DocScannerPreviewActions {
  connect: (signal: AbortSignal) => Promise<void>
  capture: (signal: AbortSignal) => Promise<RemoteResult<DocScannerCaptureResult>>
  /**
   * Store the shared capture profile and push it to a running preview.
   * @param profile - page treatment, color treatment, and optional selection.
   */
  setCaptureProfile: (profile: DocScannerCaptureProfile) => Promise<void>
  close: () => Promise<void>
  openPreview: (sessionId: SessionId) => void
  /** Remove one still from the current batch by index. */
  removeCapture: (index: number) => void
  /** Drop all stills and start a new batch id. */
  clearBatch: () => void
  /**
   * Open the latest archived still (or batch folder) in the files sidebar.
   * @param sessionId - current Session.
   */
  openBatchInFiles: (sessionId: SessionId) => void
  /**
   * Remember which Session owns batch archival for capture / followStills.
   * @param sessionId - current Session shown in this tab.
   */
  bindArchiveSession: (sessionId: SessionId) => void
  /**
   * Run a scanner action while updating the shared session-ui working flag.
   * @param action - async work to perform.
   */
  run: (action: () => Promise<void>) => Promise<void>
}

/** Entry-injected Host observables and actions for the preview pane. */
export interface DocScannerPreviewInjected extends DocScannerPreviewActions {
  hooks: {
    docScannerReadiness: HostObservable<DocScannerReadiness>
    docScannerPreview: HostObservable<DocScannerPreviewFeed>
    docScannerSessionUi: HostObservable<DocScannerSessionUi>
  }
}

export type DocScannerPreviewBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>
  & InjectFace<DocScannerPreviewInjected>

/**
 * Move a lightbox index within a batch, wrapping at either end.
 * @param current - open index, or null when the lightbox is closed.
 * @param count - number of stills in the batch.
 * @param delta - `-1` for the previous still, `1` for the next.
 * @returns the next index, or null when nothing is open or the batch is empty.
 */
export function stepLightboxIndex(current: number | null, count: number, delta: number): number | null {
  if (current === null || count === 0) return null
  return (current + delta + count) % count
}

/** Camera-only pane: overlay shutter on the live view and a thin batch strip. */
export function DocScannerPreviewBody({
  sessionId,
  connect,
  capture,
  close,
  openPreview,
  removeCapture,
  clearBatch,
  openBatchInFiles,
  bindArchiveSession,
  run,
  useDocScannerReadiness,
  useDocScannerPreview,
  useDocScannerSessionUi,
  t,
}: DocScannerPreviewBodyProps) {
  const readiness = useDocScannerReadiness(value => value)
  const feed = useDocScannerPreview(value => value)
  const sessionUi = useDocScannerSessionUi(value => value)
  useEffect(() => {
    bindArchiveSession(sessionId)
  }, [bindArchiveSession, sessionId])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [imageBox, setImageBox] = useState<ContainedFrameBox | undefined>()
  const frameRef = useRef<HTMLImageElement>(null)
  const snapshot: DocScannerSnapshot | null = readiness.snapshot
  const phase = snapshot?.connection.phase
  const ready = readiness.connected && phase === 'ready'
  const busy = phase === 'connecting' || phase === 'opening' || phase === 'capturing'
  const working = sessionUi.working
  const captures = sessionUi.captures
  const openIndex = lightboxIndex
  const openCapture = openIndex === null ? undefined : captures[openIndex]
  useEffect(() => {
    if (lightboxIndex === null) return
    if (captures.length === 0) {
      setLightboxIndex(null)
      return
    }
    if (lightboxIndex >= captures.length) setLightboxIndex(captures.length - 1)
  }, [captures.length, lightboxIndex])
  const hasBatch = captures.length > 0
  const atLimit = captures.length >= DOC_SCANNER_MAX_IMAGES_PER_MESSAGE
  const previewReady = phase === 'ready' || phase === 'capturing'
  const disconnected = phase === 'disconnected' || phase === undefined
  const phaseText = phaseLabel(phase, t, readiness.error, sessionUi.message)

  let status = t('previewWaiting')
  if (readiness.error) status = readiness.error
  else if (feed.error) status = feed.error
  else if (!previewReady) status = t('previewNotReady')
  else if (feed.streaming && feed.src === null) status = t('previewStarting')

  useEffect(() => {
    const node = frameRef.current
    if (node === null || !(feed.frameWidth > 0) || !(feed.frameHeight > 0)) {
      setImageBox(undefined)
      return
    }
    const measure = (): void => {
      setImageBox(containedFrameBox(node.clientWidth, node.clientHeight, feed.frameWidth, feed.frameHeight))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [feed.frameHeight, feed.frameWidth, feed.src])

  const { rects, frameWidth, frameHeight } = feed
  const marks = imageBox === undefined
    ? []
    : rects.map((rect) => {
      const corners = rect.corners
      return {
        box: overlayRect(imageBox, frameWidth, frameHeight, rect),
        points: corners === undefined
          ? undefined
          : overlayPointList(imageBox, frameWidth, frameHeight, [
            corners.leftTop,
            corners.rightTop,
            corners.rightDown,
            corners.leftDown,
          ]),
      }
    })
  const detectionBoxes = marks.map(mark => mark.box)

  const primaryLabel = ready
    ? atLimit
      ? t('batchAtLimit', { max: DOC_SCANNER_MAX_IMAGES_PER_MESSAGE })
      : t('capture')
    : working
      ? t('busy')
      : t('connect')

  return (
    <div className={css.pane}>
      <div className={css.viewfinder}>
        {feed.src !== null
          ? <img ref={frameRef} className={css.frame} src={feed.src} alt={t('previewLiveAlt')} />
          : <p className={css.status}>{status}</p>}
        {marks.map((mark, index) => mark.points !== undefined
          ? (
            <svg
              key={`detect-${String(index)}`}
              className={css.detectOverlay}
              data-testid="detect-polygon"
            >
              <polygon points={mark.points} />
            </svg>
          )
          : (
            <span
              key={`detect-${String(index)}`}
              className={css.detectBox}
              data-testid="detect-box"
              style={{ left: mark.box.left, top: mark.box.top, width: mark.box.width, height: mark.box.height }}
            />
          ))}
        {rects.length > 0 ? (
          <span
            className={css.detectPill}
            style={detectionBoxes[0] === undefined
              ? { left: 8, top: 40 }
              : { left: detectionBoxes[0].left, top: Math.max(8, detectionBoxes[0].top - 22) }}
          >
            {t('detectSuccess')}
          </span>
        ) : null}
        <div className={css.overlayTop}>
          <span className={css.phase}>
            <StateDot state={phaseDot(phase, readiness.error, sessionUi.message)} />
            <span className={css.phaseLabel}>{phaseText}</span>
          </span>
          <Tooltip label={t('czurHint')} side="bottom" delayMs={400} portal>
            <span className={css.hintBtn} title={t('czurHint')} aria-label={t('czurHint')}>?</span>
          </Tooltip>
        </div>

        {!disconnected ? (
          <div className={css.overlayCorner}>
            <Button
              variant="outline"
              disabled={working}
              onClick={() => {
                void run(async () => {
                  await close()
                })
              }}
            >
              {t('close')}
            </Button>
          </div>
        ) : null}

        <div className={css.overlayBottom}>
          {hasBatch ? (
            <div className={css.batchStrip}>
              <div className={css.batchHeader}>
                <span className={css.batchLabel}>{t('batchCount', { count: captures.length })}</span>
                <div className={css.batchActions}>
                  <button
                    type="button"
                    className={css.clearLink}
                    disabled={working}
                    onClick={() => {
                      void run(() => {
                        openBatchInFiles(sessionId)
                        return Promise.resolve()
                      })
                    }}
                  >
                    {t('openBatchInFiles')}
                  </button>
                  <button
                    type="button"
                    className={css.clearLink}
                    disabled={working}
                    onClick={() => { clearBatch() }}
                  >
                    {t('clearBatch')}
                  </button>
                </div>
              </div>
              <ul className={css.thumbs}>
                {captures.map((item, index) => {
                  const src = `data:${item.mimeType};base64,${item.dataBase64}`
                  return (
                    <li key={`${item.name ?? 'still'}-${String(index)}`} className={css.thumbItem}>
                      <button
                        type="button"
                        className={css.thumbOpen}
                        aria-label={t('openCapture')}
                        onClick={() => { setLightboxIndex(index) }}
                      >
                        <img className={css.thumb} src={src} alt={t('previewAlt')} />
                      </button>
                      <button
                        type="button"
                        className={css.thumbRemove}
                        aria-label={t('removeCapture')}
                        disabled={working}
                        onClick={() => { removeCapture(index) }}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          <div className={css.shutterRow}>
            <Button
              variant="primary"
              disabled={working || busy || (ready && atLimit)}
              onClick={() => {
                void run(async () => {
                  if (ready) {
                    const result = await capture(AbortSignal.timeout(30_000))
                    if (!result.ok) throw result.error
                    return
                  }
                  await connect(AbortSignal.timeout(60_000))
                  openPreview(sessionId)
                })
              }}
            >
              {primaryLabel}
            </Button>
          </div>
        </div>

        {feed.src !== null && feed.error !== null ? <p className={css.banner}>{feed.error}</p> : null}
        {sessionUi.message !== null ? <p className={css.banner}>{sessionUi.message}</p> : null}
      </div>
      {openIndex !== null && openCapture !== undefined ? (
        <ImageLightbox
          src={`data:${openCapture.mimeType};base64,${openCapture.dataBase64}`}
          alt={openCapture.name ?? t('previewAlt')}
          labels={{ dialog: t('lightboxDialog'), close: t('lightboxClose') }}
          navigation={captures.length > 1 ? {
            previous: t('lightboxPrevious'),
            next: t('lightboxNext'),
            position: t('lightboxPosition', { current: openIndex + 1, total: captures.length }),
            onPrevious: () => { setLightboxIndex(current => stepLightboxIndex(current, captures.length, -1)) },
            onNext: () => { setLightboxIndex(current => stepLightboxIndex(current, captures.length, 1)) },
          } : undefined}
          onClose={() => { setLightboxIndex(null) }}
        />
      ) : null}
    </div>
  )
}
