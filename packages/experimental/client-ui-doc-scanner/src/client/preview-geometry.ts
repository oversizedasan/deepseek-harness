/** Map viewfinder pixels onto the letterboxed preview image. */
import type { DocScannerFrameRect } from '@deepseek-ai/dsh-api-doc-scanner/types'

/** Visible image rectangle inside a container that uses `object-fit: contain`. */
export interface ContainedFrameBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Four corners of a selection, in the same pixel space as the rectangle. */
export interface SelectionCorners {
  readonly left_top: { readonly x: number; readonly y: number }
  readonly right_top: { readonly x: number; readonly y: number }
  readonly right_down: { readonly x: number; readonly y: number }
  readonly left_down: { readonly x: number; readonly y: number }
}

/**
 * Visible image box after `object-fit: contain`.
 * @param containerWidth - element width in CSS pixels.
 * @param containerHeight - element height in CSS pixels.
 * @param frameWidth - frame width in pixels.
 * @param frameHeight - frame height in pixels.
 * @returns the letterboxed image box, or undefined when any size is not positive.
 */
export function containedFrameBox(
  containerWidth: number,
  containerHeight: number,
  frameWidth: number,
  frameHeight: number,
): ContainedFrameBox | undefined {
  if (containerWidth <= 0 || containerHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) return undefined
  const scale = Math.min(containerWidth / frameWidth, containerHeight / frameHeight)
  const width = frameWidth * scale
  const height = frameHeight * scale
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  }
}

/**
 * Map frame-pixel outline points onto the contained image as an SVG `points` string.
 * @param box - visible image box in CSS pixels.
 * @param frameWidth - frame width the points refer to.
 * @param frameHeight - frame height the points refer to.
 * @param points - points in frame pixels, in outline order.
 * @returns space-separated `x,y` pairs in CSS pixels.
 */
export function overlayPointList(
  box: ContainedFrameBox,
  frameWidth: number,
  frameHeight: number,
  points: readonly { readonly x: number; readonly y: number }[],
): string {
  const scaleX = box.width / frameWidth
  const scaleY = box.height / frameHeight
  return points.map(point => `${box.left + point.x * scaleX},${box.top + point.y * scaleY}`).join(' ')
}

/**
 * Place one frame-pixel rectangle onto the contained image box.
 * @param box - visible image box in CSS pixels.
 * @param frameWidth - frame width the rectangle refers to.
 * @param frameHeight - frame height the rectangle refers to.
 * @param rect - rectangle in frame pixels.
 * @returns the rectangle in CSS pixels.
 */
export function overlayRect(
  box: ContainedFrameBox,
  frameWidth: number,
  frameHeight: number,
  rect: DocScannerFrameRect,
): ContainedFrameBox {
  const scaleX = box.width / frameWidth
  const scaleY = box.height / frameHeight
  return {
    left: box.left + rect.x * scaleX,
    top: box.top + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  }
}

/**
 * Convert a drag inside the contained image into a frame-pixel rectangle.
 * @param frameWidth - frame width in pixels.
 * @param frameHeight - frame height in pixels.
 * @param box - visible image box in CSS pixels.
 * @param x0 - drag start, CSS pixels relative to `box`.
 * @param y0 - drag start, CSS pixels relative to `box`.
 * @param x1 - drag end, CSS pixels relative to `box`.
 * @param y1 - drag end, CSS pixels relative to `box`.
 * @returns a rectangle clamped to the frame. A 1×1 origin rectangle when the box cannot be mapped.
 */
export function frameRectFromDrag(
  frameWidth: number,
  frameHeight: number,
  box: ContainedFrameBox,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): DocScannerFrameRect {
  if (box.width <= 0 || box.height <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 }
  }
  const scaleX = frameWidth / box.width
  const scaleY = frameHeight / box.height
  const ax = clamp(x0 * scaleX, 0, frameWidth)
  const ay = clamp(y0 * scaleY, 0, frameHeight)
  const bx = clamp(x1 * scaleX, 0, frameWidth)
  const by = clamp(y1 * scaleY, 0, frameHeight)
  const x = Math.min(ax, bx)
  const y = Math.min(ay, by)
  const width = Math.min(Math.max(1, Math.abs(ax - bx)), frameWidth - x)
  const height = Math.min(Math.max(1, Math.abs(ay - by)), frameHeight - y)
  return { x, y, width, height }
}

/**
 * Four corners of an axis-aligned selection, clockwise from the top left.
 * @param rect - selection in frame pixels.
 * @returns `left_top`, `right_top`, `right_down`, and `left_down`.
 */
export function selectionCorners(rect: DocScannerFrameRect): SelectionCorners {
  return {
    left_top: { x: rect.x, y: rect.y },
    right_top: { x: rect.x + rect.width, y: rect.y },
    right_down: { x: rect.x + rect.width, y: rect.y + rect.height },
    left_down: { x: rect.x, y: rect.y + rect.height },
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
