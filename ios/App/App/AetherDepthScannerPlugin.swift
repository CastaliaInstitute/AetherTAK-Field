import ARKit
import Capacitor
import Foundation

@objc(AetherDepthScannerPlugin)
public class AetherDepthScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AetherDepthScannerPlugin"
    public let jsName = "AetherDepthScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelScan", returnType: CAPPluginReturnPromise)
    ]

    private var supportsSceneDepth: Bool {
        ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    }

    private var supportsMesh: Bool {
        ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }

    @objc func getCapability(_ call: CAPPluginCall) {
        let supported = supportsSceneDepth
        let reason: Any = supported
            ? NSNull()
            : "ARKit scene depth is not available on this device."
        call.resolve([
            "supported": supported,
            "provider": supported ? "arkit-lidar" : "none",
            "supportsPointCloud": supported,
            "supportsMesh": supportsMesh,
            "supportsConfidence": supported,
            "reason": reason
        ])
    }

    @objc func startScan(_ call: CAPPluginCall) {
        guard supportsSceneDepth else {
            call.reject(
                "ARKit scene depth is unavailable on this device.",
                "UNAVAILABLE"
            )
            return
        }
        call.reject(
            "ARKit capture session is not included in this foundation build.",
            "NOT_IMPLEMENTED"
        )
    }

    @objc func cancelScan(_ call: CAPPluginCall) {
        call.resolve()
    }
}
