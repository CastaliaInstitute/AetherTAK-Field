import { beforeEach, describe, expect, it, vi } from 'vitest'

const writeFile = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    writeFile,
    deleteFile: vi.fn(),
  },
}))

import { persistMissionPackage } from './missionPackage'

describe('mission-package private persistence', () => {
  beforeEach(() => {
    writeFile.mockReset()
    writeFile.mockResolvedValue({
      uri: 'file:///private/mission-package.zip',
    })
  })

  it('validates a ZIP signature and persists a sanitized filename', async () => {
    const manifest = new TextEncoder().encode('MANIFEST/manifest.xml')
    const file = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04]), manifest],
      'Field evidence (north).zip',
      { type: 'application/zip' },
    )
    const persisted = await persistMissionPackage(file)
    expect(persisted).toMatchObject({
      fileName: 'Field_evidence_north_.zip',
      localUri: 'file:///private/mission-package.zip',
      sizeBytes: 25,
    })
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: 'DATA',
        recursive: true,
        data: expect.any(String),
      }),
    )
  })

  it('rejects extension spoofing and oversized packages before persistence', async () => {
    await expect(
      persistMissionPackage(
        new File([new Uint8Array([1, 2, 3, 4])], 'fake.zip'),
      ),
    ).rejects.toThrow('not a valid ZIP')
    await expect(
      persistMissionPackage(
        new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'fake.txt'),
      ),
    ).rejects.toThrow('mission-package ZIP')
    expect(writeFile).not.toHaveBeenCalled()
  })
})
