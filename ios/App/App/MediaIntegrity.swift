import CryptoKit
import Foundation

struct MediaFileIntegrity: Equatable {
    let sha256: String
    let sizeBytes: Int64
}

enum MediaIntegrityError: LocalizedError {
    case emptyFile
    case invalidSize

    var errorDescription: String? {
        switch self {
        case .emptyFile:
            return "The captured media file is empty."
        case .invalidSize:
            return "The captured media file is too large to inspect safely."
        }
    }
}

func inspectMediaFile(at url: URL) throws -> MediaFileIntegrity {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }

    var digest = SHA256()
    var sizeBytes: Int64 = 0
    while true {
        let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
        if data.isEmpty { break }
        guard sizeBytes <= Int64.max - Int64(data.count) else {
            throw MediaIntegrityError.invalidSize
        }
        sizeBytes += Int64(data.count)
        digest.update(data: data)
    }
    guard sizeBytes > 0 else {
        throw MediaIntegrityError.emptyFile
    }

    return MediaFileIntegrity(
        sha256: digest.finalize()
            .map { String(format: "%02x", $0) }
            .joined(),
        sizeBytes: sizeBytes
    )
}
