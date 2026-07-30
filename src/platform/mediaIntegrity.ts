import { Capacitor, registerPlugin } from '@capacitor/core'
import { z } from 'zod'

const mediaIntegrityResultSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().positive(),
})

export type MediaIntegrityResult = z.infer<
  typeof mediaIntegrityResultSchema
>

interface AetherMediaIntegrityPlugin {
  inspect(options: { uri: string }): Promise<MediaIntegrityResult>
}

const nativeMediaIntegrity =
  registerPlugin<AetherMediaIntegrityPlugin>('AetherMediaIntegrity')

export function createMediaIntegrityClient(
  plugin: AetherMediaIntegrityPlugin,
  isNative: () => boolean,
) {
  return {
    async inspect(uri: string): Promise<MediaIntegrityResult> {
      if (!isNative()) {
        throw new Error(
          'Native media integrity inspection requires the iOS or Android application.',
        )
      }
      if (!uri.trim()) {
        throw new Error('A media file URI is required for integrity inspection.')
      }
      return mediaIntegrityResultSchema.parse(await plugin.inspect({ uri }))
    },
  }
}

export const mediaIntegrity = createMediaIntegrityClient(
  nativeMediaIntegrity,
  () => Capacitor.isNativePlatform(),
)
