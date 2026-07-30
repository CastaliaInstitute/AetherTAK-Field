import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

let createdAt = Date(timeIntervalSince1970: 0)
let xml = backgroundPliToCot(
    BackgroundPli(
        uid: "AETHER-field-1",
        callsign: "Field One",
        team: "Green",
        latitude: 39.7392,
        longitude: -104.9903,
        altitudeMeters: 1_609,
        horizontalAccuracyMeters: 4.5,
        verticalAccuracyMeters: 7.25,
        headingDegrees: 87,
        speedMetersPerSecond: 1.2,
        batteryPercent: 73,
        appVersion: "2.4.1",
        createdAt: createdAt
    )
)

require(xml.hasPrefix("<event version=\"2.0\""), "event header")
require(xml.contains("type=\"a-f-G-U-C\" how=\"m-g\""), "standard PLI type")
require(xml.contains("stale=\"1970-01-01T00:00:45.000Z\""), "45-second stale window")
require(xml.contains("<point lat=\"39.7392\" lon=\"-104.9903\""), "coordinates")
require(xml.contains("ce=\"4.5\" le=\"7.25\""), "accuracy metadata")
require(xml.contains("<status battery=\"73\"/>"), "real battery value")
require(xml.contains("platform=\"iOS\" os=\"mobile\" version=\"2.4.1\""), "runtime version")
require(xml.contains("<track course=\"87.0\" speed=\"1.2\"/>"), "track metadata")
require(xml.hasSuffix("</event>"), "event terminator")

let escaped = backgroundPliToCot(
    BackgroundPli(
        uid: "AETHER-<&\"",
        callsign: "Al & Field <One>",
        team: "\"Green\"",
        latitude: 0,
        longitude: 0,
        altitudeMeters: nil,
        horizontalAccuracyMeters: nil,
        verticalAccuracyMeters: nil,
        headingDegrees: nil,
        speedMetersPerSecond: nil,
        batteryPercent: nil,
        appVersion: "2<&",
        createdAt: createdAt
    )
)

require(escaped.contains("uid=\"AETHER-&lt;&amp;&quot;\""), "escaped UID")
require(escaped.contains("callsign=\"Al &amp; Field &lt;One&gt;\""), "escaped callsign")
require(escaped.contains("name=\"&quot;Green&quot;\""), "escaped team")
require(escaped.contains("version=\"2&lt;&amp;\""), "escaped version")
require(!escaped.contains("<status battery="), "unknown battery omitted")

print("iOS Background PLI encoder tests passed")
