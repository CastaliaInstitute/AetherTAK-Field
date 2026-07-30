import { describe, expect, it, vi } from 'vitest'
import { createMediaIntegrityClient } from './mediaIntegrity'

describe('native media integrity bridge', () => {
  it('accepts a validated streaming digest result', async () => {
    const inspect = vi.fn(async () => ({
      sha256: 'a'.repeat(64),
      sizeBytes: 4_096,
    }))
    const client = createMediaIntegrityClient({ inspect }, () => true)

    await expect(client.inspect('file:///private/video.mp4')).resolves.toEqual({
      sha256: 'a'.repeat(64),
      sizeBytes: 4_096,
    })
    expect(inspect).toHaveBeenCalledWith({
      uri: 'file:///private/video.mp4',
    })
  })

  it('fails closed outside native apps and on malformed results', async () => {
    const inspect = vi.fn(async () => ({
      sha256: 'not-a-digest',
      sizeBytes: 0,
    }))

    await expect(
      createMediaIntegrityClient({ inspect }, () => false).inspect(
        'file:///private/video.mp4',
      ),
    ).rejects.toThrow(/iOS or Android/)
    await expect(
      createMediaIntegrityClient({ inspect }, () => true).inspect(
        'file:///private/video.mp4',
      ),
    ).rejects.toThrow()
    await expect(
      createMediaIntegrityClient({ inspect }, () => true).inspect('  '),
    ).rejects.toThrow(/URI is required/)
  })
})
