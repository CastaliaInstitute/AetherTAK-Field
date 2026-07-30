import Foundation

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
}

let directory = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
try FileManager.default.createDirectory(
    at: directory,
    withIntermediateDirectories: true
)
defer { try? FileManager.default.removeItem(at: directory) }

let media = directory.appendingPathComponent("capture.mp4")
try Data("abc".utf8).write(to: media)
let result = try inspectMediaFile(at: media)
expect(result.sizeBytes == 3, "Expected the streamed byte count.")
expect(
    result.sha256 == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "Expected the SHA-256 digest for abc."
)

let empty = directory.appendingPathComponent("empty.mp4")
try Data().write(to: empty)
do {
    _ = try inspectMediaFile(at: empty)
    fatalError("Expected empty media to be rejected.")
} catch MediaIntegrityError.emptyFile {
    // Expected.
}

print("Media integrity tests passed")
