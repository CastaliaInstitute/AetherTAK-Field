import Capacitor
import Foundation

@objc(AetherTakTransportPlugin)
public class AetherTakTransportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AetherTakTransportPlugin"
    public let jsName = "AetherTakTransport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "importEnrollmentPackage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendCot", returnType: CAPPluginReturnPromise)
    ]

    private let worker = DispatchQueue(
        label: "org.castaliainstitute.aethertak.enrollment",
        qos: .userInitiated
    )
    private let contactLock = NSLock()
    private var contacts: [String: [String: Any]] = [:]
    private var identityStore: TakIdentityStore!
    private var transport: TakTlsTransport!
    private var state = "not_enrolled"
    private var lastError: String?

    public override func load() {
        identityStore = TakIdentityStore()
        state = identityStore.loadProfile() == nil
            ? "not_enrolled"
            : "disconnected"
        transport = TakTlsTransport(
            identityStore: identityStore,
            onEvent: { [weak self] xml in self?.receiveEvent(xml) },
            onDisconnected: { [weak self] error in
                guard let self else { return }
                self.state = "disconnected"
                self.lastError = error
                self.notifyListeners("statusChanged", data: self.status())
            }
        )
    }

    @objc func importEnrollmentPackage(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject(
                "An enrollment package path is required.",
                "INVALID_PACKAGE"
            )
            return
        }
        worker.async { [weak self] in
            guard let self else { return }
            do {
                let url: URL
                if let parsed = URL(string: path), parsed.scheme != nil {
                    url = parsed
                } else {
                    url = URL(fileURLWithPath: path)
                }
                let material = try TakEnrollmentPackage.read(url: url)
                let profile = try self.identityStore.importMaterial(material)
                self.state = "disconnected"
                self.lastError = nil
                call.resolve(self.profileObject(profile))
            } catch {
                call.reject(
                    error.localizedDescription,
                    "ENROLLMENT_FAILED",
                    error
                )
            }
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let profile = identityStore.loadProfile() else {
            state = "not_enrolled"
            call.resolve(
                status(error: "Import an AetherTAK enrollment package first.")
            )
            return
        }
        state = "connecting"
        lastError = nil
        transport.connect(profile: profile) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.state = "connected"
                call.resolve(self.status())
                self.notifyListeners("statusChanged", data: self.status())
            case .failure(let error):
                self.state = "disconnected"
                self.lastError = error.localizedDescription
                call.resolve(self.status(error: error.localizedDescription))
            }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        transport.disconnect()
        state = identityStore.loadProfile() == nil
            ? "not_enrolled"
            : "disconnected"
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(status())
    }

    @objc func getContacts(_ call: CAPPluginCall) {
        contactLock.lock()
        let now = Date()
        let active = contacts.values.filter { contact in
            guard
                let value = contact["staleAt"] as? String,
                let stale = ISO8601DateFormatter().date(from: value)
            else {
                return false
            }
            return stale > now
        }
        contactLock.unlock()
        call.resolve(["contacts": Array(active)])
    }

    @objc func sendCot(_ call: CAPPluginCall) {
        guard
            let xml = call.getString("xml"),
            xml.hasPrefix("<event"),
            xml.hasSuffix("</event>")
        else {
            call.reject("A valid CoT event is required.", "INVALID_COT")
            return
        }
        transport.send(xml: xml) { result in
            switch result {
            case .success:
                call.resolve(["accepted": true])
            case .failure(let error):
                call.reject(
                    error.localizedDescription,
                    "SEND_FAILED",
                    error
                )
            }
        }
    }

    private func status(error: String? = nil) -> [String: Any] {
        let profile = identityStore.loadProfile()
        let errorValue: Any = (error ?? lastError).map { $0 as Any } ?? NSNull()
        let profileValue: Any = profile.map { profileObject($0) as Any } ?? NSNull()
        let connectedValue: Any = transport.connectedAt.map {
            ISO8601DateFormatter().string(from: $0) as Any
        } ?? NSNull()
        return [
            "state": state,
            "profile": profileValue,
            "lastConnectedAt": connectedValue,
            "error": errorValue
        ]
    }

    private func profileObject(_ profile: TakProfile) -> [String: Any] {
        [
            "id": profile.id,
            "name": profile.name,
            "host": profile.host,
            "port": Int(profile.port),
            "callsign": profile.callsign,
            "team": profile.team
        ]
    }

    private func receiveEvent(_ xml: String) {
        notifyListeners("cotEvent", data: ["xml": xml])
        guard
            let type = attribute(xml, tag: "event", name: "type"),
            type.hasPrefix("a-"),
            let uid = attribute(xml, tag: "event", name: "uid"),
            let callsign = attribute(xml, tag: "contact", name: "callsign"),
            let stale = attribute(xml, tag: "event", name: "stale"),
            let latitude = Double(
                attribute(xml, tag: "point", name: "lat") ?? ""
            ),
            let longitude = Double(
                attribute(xml, tag: "point", name: "lon") ?? ""
            )
        else {
            return
        }
        let coordinate: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude,
            "altitudeMeters": optionalNumber(
                attribute(xml, tag: "point", name: "hae")
            ),
            "horizontalAccuracyMeters": optionalNumber(
                attribute(xml, tag: "point", name: "ce")
            ),
            "verticalAccuracyMeters": optionalNumber(
                attribute(xml, tag: "point", name: "le")
            ),
            "headingDegrees": optionalNumber(
                attribute(xml, tag: "track", name: "course")
            )
        ]
        contactLock.lock()
        contacts[uid] = [
            "uid": uid,
            "callsign": callsign,
            "team": attribute(xml, tag: "__group", name: "name") ?? NSNull(),
            "coordinate": coordinate,
            "staleAt": stale
        ]
        contactLock.unlock()
    }

    private func optionalNumber(_ value: String?) -> Any {
        value.flatMap(Double.init).map { $0 as Any } ?? NSNull()
    }

    private func attribute(
        _ xml: String,
        tag: String,
        name: String
    ) -> String? {
        let escapedTag = NSRegularExpression.escapedPattern(for: tag)
        let escapedName = NSRegularExpression.escapedPattern(for: name)
        let pattern = "<\(escapedTag)\\b[^>]*\\b\(escapedName)=\"([^\"]*)\""
        guard
            let regex = try? NSRegularExpression(pattern: pattern),
            let match = regex.firstMatch(
                in: xml,
                range: NSRange(xml.startIndex..., in: xml)
            ),
            let range = Range(match.range(at: 1), in: xml)
        else {
            return nil
        }
        return String(xml[range])
    }
}
