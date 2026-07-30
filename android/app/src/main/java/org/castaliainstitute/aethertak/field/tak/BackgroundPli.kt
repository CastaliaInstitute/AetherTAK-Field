package org.castaliainstitute.aethertak.field.tak

import java.time.Instant
import java.time.temporal.ChronoUnit

data class BackgroundPli(
    val uid: String,
    val callsign: String,
    val team: String,
    val latitude: Double,
    val longitude: Double,
    val altitudeMeters: Double?,
    val horizontalAccuracyMeters: Double?,
    val headingDegrees: Double?,
    val speedMetersPerSecond: Double?,
    val verticalAccuracyMeters: Double?,
    val batteryPercent: Int?,
    val appVersion: String,
    val createdAt: Instant,
)

fun backgroundPliToCot(pli: BackgroundPli): String {
    val stale = pli.createdAt.plus(45, ChronoUnit.SECONDS)
    return buildString {
        append("""<event version="2.0" uid="${xml(pli.uid)}" type="a-f-G-U-C" how="m-g" time="${pli.createdAt}" start="${pli.createdAt}" stale="$stale">""")
        append("""<point lat="${pli.latitude}" lon="${pli.longitude}" hae="${pli.altitudeMeters ?: 0.0}" ce="${pli.horizontalAccuracyMeters ?: 9_999_999.0}" le="${pli.verticalAccuracyMeters ?: 9_999_999.0}"/>""")
        append("<detail>")
        append("""<contact callsign="${xml(pli.callsign)}" endpoint="*:-1:stcp"/>""")
        append("""<__group name="${xml(pli.team)}" role="Team Member"/>""")
        pli.batteryPercent?.let {
            append("""<status battery="${it.coerceIn(0, 100)}"/>""")
        }
        append("""<takv device="AetherTAK Field" platform="Android" os="mobile" version="${xml(pli.appVersion)}"/>""")
        append("""<track course="${pli.headingDegrees ?: 0.0}" speed="${pli.speedMetersPerSecond ?: 0.0}"/>""")
        append("</detail></event>")
    }
}

private fun xml(value: String): String = value
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
    .replace("'", "&apos;")
