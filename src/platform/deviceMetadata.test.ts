import { describe, expect, it } from 'vitest'
import { batteryPercent } from './deviceMetadata'

describe('TAK device telemetry', () => {
  it.each([
    [undefined, null],
    [Number.NaN, null],
    [-0.2, 0],
    [0, 0],
    [0.734, 73],
    [1, 100],
    [1.3, 100],
  ])('normalizes battery level %s to %s percent', (level, expected) => {
    expect(batteryPercent(level)).toBe(expected)
  })
})
