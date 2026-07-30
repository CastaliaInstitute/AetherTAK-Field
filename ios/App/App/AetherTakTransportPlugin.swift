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

    private var state = "not_enrolled"

    private func status(error: String? = nil) -> [String: Any] {
        let errorValue: Any = error.map { $0 as Any } ?? NSNull()
        return [
            "state": state,
            "profile": NSNull(),
            "lastConnectedAt": NSNull(),
            "error": errorValue
        ]
    }

    @objc func importEnrollmentPackage(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject(
                "An enrollment package path is required.",
                "INVALID_PACKAGE"
            )
            return
        }
        _ = path
        call.reject(
            "Secure Keychain enrollment import is not included in this foundation build.",
            "NOT_IMPLEMENTED"
        )
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard state != "not_enrolled" else {
            call.resolve(
                status(error: "Import an AetherTAK enrollment package first.")
            )
            return
        }
        state = "disconnected"
        call.resolve(
            status(error: "Certificate-backed CoT transport is not configured.")
        )
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        state = "disconnected"
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(status())
    }

    @objc func getContacts(_ call: CAPPluginCall) {
        call.resolve(["contacts": []])
    }

    @objc func sendCot(_ call: CAPPluginCall) {
        guard
            let xml = call.getString("xml"),
            xml.hasPrefix("<event")
        else {
            call.reject("A valid CoT event is required.", "INVALID_COT")
            return
        }
        call.resolve(["accepted": false])
    }
}
