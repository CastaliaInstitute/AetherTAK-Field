import Capacitor
import CoreLocation
import Foundation

@objc(AetherTakTransportPlugin)
public class AetherTakTransportPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "AetherTakTransportPlugin"
    public let jsName = "AetherTakTransport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "importEnrollmentPackage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeEnrollment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBackgroundTrackingStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBackgroundTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendCot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fieldMutation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fieldChanges", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fieldUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fieldDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "missionPackageUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "missionPackageDownload", returnType: CAPPluginReturnPromise)
    ]

    private let worker = DispatchQueue(
        label: "org.castaliainstitute.aethertak.enrollment",
        qos: .userInitiated
    )
    private let contactLock = NSLock()
    private var contacts: [String: [String: Any]] = [:]
    private var identityStore: TakIdentityStore!
    private var transport: TakTlsTransport!
    private var fieldApi: TakFieldApiClient!
    private var state = "not_enrolled"
    private var lastError: String?
    private var locationManager: CLLocationManager?
    private var pendingTrackingCall: CAPPluginCall?
    private var backgroundTrackingEnabled = false
    private var backgroundReconnecting = false
    private var lastBackgroundPublishAt = Date.distantPast

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
        fieldApi = TakFieldApiClient(identityStore: identityStore)
    }

    @objc func importEnrollmentPackage(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject(
                "An enrollment package path is required.",
                "INVALID_PACKAGE"
            )
            return
        }
        stopBackgroundTracking()
        transport.disconnect()
        contactLock.lock()
        contacts.removeAll()
        contactLock.unlock()
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
        stopBackgroundTracking()
        transport.disconnect()
        state = identityStore.loadProfile() == nil
            ? "not_enrolled"
            : "disconnected"
        call.resolve()
    }

    @objc func removeEnrollment(_ call: CAPPluginCall) {
        stopBackgroundTracking()
        transport.disconnect()
        contactLock.lock()
        contacts.removeAll()
        contactLock.unlock()
        identityStore.deleteProfile()
        state = "not_enrolled"
        lastError = nil
        call.resolve()
        notifyListeners("statusChanged", data: status())
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(status())
    }

    @objc func getBackgroundTrackingStatus(_ call: CAPPluginCall) {
        call.resolve(backgroundTrackingStatus())
    }

    @objc func setBackgroundTracking(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        guard enabled else {
            stopBackgroundTracking()
            call.resolve(backgroundTrackingStatus())
            return
        }
        guard identityStore.loadProfile() != nil else {
            call.reject("Import a TAK enrollment package first.", "NOT_ENROLLED")
            return
        }
        guard transport.isConnected else {
            call.reject(
                "Connect to AetherTAK before enabling background team tracking.",
                "NOT_CONNECTED"
            )
            return
        }
        DispatchQueue.main.async {
            let manager = self.locationManager ?? CLLocationManager()
            self.locationManager = manager
            manager.delegate = self
            switch manager.authorizationStatus {
            case .authorizedAlways, .authorizedWhenInUse:
                self.startBackgroundTracking(manager)
                call.resolve(self.backgroundTrackingStatus())
            case .notDetermined:
                self.pendingTrackingCall?.reject(
                    "A newer background tracking request replaced this one.",
                    "REQUEST_REPLACED"
                )
                self.pendingTrackingCall = call
                manager.requestWhenInUseAuthorization()
            case .denied, .restricted:
                call.reject(
                    "Allow location access in Settings before enabling background team tracking.",
                    "LOCATION_PERMISSION_REQUIRED"
                )
            @unknown default:
                call.reject(
                    "The current location authorization state is unsupported.",
                    "LOCATION_PERMISSION_REQUIRED"
                )
            }
        }
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

    @objc func fieldMutation(_ call: CAPPluginCall) {
        guard let mutation = call.getObject("mutation") else {
            call.reject("A mutation object is required.", "INVALID_MUTATION")
            return
        }
        withFieldProfile(call) { profile, port in
            self.fieldApi.mutate(
                profile: profile,
                port: port,
                mutation: mutation
            ) { result in self.resolveField(call, result) }
        }
    }

    @objc func fieldChanges(_ call: CAPPluginCall) {
        let cursor = call.getInt("cursor") ?? 0
        let limit = call.getInt("limit") ?? 100
        guard cursor >= 0, (1...500).contains(limit) else {
            call.reject("Invalid change cursor or limit.", "INVALID_PAGINATION")
            return
        }
        withFieldProfile(call) { profile, port in
            self.fieldApi.changes(
                profile: profile,
                port: port,
                cursor: cursor,
                limit: limit
            ) { result in self.resolveField(call, result) }
        }
    }

    @objc func fieldUpload(_ call: CAPPluginCall) {
        guard
            let mediaId = call.getString("mediaId"),
            let uri = call.getString("uri"),
            let contentType = call.getString("contentType")
        else {
            call.reject("mediaId, uri, and contentType are required.", "INVALID_MEDIA")
            return
        }
        withFieldProfile(call) { profile, port in
            self.fieldApi.upload(
                profile: profile,
                port: port,
                mediaId: mediaId,
                uri: uri,
                contentType: contentType,
                observationId: call.getString("observationId"),
                role: call.getString("role"),
                suppliedSha256: call.getString("sha256")
            ) { result in self.resolveField(call, result) }
        }
    }

    @objc func fieldDownload(_ call: CAPPluginCall) {
        guard let mediaId = call.getString("mediaId") else {
            call.reject("mediaId is required.", "INVALID_MEDIA")
            return
        }
        withFieldProfile(call) { profile, port in
            self.fieldApi.download(
                profile: profile,
                port: port,
                mediaId: mediaId,
                expectedSha256: call.getString("expectedSha256"),
                expectedContentType: call.getString("expectedContentType")
            ) { result in self.resolveField(call, result) }
        }
    }

    @objc func missionPackageUpload(_ call: CAPPluginCall) {
        guard
            let uri = call.getString("uri"),
            let fileName = call.getString("fileName"),
            let creatorUid = call.getString("creatorUid")
        else {
            call.reject(
                "uri, fileName, and creatorUid are required.",
                "INVALID_MISSION_PACKAGE"
            )
            return
        }
        withFieldProfile(call) { profile, port in
            self.fieldApi.uploadMissionPackage(
                profile: profile,
                port: port,
                uri: uri,
                fileName: fileName,
                creatorUid: creatorUid
            ) { result in self.resolveField(call, result) }
        }
    }

    @objc func missionPackageDownload(_ call: CAPPluginCall) {
        guard
            let senderURL = call.getString("senderUrl"),
            let fileName = call.getString("fileName"),
            let expectedSha256 = call.getString("expectedSha256"),
            let expectedSizeBytes = call.getInt("expectedSizeBytes")
        else {
            call.reject(
                "senderUrl, fileName, expectedSha256, and expectedSizeBytes are required.",
                "INVALID_MISSION_PACKAGE"
            )
            return
        }
        withFieldProfile(call) { profile, port in
            self.fieldApi.downloadMissionPackage(
                profile: profile,
                port: port,
                senderURL: senderURL,
                fileName: fileName,
                expectedSha256: expectedSha256,
                expectedSizeBytes: expectedSizeBytes
            ) { result in self.resolveField(call, result) }
        }
    }

    private func withFieldProfile(
        _ call: CAPPluginCall,
        action: (TakProfile, Int) -> Void
    ) {
        guard let profile = identityStore.loadProfile() else {
            call.reject(
                "Import an AetherTAK enrollment package first.",
                "NOT_ENROLLED"
            )
            return
        }
        let port = call.getInt("port") ?? 9443
        guard (1...65535).contains(port) else {
            call.reject("Invalid Aether Field API port.", "INVALID_PORT")
            return
        }
        action(profile, port)
    }

    private func resolveField(
        _ call: CAPPluginCall,
        _ result: Result<FieldApiResponse, Error>
    ) {
        switch result {
        case .success(let response):
            call.resolve(["status": response.status, "body": response.body])
        case .failure(let error):
            call.reject(
                error.localizedDescription,
                "FIELD_API_FAILED",
                error
            )
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

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let call = pendingTrackingCall else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            pendingTrackingCall = nil
            startBackgroundTracking(manager)
            call.resolve(backgroundTrackingStatus())
        case .denied, .restricted:
            pendingTrackingCall = nil
            call.reject(
                "Location access was not granted.",
                "LOCATION_PERMISSION_REQUIRED"
            )
        default:
            break
        }
    }

    public func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard
            backgroundTrackingEnabled,
            let location = locations.last,
            location.horizontalAccuracy >= 0,
            abs(location.timestamp.timeIntervalSinceNow) <= 30,
            Date().timeIntervalSince(lastBackgroundPublishAt) >= 15
        else {
            return
        }
        lastBackgroundPublishAt = Date()
        publishBackgroundLocation(location)
    }

    public func locationManager(
        _ manager: CLLocationManager,
        didFailWithError error: Error
    ) {
        lastError = error.localizedDescription
        notifyListeners("statusChanged", data: status())
    }

    private func startBackgroundTracking(_ manager: CLLocationManager) {
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = true
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        backgroundTrackingEnabled = true
        lastBackgroundPublishAt = .distantPast
        manager.startUpdatingLocation()
    }

    private func stopBackgroundTracking() {
        let stop = {
            self.locationManager?.stopUpdatingLocation()
            self.locationManager?.allowsBackgroundLocationUpdates = false
            self.locationManager?.delegate = nil
            self.locationManager = nil
            self.backgroundTrackingEnabled = false
            self.backgroundReconnecting = false
            self.pendingTrackingCall?.reject(
                "Background tracking was stopped.",
                "TRACKING_STOPPED"
            )
            self.pendingTrackingCall = nil
        }
        if Thread.isMainThread {
            stop()
        } else {
            DispatchQueue.main.sync(execute: stop)
        }
    }

    private func backgroundTrackingStatus() -> [String: Any] {
        [
            "supported": true,
            "enabled": backgroundTrackingEnabled,
            "detail": backgroundTrackingEnabled
                ? "iOS is sharing team position with the visible background location indicator."
                : "Background team position is off."
        ]
    }

    private func publishBackgroundLocation(_ location: CLLocation) {
        guard let profile = identityStore.loadProfile() else {
            stopBackgroundTracking()
            return
        }
        guard transport.isConnected else {
            guard !backgroundReconnecting else { return }
            backgroundReconnecting = true
            transport.connect(profile: profile) { [weak self] result in
                guard let self else { return }
                self.backgroundReconnecting = false
                switch result {
                case .success:
                    self.state = "connected"
                    self.publishBackgroundLocation(location)
                case .failure(let error):
                    self.state = "disconnected"
                    self.lastError = error.localizedDescription
                }
                self.notifyListeners("statusChanged", data: self.status())
            }
            return
        }
        let xml = backgroundPli(profile: profile, location: location)
        transport.send(xml: xml) { [weak self] result in
            if case .failure(let error) = result {
                self?.lastError = error.localizedDescription
            }
        }
    }

    private func backgroundPli(
        profile: TakProfile,
        location: CLLocation
    ) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let createdAt = Date()
        let staleAt = createdAt.addingTimeInterval(45)
        let altitude = location.verticalAccuracy >= 0 ? location.altitude : 0
        let horizontalAccuracy = location.horizontalAccuracy >= 0
            ? location.horizontalAccuracy
            : 9_999_999
        let verticalAccuracy = location.verticalAccuracy >= 0
            ? location.verticalAccuracy
            : 9_999_999
        let course = location.course >= 0 ? location.course : 0
        let speed = location.speed >= 0 ? location.speed : 0
        return [
            "<event version=\"2.0\" uid=\"AETHER-\(xml(profile.id))\" type=\"a-f-G-U-C\" how=\"m-g\" time=\"\(formatter.string(from: createdAt))\" start=\"\(formatter.string(from: createdAt))\" stale=\"\(formatter.string(from: staleAt))\">",
            "<point lat=\"\(location.coordinate.latitude)\" lon=\"\(location.coordinate.longitude)\" hae=\"\(altitude)\" ce=\"\(horizontalAccuracy)\" le=\"\(verticalAccuracy)\"/>",
            "<detail>",
            "<contact callsign=\"\(xml(profile.callsign))\" endpoint=\"*:-1:stcp\"/>",
            "<__group name=\"\(xml(profile.team))\" role=\"Team Member\"/>",
            "<status battery=\"100\"/>",
            "<takv device=\"AetherTAK Field\" platform=\"iOS\" os=\"mobile\" version=\"0.1.0\"/>",
            "<track course=\"\(course)\" speed=\"\(speed)\"/>",
            "</detail></event>"
        ].joined()
    }

    private func xml(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
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
