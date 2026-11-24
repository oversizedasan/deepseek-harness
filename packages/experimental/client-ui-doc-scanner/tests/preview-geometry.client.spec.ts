/** Viewfinder letterboxing and selection corners. */
import { describe, expect, it } from 'vitest'
import { containedFrameBox, frameRectFromDrag, overlayPointList, overlayRect, selectionCorners } from '../src/client/preview-geometry.ts'

describe('preview geometry', () => {
  it('centers a square frame in a wide viewfinder and places a detection box on that image', () => {
    expect(containedFrameBox(200, 100, 100, 100)).toEqual({ left: 50, top: 0, width: 100, height: 100 })
    expect(overlayRect({ left: 50, top: 0, width: 100, height: 100 }, 100, 100, { x: 10, y: 20, width: 30, height: 40 })).toEqual({
      left: 60,
      top: 20,
      width: 30,
      height: 40,
    })
    expect(overlayPointList({ left: 50, top: 0, width: 100, height: 100 }, 100, 100, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ])).toBe('50,0 60,0 60,6 50,6')
  })

  it('returns no box when a size is missing and a 1×1 drag when the box cannot be mapped', () => {
    expect(containedFrameBox(0, 100, 10, 10)).toBeUndefined()
    expect(frameRectFromDrag(0, 10, { left: 0, top: 0, width: 10, height: 10 }, 0, 0, 1, 1)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('turns a drag into four frame-pixel corners', () => {
    const box = { left: 0, top: 0, width: 100, height: 50 }
    const rect = frameRectFromDrag(200, 100, box, 10, 5, 40, 20)
    expect(rect).toEqual({ x: 20, y: 10, width: 60, height: 30 })
    expect(frameRectFromDrag(200, 100, box, -20, -10, 400, 200)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    expect(selectionCorners({ x: 20, y: 10, width: 60, height: 30 })).toEqual({
      left_top: { x: 20, y: 10 },
      right_top: { x: 80, y: 10 },
      right_down: { x: 80, y: 40 },
      left_down: { x: 20, y: 40 },
    })
  })
})
