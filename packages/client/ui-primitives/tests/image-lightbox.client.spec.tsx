// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { focusLightboxControl, ImageLightbox } from '../src/ImageLightbox.tsx'
import { Menu } from '../src/Menu.tsx'

afterEach(cleanup)

const labels = { dialog: '原图预览', close: '关闭原图预览' }

describe('ImageLightbox', () => {
  it('focuses its close control, closes by button and Escape, and restores focus', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    const close = view.getByRole('button', { name: '关闭原图预览' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
    expect(onClose).not.toHaveBeenCalled()
    const outerKey = vi.fn()
    document.body.addEventListener('keydown', outerKey)
    try {
      fireEvent.keyDown(close, { key: 'Escape' })
      expect(outerKey).not.toHaveBeenCalled()
    } finally { document.body.removeEventListener('keydown', outerKey) }
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('tolerates a focus owner it cannot restore (no active element at mount)', () => {
    // jsdom always reports body as the fallback active element; stub the
    // element-less state a detached focus can leave.
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={vi.fn()} />)
      view.unmount()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
  })

  it('switches images from the controls, the arrow keys, and Tab', () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    const view = render(
      <ImageLightbox
        src="blob:second"
        alt="第二张"
        labels={labels}
        navigation={{ previous: '上一张', next: '下一张', position: '2 / 3', onPrevious, onNext }}
        onClose={vi.fn()}
      />,
    )
    expect(view.getByText('2 / 3')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '下一张' }))
    fireEvent.click(view.getByRole('button', { name: '上一张' }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onNext).toHaveBeenCalledTimes(2)
    expect(onPrevious).toHaveBeenCalledTimes(2)
    const close = view.getByRole('button', { name: '关闭原图预览' })
    const previous = view.getByRole('button', { name: '上一张' })
    const next = view.getByRole('button', { name: '下一张' })
    close.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(previous)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(next)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(previous)
    const outside = document.createElement('div')
    outside.tabIndex = 0
    document.body.append(outside)
    outside.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    outside.remove()
    expect(document.activeElement).toBe(close)
  })

  it('omits the position caption when navigation does not supply one', () => {
    const view = render(
      <ImageLightbox
        src="blob:second"
        alt="第二张"
        labels={labels}
        navigation={{ previous: '上一张', next: '下一张', onPrevious: vi.fn(), onNext: vi.fn() }}
        onClose={vi.fn()}
      />,
    )
    expect(view.queryByText('2 / 3')).toBeNull()
    expect(view.getByRole('button', { name: '下一张' })).toBeTruthy()
  })

  it('closes on a mask press but not on a press over the image', () => {
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    fireEvent.mouseDown(view.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()
    const mask = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.mouseDown(mask)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('focusLightboxControl', () => {
  function button(): { node: HTMLButtonElement; focused: ReturnType<typeof vi.fn> } {
    const node = document.createElement('button')
    const focused = vi.fn()
    node.focus = focused
    return { node, focused }
  }

  it('does nothing for an empty list and focuses the only control', () => {
    focusLightboxControl([null, null], null, false)
    const only = button()
    focusLightboxControl([only.node], null, false)
    focusLightboxControl([only.node], only.node, true)
    expect(only.focused).toHaveBeenCalledTimes(2)
  })

  it('cycles forward and backward, and starts at the first control when focus is elsewhere', () => {
    const close = button()
    const previous = button()
    const next = button()
    const outside = document.createElement('div')
    focusLightboxControl([close.node, previous.node, next.node], close.node, false)
    expect(previous.focused).toHaveBeenCalledOnce()
    focusLightboxControl([close.node, previous.node, next.node], close.node, true)
    expect(next.focused).toHaveBeenCalledOnce()
    focusLightboxControl([close.node, previous.node, next.node], outside, false)
    expect(close.focused).toHaveBeenCalledOnce()
    const stranger = button()
    focusLightboxControl([close.node, previous.node, next.node], stranger.node, false)
    expect(close.focused).toHaveBeenCalledTimes(2)
  })
})

it('leaves Escape to an open context menu before closing the image', () => {
  const onClose = vi.fn()
  const view = render(<ImageLightbox src="blob:original" alt="Image" labels={labels} onClose={onClose} />)
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.tabIndex = 0
  document.body.append(menu)
  menu.focus()
  try {
    fireEvent.keyDown(view.getByRole('button'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  } finally { menu.remove() }
  fireEvent.keyDown(view.getByRole('button'), { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

it('leaves Tab and Escape to the search controls in a portaled image menu', () => {
  const onClose = vi.fn()
  function Preview() {
    const [point, setPoint] = useState<{ x: number; y: number }>()
    return <>
      <ImageLightbox src="blob:original" alt="Image" labels={labels} onClose={onClose}
        contextMenuProps={{ tabIndex: 0, onContextMenu: (event) => {
          event.preventDefault()
          setPoint({ x: event.clientX, y: event.clientY })
        } }} />
      <Menu open={point !== undefined} anchor={null} anchorPoint={point} portal contextual
        search={{ label: 'Search actions', clearLabel: 'Clear search', value: '', onChange: () => {} }}
        items={[{ id: 'copy', label: 'Copy image' }]} onClose={() => { setPoint(undefined) }} />
    </>
  }
  const view = render(<Preview />)
  const image = view.getByRole('img')
  image.focus()
  fireEvent.contextMenu(image)
  const search = view.getByRole('searchbox', { name: 'Search actions' })
  const clear = view.getByRole('button', { name: 'Clear search' })
  expect(document.activeElement).toBe(search)
  expect(fireEvent.keyDown(search, { key: 'Tab' })).toBe(true)
  clear.focus()
  fireEvent.keyDown(clear, { key: 'Tab' })
  expect(document.activeElement).toBe(view.getByRole('menuitem', { name: 'Copy image' }))
  clear.focus()
  fireEvent.keyDown(clear, { key: 'Escape' })
  expect(view.queryByRole('searchbox')).toBeNull()
  expect(document.activeElement).toBe(image)
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.keyDown(image, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})
