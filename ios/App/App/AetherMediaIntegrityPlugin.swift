import Capacitor
import Foundation

@objc(AetherMediaIntegrityPlugin)
public class AetherMediaIntegrityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AetherMediaIntegrityPlugin"
    public let jsName = "AetherMediaIntegrity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "inspect", returnType: CAPPluginReturnPromise)
    ]

    private let worker = DispatchQueue(
        label: "org.castaliainstitute.aethertak.media-integrity",
        qos: .userInitiated
    )

    @objc func inspect(_ call: CAPPluginCall) {
        guard
            let value = call.getString("uri"),
            let source = URL(string: value),
            source.isFileURL
        else {
            call.reject(
                "A local captured-media file URI is required.",
                "INVALID_MEDIA_URI"
            )
            return
        }

        let resolved = source.resolvingSymlinksInPath().standardizedFileURL
        let appRoot = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        guard
            resolved.path != appRoot.path,
            resolved.path.hasPrefix(appRoot.path + "/")
        else {
            call.reject(
                "Only app-private captured media can be inspected.",
                "MEDIA_OUTSIDE_SANDBOX"
            )
            return
        }

        worker.async {
            do {
                let result = try inspectMediaFile(at: resolved)
                try FileManager.default.setAttributes(
                    [
                        .protectionKey:
                            FileProtectionType
                            .completeUntilFirstUserAuthentication
                    ],
                    ofItemAtPath: resolved.path
                )
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                var protectedFile = resolved
                try protectedFile.setResourceValues(values)
                call.resolve([
                    "sha256": result.sha256,
                    "sizeBytes": result.sizeBytes
                ])
            } catch {
                call.reject(
                    error.localizedDescription,
                    "MEDIA_INSPECTION_FAILED",
                    error
                )
            }
        }
    }
}
