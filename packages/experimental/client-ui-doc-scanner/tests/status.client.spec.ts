/** Phase copy and status-dot mapping for scanner surfaces. */
import { describe, expect, it } from 'vitest'
import type { DocScannerConnectionPhase } from '@deepseek-ai/dsh-api-doc-scanner/types'
import { phaseDot, phaseLabel } from '../src/client/status.ts'
import { translate } from './fixtures.client.ts'

const PHASES: readonly [DocScannerConnectionPhase | undefined, string][] = [
  ['connecting', 'Connecting document camera…'],
  ['device_missing', 'No document camera detected'],
  ['opening', 'Opening document camera…'],
  ['ready', 'Document camera connected'],
  ['capturing', 'Document camera capturing…'],
  ['error', 'Document camera connection error'],
  ['disconnected', 'Document camera disconnected'],
  [undefined, 'Document camera disconnected'],
]

describe('phaseLabel', () => {
  it.each(PHASES)('names phase %s', (phase, expected) => {
    expect(phaseLabel(phase, translate, null, null)).toBe(expected)
  })

  it('prefers the action message, then the transport error, over the phase', () => {
    expect(phaseLabel('ready', translate, 'down', 'capture failed')).toBe('capture failed')
    expect(phaseLabel('ready', translate, 'down', null)).toBe(translate('transportError'))
  })
})

describe('phaseDot', () => {
  it.each([
    ['ready', 'done'],
    ['connecting', 'ongoing'],
    ['opening', 'ongoing'],
    ['capturing', 'ongoing'],
    ['error', 'warning'],
    ['device_missing', 'warning'],
    ['disconnected', 'idle'],
    [undefined, 'idle'],
  ] as const)('maps %s to %s', (phase, dot) => {
    expect(phaseDot(phase, null)).toBe(dot)
  })

  it('reports an error for a transport failure or an action message', () => {
    expect(phaseDot('ready', 'down')).toBe('error')
    expect(phaseDot('ready', null, 'capture failed')).toBe('error')
    expect(phaseDot('ready', null, null)).toBe('done')
  })
})
