import type { HTMLAttributes } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconCloseOutlineRegular } from './icons/index.tsx'
import { menuPopupSelector } from './useModalLayer.ts'
import css from './ImageLightbox.module.css'

/**
 * Move keyboard focus among the lightbox controls.
 * An empty list does nothing. One control stays focused. Several controls cycle, and Shift reverses the direction.
 * @param buttons - close, previous, and next controls, with nulls for controls that are not rendered.
 * @param active - the element that currently has focus.
 * @param shift - true when Shift is held, moving to the previous control.
 */
export function focusLightboxControl(
  buttons: readonly (HTMLButtonElement | null)[],
  active: Element | null,
  shift: boolean,
): void {
  const present: HTMLButtonElement[] = []
  for (const button of buttons) {
    if (button !== null) present.push(button)
  }
  if (present.length === 0) return
  const current = active instanceof HTMLButtonElement ? present.indexOf(active) : -1
  const delta = shift ? -1 : 1
  const index = current < 0 ? 0 : (current + delta + present.length) % present.length
  // `index` is modulo the list length, so the entry exists.
  const target = present[index] as HTMLButtonElement
  target.focus()
}

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/** Previous and next controls for a multi-image preview. */
export interface ImageLightboxNavigation {
  /** Accessible label of the previous-image control. */
  previous: string
  /** Accessible label of the next-image control. */
  next: string
  /** Optional position caption, such as `2 / 5`, owned by the caller. */
  position?: string
  /**
   * Show the previous image.
   * @returns nothing.
   */
  onPrevious: () => void
  /**
   * Show the next image.
   * @returns nothing.
   */
  onNext: () => void
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.navigation - previous and next controls; omit for a single image.
 * @param props.contextMenuProps - optional original-image gesture bindings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, navigation, onClose, contextMenuProps }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  navigation?: ImageLightboxNavigation | undefined
  onClose: () => void
  contextMenuProps?: Pick<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onKeyDown' | 'tabIndex'> | undefined
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const previousRef = useRef<HTMLButtonElement | null>(null)
  const nextRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const navigationRef = useRef(navigation)
  navigationRef.current = navigation

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      // A portaled image menu owns Escape and Tab until it returns focus.
      if (event.defaultPrevented || document.activeElement?.closest(menuPopupSelector)) return
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'ArrowLeft') {
        const previous = navigationRef.current?.onPrevious
        if (previous === undefined) return
        event.preventDefault()
        event.stopPropagation()
        previous()
      }
      if (event.key === 'ArrowRight') {
        const next = navigationRef.current?.onNext
        if (next === undefined) return
        event.preventDefault()
        event.stopPropagation()
        next()
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        focusLightboxControl(
          [closeRef.current, previousRef.current, nextRef.current],
          document.activeElement,
          event.shiftKey,
        )
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      restoreRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div className={css.stage}>
        <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
        <img className={css.image} src={src} alt={alt} {...contextMenuProps} />
        {navigation === undefined ? null : (
          <>
            <button
              ref={previousRef}
              type="button"
              className={`${css.control} ${css.previous}`}
              aria-label={navigation.previous}
              onClick={navigation.onPrevious}
            >
              <IconChevronLeftOutlineRegular size={16} />
            </button>
            <button
              ref={nextRef}
              type="button"
              className={`${css.control} ${css.next}`}
              aria-label={navigation.next}
              onClick={navigation.onNext}
            >
              <IconChevronRightOutlineRegular size={16} />
            </button>
            {navigation.position === undefined ? null : <p className={css.position}>{navigation.position}</p>}
          </>
        )}
        <button ref={closeRef} type="button" className={`${css.control} ${css.close}`} aria-label={labels.close} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
