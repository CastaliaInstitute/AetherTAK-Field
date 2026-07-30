import { describe, expect, it } from 'vitest'
import { parseEnrollmentPreferences } from './enrollment'

const preferences = `<?xml version="1.0"?>
<preferences>
  <preference version="1" name="cot_streams">
    <entry key="count" class="class java.lang.Integer">1</entry>
    <entry key="description0" class="class java.lang.String">AetherTAK</entry>
    <entry key="enabled0" class="class java.lang.Boolean">true</entry>
    <entry key="connectString0" class="class java.lang.String">192.168.86.69:8089:ssl</entry>
  </preference>
  <preference version="1" name="com.atakmap.app_preferences">
    <entry key="caLocation" class="class java.lang.String">cert/192.168.86.69.p12</entry>
    <entry key="caPassword" class="class java.lang.String">secret-ca</entry>
    <entry key="clientPassword" class="class java.lang.String">secret-client</entry>
    <entry key="certificateLocation" class="class java.lang.String">cert/Al.p12</entry>
  </preference>
</preferences>`

describe('AetherTAK enrollment descriptor', () => {
  it('extracts only non-secret connection metadata', () => {
    const result = parseEnrollmentPreferences(preferences, [
      'manifest.xml',
      'server.pref',
      '192.168.86.69.p12',
      'Al.p12',
    ])

    expect(result).toEqual({
      name: 'AetherTAK',
      host: '192.168.86.69',
      port: 8089,
      protocol: 'ssl',
      caFileName: '192.168.86.69.p12',
      clientFileName: 'Al.p12',
      hasCaPassword: true,
      hasClientPassword: true,
    })
    expect(JSON.stringify(result)).not.toContain('secret-')
  })

  it('requires TLS and both certificate entries', () => {
    expect(() =>
      parseEnrollmentPreferences(
        preferences.replace(':ssl', ':tcp'),
        ['server.pref', '192.168.86.69.p12', 'Al.p12'],
      ),
    ).toThrow('SSL')
    expect(() =>
      parseEnrollmentPreferences(preferences, ['server.pref', 'Al.p12']),
    ).toThrow('missing')
  })
})
