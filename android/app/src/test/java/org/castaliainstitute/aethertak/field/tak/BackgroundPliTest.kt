package org.castaliainstitute.aethertak.field.tak

import java.time.Instant
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundPliTest {
    @Test
    fun `encodes a standard stale-bounded PLI event`() {
        val xml = backgroundPliToCot(
            BackgroundPli(
                uid = "AETHER-field-1",
                callsign = "Field One",
                team = "Green",
                latitude = 39.7392,
                longitude = -104.9903,
                altitudeMeters = 1_609.0,
                horizontalAccuracyMeters = 4.5,
                headingDegrees = 87.0,
                speedMetersPerSecond = 1.2,
                verticalAccuracyMeters = 7.25,
                batteryPercent = 73,
                appVersion = "2.4.1",
                createdAt = Instant.parse("2026-07-30T12:00:00Z"),
            ),
        )

        assertTrue(xml.startsWith("<event version=\"2.0\""))
        assertTrue(xml.contains("type=\"a-f-G-U-C\" how=\"m-g\""))
        assertTrue(xml.contains("stale=\"2026-07-30T12:00:45Z\""))
        assertTrue(xml.contains("<point lat=\"39.7392\" lon=\"-104.9903\""))
        assertTrue(xml.contains("ce=\"4.5\" le=\"7.25\""))
        assertTrue(xml.contains("<status battery=\"73\"/>"))
        assertTrue(xml.contains("platform=\"Android\" os=\"mobile\" version=\"2.4.1\""))
        assertTrue(xml.contains("<track course=\"87.0\" speed=\"1.2\"/>"))
        assertTrue(xml.endsWith("</event>"))
    }

    @Test
    fun `escapes operator-controlled identity attributes`() {
        val xml = backgroundPliToCot(
            BackgroundPli(
                uid = "AETHER-<&\"",
                callsign = "Al & Field <One>",
                team = "\"Green\"",
                latitude = 0.0,
                longitude = 0.0,
                altitudeMeters = null,
                horizontalAccuracyMeters = null,
                headingDegrees = null,
                speedMetersPerSecond = null,
                verticalAccuracyMeters = null,
                batteryPercent = null,
                appVersion = "2<&",
                createdAt = Instant.EPOCH,
            ),
        )

        assertTrue(xml.contains("uid=\"AETHER-&lt;&amp;&quot;\""))
        assertTrue(xml.contains("callsign=\"Al &amp; Field &lt;One&gt;\""))
        assertTrue(xml.contains("name=\"&quot;Green&quot;\""))
        assertTrue(xml.contains("version=\"2&lt;&amp;\""))
        assertFalse(xml.contains("Al & Field"))
        assertFalse(xml.contains("<status battery="))
    }
}
