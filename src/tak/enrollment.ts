import { XMLParser } from 'fast-xml-parser'
import { z } from 'zod'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
})

export const enrollmentDescriptorSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  protocol: z.literal('ssl'),
  caFileName: z.string().min(1),
  clientFileName: z.string().min(1),
  hasCaPassword: z.literal(true),
  hasClientPassword: z.literal(true),
})

export type EnrollmentDescriptor = z.infer<typeof enrollmentDescriptorSchema>

function entriesByKey(xml: string) {
  const parsed = parser.parse(xml) as {
    preferences?: {
      preference?: Array<{
        name?: string
        entry?: Array<{ key?: string; '#text'?: unknown }> | { key?: string; '#text'?: unknown }
      }>
    }
  }
  const preferences = parsed.preferences?.preference
  const groups = Array.isArray(preferences)
    ? preferences
    : preferences
      ? [preferences]
      : []
  const result = new Map<string, string>()
  for (const group of groups) {
    const entries = Array.isArray(group.entry)
      ? group.entry
      : group.entry
        ? [group.entry]
        : []
    for (const entry of entries) {
      if (entry.key && entry['#text'] !== undefined) {
        result.set(entry.key, String(entry['#text']))
      }
    }
  }
  return result
}

const basename = (value: string) =>
  value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? ''

export function parseEnrollmentPreferences(
  xml: string,
  packageEntries: string[],
): EnrollmentDescriptor {
  const entries = entriesByKey(xml)
  const connectString = entries.get('connectString0')
  const caLocation = entries.get('caLocation')
  const clientLocation = entries.get('certificateLocation')
  if (!connectString || !caLocation || !clientLocation) {
    throw new Error('TAK enrollment preferences are incomplete.')
  }
  const match = connectString.match(/^(.+):(\d+):(ssl)$/)
  if (!match) {
    throw new Error('Only certificate-authenticated SSL TAK streams are supported.')
  }
  const caFileName = basename(caLocation)
  const clientFileName = basename(clientLocation)
  const packageBasenames = new Set(packageEntries.map(basename))
  if (
    !packageBasenames.has(caFileName) ||
    !packageBasenames.has(clientFileName)
  ) {
    throw new Error('TAK enrollment certificate files are missing.')
  }

  return enrollmentDescriptorSchema.parse({
    name: entries.get('description0') ?? 'TAK Server',
    host: match[1],
    port: Number(match[2]),
    protocol: match[3],
    caFileName,
    clientFileName,
    hasCaPassword: Boolean(entries.get('caPassword')),
    hasClientPassword: Boolean(entries.get('clientPassword')),
  })
}
