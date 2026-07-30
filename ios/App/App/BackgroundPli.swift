import Foundation

struct BackgroundPli {
    let uid: String
    let callsign: String
    let team: String
    let latitude: Double
    let longitude: Double
    let altitudeMeters: Double?
    let horizontalAccuracyMeters: Double?
    let verticalAccuracyMeters: Double?
    let headingDegrees: Double?
    let speedMetersPerSecond: Double?
    let batteryPercent: Int?
    let deviceModel: String
    let osVersion: String
    let appVersion: String
    let createdAt: Date
}

func backgroundPliToCot(_ pli: BackgroundPli) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [
        .withInternetDateTime,
        .withFractionalSeconds
    ]
    let staleAt = pli.createdAt.addingTimeInterval(45)
    let battery = pli.batteryPercent.map {
        "<status battery=\"\(min(100, max(0, $0)))\"/>"
    } ?? ""
    return [
        "<event version=\"2.0\" uid=\"\(backgroundPliXml(pli.uid))\" type=\"a-f-G-U-C\" how=\"m-g\" time=\"\(formatter.string(from: pli.createdAt))\" start=\"\(formatter.string(from: pli.createdAt))\" stale=\"\(formatter.string(from: staleAt))\">",
        "<point lat=\"\(pli.latitude)\" lon=\"\(pli.longitude)\" hae=\"\(pli.altitudeMeters ?? 0)\" ce=\"\(pli.horizontalAccuracyMeters ?? 9_999_999)\" le=\"\(pli.verticalAccuracyMeters ?? 9_999_999)\"/>",
        "<detail>",
        "<contact callsign=\"\(backgroundPliXml(pli.callsign))\" endpoint=\"*:-1:stcp\"/>",
        "<__group name=\"\(backgroundPliXml(pli.team))\" role=\"Team Member\"/>",
        battery,
        "<takv device=\"\(backgroundPliXml(pli.deviceModel))\" platform=\"iOS\" os=\"\(backgroundPliXml(pli.osVersion))\" version=\"\(backgroundPliXml(pli.appVersion))\"/>",
        "<track course=\"\(pli.headingDegrees ?? 0)\" speed=\"\(pli.speedMetersPerSecond ?? 0)\"/>",
        "</detail></event>"
    ].joined()
}

private func backgroundPliXml(_ value: String) -> String {
    value
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "'", with: "&apos;")
}
