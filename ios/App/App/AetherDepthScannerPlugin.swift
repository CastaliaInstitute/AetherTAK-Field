import ARKit
import Capacitor
import CoreImage
import Foundation
import SceneKit
import UIKit

@objc(AetherDepthScannerPlugin)
public class AetherDepthScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AetherDepthScannerPlugin"
    public let jsName = "AetherDepthScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelScan", returnType: CAPPluginReturnPromise)
    ]

    private weak var scanner: AetherDepthCaptureViewController?
    private var pendingCall: CAPPluginCall?

    private var supportsSceneDepth: Bool {
        ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    }

    private var supportsMesh: Bool {
        ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }

    @objc func getCapability(_ call: CAPPluginCall) {
        let supported = supportsSceneDepth
        call.resolve([
            "supported": supported,
            "provider": supported ? "arkit-lidar" : "none",
            "supportsPointCloud": supported,
            "supportsMesh": supportsMesh,
            "supportsConfidence": supported,
            "reason": supported ? NSNull() : "ARKit scene depth is not available on this device."
        ])
    }

    @objc func startScan(_ call: CAPPluginCall) {
        guard supportsSceneDepth else {
            call.reject("ARKit scene depth is unavailable on this device.", "UNAVAILABLE")
            return
        }
        guard pendingCall == nil else {
            call.reject("A depth scan is already active.", "SCAN_ACTIVE")
            return
        }
        guard let presenter = bridge?.viewController else {
            call.reject("The depth scanner cannot be presented.", "NO_VIEW_CONTROLLER")
            return
        }

        let coordinate = call.getObject("coordinate") ?? [:]
        let mode = call.getString("mode") ?? "measure"
        let controller = AetherDepthCaptureViewController(
            coordinate: coordinate,
            mode: mode,
            meshEnabled: supportsMesh
        )
        controller.modalPresentationStyle = .fullScreen
        controller.onComplete = { [weak self, weak controller] result in
            guard let self = self, let pending = self.pendingCall else { return }
            self.pendingCall = nil
            self.scanner = nil
            controller?.dismiss(animated: true) {
                switch result {
                case .success(let payload):
                    pending.resolve(payload)
                case .failure(let error):
                    let captureError = error as? AetherDepthCaptureError
                    pending.reject(
                        error.localizedDescription,
                        captureError?.code ?? "CAPTURE_FAILED"
                    )
                }
            }
        }
        pendingCall = call
        scanner = controller
        DispatchQueue.main.async {
            presenter.present(controller, animated: true)
        }
    }

    @objc func cancelScan(_ call: CAPPluginCall) {
        guard let activeScanner = scanner else {
            call.resolve()
            return
        }
        activeScanner.cancel()
        call.resolve()
    }
}

private enum AetherDepthCaptureError: LocalizedError {
    case cancelled
    case depthNotReady
    case exportFailed(String)

    var code: String {
        switch self {
        case .cancelled: return "CANCELLED"
        case .depthNotReady: return "DEPTH_NOT_READY"
        case .exportFailed: return "EXPORT_FAILED"
        }
    }

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Depth capture was cancelled."
        case .depthNotReady:
            return "Depth is not ready. Move slowly around the subject and try again."
        case .exportFailed(let message):
            return "Depth export failed: \(message)"
        }
    }
}

private final class AetherDepthCaptureViewController: UIViewController, ARSessionDelegate {
    var onComplete: ((Result<[String: Any], Error>) -> Void)?

    private let coordinate: [String: Any]
    private let mode: String
    private let meshEnabled: Bool
    private let sceneView = ARSCNView(frame: .zero)
    private let statusLabel = UILabel()
    private let captureButton = UIButton(type: .system)
    private var finished = false

    init(coordinate: [String: Any], mode: String, meshEnabled: Bool) {
        self.coordinate = coordinate
        self.mode = mode
        self.meshEnabled = meshEnabled
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureInterface()
        sceneView.session.delegate = self

        let configuration = ARWorldTrackingConfiguration()
        configuration.frameSemantics.insert(.sceneDepth)
        if meshEnabled && mode == "mesh" {
            configuration.sceneReconstruction = .mesh
        }
        sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let ready = frame.sceneDepth != nil && frame.camera.trackingState.isNormal
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.finished else { return }
            self.captureButton.isEnabled = ready
            self.captureButton.alpha = ready ? 1 : 0.55
            self.statusLabel.text = ready
                ? "Depth ready — hold steady and capture"
                : "Move slowly around the subject to build depth"
        }
    }

    func cancel() {
        finish(.failure(AetherDepthCaptureError.cancelled))
    }

    private func configureInterface() {
        sceneView.translatesAutoresizingMaskIntoConstraints = false
        sceneView.automaticallyUpdatesLighting = true
        view.addSubview(sceneView)

        let overlay = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.layer.cornerRadius = 14
        overlay.clipsToBounds = true
        view.addSubview(overlay)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "Starting LiDAR…"
        statusLabel.textColor = .white
        statusLabel.font = .preferredFont(forTextStyle: .headline)
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center

        captureButton.translatesAutoresizingMaskIntoConstraints = false
        captureButton.configuration = .filled()
        captureButton.configuration?.title = "Capture depth"
        captureButton.configuration?.cornerStyle = .capsule
        captureButton.isEnabled = false
        captureButton.addTarget(self, action: #selector(capture), for: .touchUpInside)

        let cancelButton = UIButton(type: .system)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cancelButton.configuration = .tinted()
        cancelButton.configuration?.title = "Cancel"
        cancelButton.configuration?.baseForegroundColor = .white
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [statusLabel, captureButton, cancelButton])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 12
        overlay.contentView.addSubview(stack)

        NSLayoutConstraint.activate([
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            overlay.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            overlay.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: overlay.contentView.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: overlay.contentView.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: overlay.contentView.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(equalTo: overlay.contentView.bottomAnchor, constant: -16),
            captureButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48),
            cancelButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }

    @objc private func cancelTapped() {
        cancel()
    }

    @objc private func capture() {
        guard let frame = sceneView.session.currentFrame, frame.sceneDepth != nil else {
            statusLabel.text = AetherDepthCaptureError.depthNotReady.localizedDescription
            return
        }
        captureButton.isEnabled = false
        statusLabel.text = "Saving depth, confidence, and geometry…"
        sceneView.session.pause()
        let anchors = frame.anchors.compactMap { $0 as? ARMeshAnchor }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let payload = try AetherDepthExporter.export(
                    frame: frame,
                    meshAnchors: anchors,
                    coordinate: self.coordinate,
                    mode: self.mode
                )
                DispatchQueue.main.async { self.finish(.success(payload)) }
            } catch {
                DispatchQueue.main.async { self.finish(.failure(error)) }
            }
        }
    }

    private func finish(_ result: Result<[String: Any], Error>) {
        guard !finished else { return }
        finished = true
        sceneView.session.pause()
        onComplete?(result)
    }
}

private extension ARCamera.TrackingState {
    var isNormal: Bool {
        if case .normal = self { return true }
        return false
    }
}

private enum AetherDepthExporter {
    private struct Point {
        let position: SIMD3<Float>
        let depth: Float
        let confidence: UInt8
    }

    static func export(
        frame: ARFrame,
        meshAnchors: [ARMeshAnchor],
        coordinate: [String: Any],
        mode: String
    ) throws -> [String: Any] {
        guard let sceneDepth = frame.sceneDepth else {
            throw AetherDepthCaptureError.depthNotReady
        }

        let id = UUID()
        let root = try scanDirectory(id: id)
        let previewURL = root.appendingPathComponent("preview.jpg")
        let depthURL = root.appendingPathComponent("depth.f32le")
        let confidenceURL = root.appendingPathComponent("confidence.u8")
        let cloudURL = root.appendingPathComponent("point-cloud.ply")
        let modelURL = root.appendingPathComponent("mesh.obj")

        try writePreview(frame.capturedImage, to: previewURL)
        let points = try writeDepthAndConfidence(
            sceneDepth,
            camera: frame.camera,
            depthURL: depthURL,
            confidenceURL: confidenceURL
        )
        try writePointCloud(points, to: cloudURL)

        var exportedModel: URL?
        if mode == "mesh" && !meshAnchors.isEmpty {
            try writeMesh(meshAnchors, to: modelURL)
            exportedModel = modelURL
        }

        return [
            "id": id.uuidString.lowercased(),
            "provider": "arkit-lidar",
            "capturedAt": ISO8601DateFormatter.aether.string(from: Date()),
            "coordinate": normalizedCoordinate(coordinate),
            "previewUri": previewURL.absoluteString,
            "depthUri": depthURL.absoluteString,
            "confidenceUri": confidenceURL.absoluteString,
            "pointCloudUri": cloudURL.absoluteString,
            "modelUri": exportedModel?.absoluteString ?? NSNull(),
            "measurements": measurements(for: points)
        ]
    }

    private static func scanDirectory(id: UUID) throws -> URL {
        let manager = FileManager.default
        let support = try manager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let scans = support.appendingPathComponent("DepthScans", isDirectory: true)
        let directory = scans.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true)
        try manager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [
                .protectionKey:
                    FileProtectionType
                    .completeUntilFirstUserAuthentication
            ]
        )
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        var mutableDirectory = directory
        try? mutableDirectory.setResourceValues(resource)
        return directory
    }

    private static func writePreview(_ pixelBuffer: CVPixelBuffer, to url: URL) throws {
        let image = CIImage(cvPixelBuffer: pixelBuffer).oriented(.right)
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard
            let cgImage = context.createCGImage(image, from: image.extent),
            let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.9)
        else {
            throw AetherDepthCaptureError.exportFailed("Could not encode the camera preview.")
        }
        try data.write(to: url, options: .atomic)
    }

    private static func writeDepthAndConfidence(
        _ sceneDepth: ARDepthData,
        camera: ARCamera,
        depthURL: URL,
        confidenceURL: URL
    ) throws -> [Point] {
        let depth = sceneDepth.depthMap
        let confidence = sceneDepth.confidenceMap
        CVPixelBufferLockBaseAddress(depth, .readOnly)
        if let confidence = confidence {
            CVPixelBufferLockBaseAddress(confidence, .readOnly)
        }
        defer {
            CVPixelBufferUnlockBaseAddress(depth, .readOnly)
            if let confidence = confidence {
                CVPixelBufferUnlockBaseAddress(confidence, .readOnly)
            }
        }

        guard let depthBase = CVPixelBufferGetBaseAddress(depth) else {
            throw AetherDepthCaptureError.exportFailed("The LiDAR depth buffer is inaccessible.")
        }
        let width = CVPixelBufferGetWidth(depth)
        let height = CVPixelBufferGetHeight(depth)
        let depthStride = CVPixelBufferGetBytesPerRow(depth)
        let confidenceBase = confidence.flatMap(CVPixelBufferGetBaseAddress)
        let confidenceStride = confidence.map(CVPixelBufferGetBytesPerRow) ?? 0

        var depthData = Data("AETHER_DEPTH_F32LE\n\(width) \(height)\n".utf8)
        var confidenceData = Data("AETHER_CONFIDENCE_U8\n\(width) \(height)\n".utf8)
        var points: [Point] = []
        points.reserveCapacity((width * height) / 4)

        let imageResolution = camera.imageResolution
        let scaleX = Float(width) / Float(imageResolution.width)
        let scaleY = Float(height) / Float(imageResolution.height)
        let fx = camera.intrinsics[0, 0] * scaleX
        let fy = camera.intrinsics[1, 1] * scaleY
        let cx = camera.intrinsics[2, 0] * scaleX
        let cy = camera.intrinsics[2, 1] * scaleY

        for y in 0..<height {
            let depthRow = depthBase.advanced(by: y * depthStride)
            depthData.append(depthRow.assumingMemoryBound(to: UInt8.self), count: width * 4)
            let confidenceRow = confidenceBase?.advanced(by: y * confidenceStride)
            if let confidenceRow = confidenceRow {
                confidenceData.append(confidenceRow.assumingMemoryBound(to: UInt8.self), count: width)
            } else {
                confidenceData.append(Data(repeating: 0, count: width))
            }

            guard y.isMultiple(of: 2) else { continue }
            let depthValues = depthRow.assumingMemoryBound(to: Float.self)
            let confidenceValues = confidenceRow?.assumingMemoryBound(to: UInt8.self)
            for x in stride(from: 0, to: width, by: 2) {
                let z = depthValues[x]
                guard z.isFinite && z > 0.05 && z < 65 else { continue }
                let local = SIMD4<Float>(
                    (Float(x) - cx) * z / fx,
                    -(Float(y) - cy) * z / fy,
                    -z,
                    1
                )
                let world = camera.transform * local
                points.append(
                    Point(
                        position: SIMD3(world.x, world.y, world.z),
                        depth: z,
                        confidence: confidenceValues?[x] ?? 0
                    )
                )
            }
        }

        try depthData.write(to: depthURL, options: .atomic)
        try confidenceData.write(to: confidenceURL, options: .atomic)
        guard !points.isEmpty else {
            throw AetherDepthCaptureError.exportFailed("No valid depth samples were captured.")
        }
        return points
    }

    private static func writePointCloud(_ points: [Point], to url: URL) throws {
        var output = """
        ply
        format ascii 1.0
        comment AetherTAK Field ARKit scene depth, meters in ARKit world coordinates
        element vertex \(points.count)
        property float x
        property float y
        property float z
        property uchar confidence
        end_header

        """
        for point in points {
            output += "\(point.position.x) \(point.position.y) \(point.position.z) \(point.confidence)\n"
        }
        try Data(output.utf8).write(to: url, options: .atomic)
    }

    private static func writeMesh(_ anchors: [ARMeshAnchor], to url: URL) throws {
        var output = "# AetherTAK Field ARKit mesh, meters in ARKit world coordinates\n"
        var vertexOffset = 1
        for anchor in anchors {
            let geometry = anchor.geometry
            for index in 0..<geometry.vertices.count {
                let vertex = geometry.vertices.vertex(at: index)
                let world = anchor.transform * SIMD4<Float>(vertex.x, vertex.y, vertex.z, 1)
                output += "v \(world.x) \(world.y) \(world.z)\n"
            }
            for faceIndex in 0..<geometry.faces.count {
                let indices = geometry.faces.indices(for: faceIndex)
                guard indices.count >= 3 else { continue }
                output += "f " + indices.map { String($0 + vertexOffset) }.joined(separator: " ") + "\n"
            }
            vertexOffset += geometry.vertices.count
        }
        try Data(output.utf8).write(to: url, options: .atomic)
    }

    private static func measurements(for points: [Point]) -> [[String: Any]] {
        let xs = points.map(\.position.x)
        let ys = points.map(\.position.y)
        let zs = points.map(\.position.z)
        let width = Double((xs.max() ?? 0) - (xs.min() ?? 0))
        let height = Double((ys.max() ?? 0) - (ys.min() ?? 0))
        let depth = Double((zs.max() ?? 0) - (zs.min() ?? 0))
        let sortedRanges = points.map(\.depth).sorted()
        let median = Double(sortedRanges[sortedRanges.count / 2])
        let averageConfidence = Double(points.reduce(0) { $0 + Int($1.confidence) })
            / Double(points.count)
        let uncertainty = max(0.01, 0.21 - min(2, averageConfidence) * 0.1)
        return [
            measurement("Median range", median, "m", uncertainty),
            measurement("Bounds width", width, "m", uncertainty),
            measurement("Bounds height", height, "m", uncertainty),
            measurement("Bounds depth", depth, "m", uncertainty),
            measurement("Projected area", width * height, "m2", uncertainty * 2),
            measurement("Bounding volume", width * height * depth, "m3", uncertainty * 3)
        ]
    }

    private static func measurement(
        _ label: String,
        _ value: Double,
        _ unit: String,
        _ uncertainty: Double
    ) -> [String: Any] {
        [
            "label": label,
            "value": value,
            "unit": unit,
            "uncertainty": uncertainty
        ]
    }

    private static func normalizedCoordinate(_ value: [String: Any]) -> [String: Any] {
        [
            "latitude": value["latitude"] as? Double ?? 0,
            "longitude": value["longitude"] as? Double ?? 0,
            "altitudeMeters": value["altitudeMeters"] ?? NSNull(),
            "horizontalAccuracyMeters": value["horizontalAccuracyMeters"] ?? NSNull(),
            "verticalAccuracyMeters": value["verticalAccuracyMeters"] ?? NSNull(),
            "headingDegrees": value["headingDegrees"] ?? NSNull()
        ]
    }
}

private extension ISO8601DateFormatter {
    static let aether: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private extension ARGeometrySource {
    func vertex(at index: Int) -> SIMD3<Float> {
        let pointer = buffer.contents()
            .advanced(by: offset + stride * index)
            .assumingMemoryBound(to: SIMD3<Float>.self)
        return pointer.pointee
    }
}

private extension ARGeometryElement {
    func indices(for primitiveIndex: Int) -> [Int] {
        let base = buffer.contents().advanced(
            by: primitiveIndex * indexCountPerPrimitive * bytesPerIndex
        )
        return (0..<indexCountPerPrimitive).map { index in
            let pointer = base.advanced(by: index * bytesPerIndex)
            if bytesPerIndex == MemoryLayout<UInt32>.size {
                return Int(pointer.assumingMemoryBound(to: UInt32.self).pointee)
            }
            return Int(pointer.assumingMemoryBound(to: UInt16.self).pointee)
        }
    }
}
