import { describe, expect, it, vi } from 'vitest'
import {
  batteryPercent,
  createDeviceModelProvider,
} from './deviceMetadata'

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

describe('media device provenance', () => {
  it('records a trimmed model only on native devices', async () => {
    const getInfo = vi.fn(async () => ({ model: '  Pixel 10 Pro  ' }))

    await expect(
      createDeviceModelProvider(() => true, getInfo)(),
    ).resolves.toBe('Pixel 10 Pro')
    expect(getInfo).toHaveBeenCalledOnce()

    getInfo.mockClear()
    await expect(
      createDeviceModelProvider(() => false, getInfo)(),
    ).resolves.toBeNull()
    expect(getInfo).not.toHaveBeenCalled()
  })

  it('treats unavailable or empty native model data as optional', async () => {
    await expect(
      createDeviceModelProvider(
        () => true,
        vi.fn(async () => ({ model: '   ' })),
      )(),
    ).resolves.toBeNull()
    await expect(
      createDeviceModelProvider(
        () => true,
        vi.fn(async () => {
          throw new Error('Device API unavailable.')
        }),
      )(),
    ).resolves.toBeNull()
  })
})
