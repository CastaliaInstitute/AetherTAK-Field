import CryptoKit
import Foundation
import Security

struct FieldApiResponse {
    let status: Int
    let body: [String: Any]
}

enum FieldApiError: LocalizedError {
    case invalidRequest(String)
    case invalidResponse
    case identityUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message): return message
        case .invalidResponse: return "Aether Field API returned an invalid response."
        case .identityUnavailable: return "The enrolled TAK identity is unavailable."
        }
    }
}

final class TakFieldApiClient {
    private let identityStore: TakIdentityStore

    init(identityStore: TakIdentityStore) {
        self.identityStore = identityStore
    }

    func mutate(
        profile: TakProfile,
        port: Int,
        mutation: [String: Any],
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        do {
            let body = try JSONSerialization.data(
                withJSONObject: mutation,
                options: [.sortedKeys]
            )
            try perform(
                profile: profile,
                port: port,
                method: "POST",
                path: "/v1/mutations",
                body: body,
                contentType: "application/json",
                completion: completion
            )
        } catch {
            completion(.failure(error))
        }
    }

    func changes(
        profile: TakProfile,
        port: Int,
        cursor: Int,
        limit: Int,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        do {
            try perform(
                profile: profile,
                port: port,
                method: "GET",
                path: "/v1/changes?cursor=\(cursor)&limit=\(limit)",
                completion: completion
            )
        } catch {
            completion(.failure(error))
        }
    }

    func upload(
        profile: TakProfile,
        port: Int,
        mediaId: String,
        uri: String,
        contentType: String,
        observationId: String?,
        role: String?,
        suppliedSha256: String?,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        do {
            guard
                mediaId.range(
                    of: #"^[A-Za-z0-9._-]{1,128}$"#,
                    options: .regularExpression
                ) != nil
            else {
                throw FieldApiError.invalidRequest("Invalid media ID.")
            }
            let fileURL = try localFileURL(uri)
            let values = try fileURL.resourceValues(forKeys: [.fileSizeKey])
            guard
                let size = values.fileSize,
                size >= 0,
                size <= 512 * 1024 * 1024
            else {
                throw FieldApiError.invalidRequest(
                    "Media size is unavailable or exceeds 512 MiB."
                )
            }
            let checksum: String
            if
                let suppliedSha256,
                suppliedSha256.range(
                    of: #"^[0-9a-fA-F]{64}$"#,
                    options: .regularExpression
                ) != nil
            {
                checksum = suppliedSha256.lowercased()
            } else {
                checksum = try sha256(fileURL)
            }
            let escapedId = mediaId.addingPercentEncoding(
                withAllowedCharacters: .urlPathAllowed
            ) ?? mediaId
            var headers = [
                "Content-Type": contentType,
                "X-Aether-Sha256": checksum
            ]
            if let observationId {
                headers["X-Aether-Observation-Id"] = observationId
            }
            if let role {
                headers["X-Aether-Role"] = role
            }
            try performUpload(
                profile: profile,
                port: port,
                path: "/v1/media/\(escapedId)",
                fileURL: fileURL,
                headers: headers,
                completion: completion
            )
        } catch {
            completion(.failure(error))
        }
    }

    func download(
        profile: TakProfile,
        port: Int,
        mediaId: String,
        expectedSha256: String?,
        expectedContentType: String?,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        do {
            guard
                mediaId.range(
                    of: #"^[A-Za-z0-9._-]{1,128}$"#,
                    options: .regularExpression
                ) != nil
            else {
                throw FieldApiError.invalidRequest("Invalid media ID.")
            }
            let escapedId = mediaId.addingPercentEncoding(
                withAllowedCharacters: .urlPathAllowed
            ) ?? mediaId
            var request = URLRequest(
                url: try endpoint(
                    profile,
                    port: port,
                    path: "/v1/media/\(escapedId)"
                )
            )
            request.httpMethod = "GET"
            request.timeoutInterval = 300
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.setValue(
                "application/octet-stream",
                forHTTPHeaderField: "Accept"
            )
            let session = try authenticatedSession(profile)
            session.downloadTask(with: request) { temporaryURL, response, error in
                defer { session.finishTasksAndInvalidate() }
                do {
                    if let error { throw error }
                    guard let response = response as? HTTPURLResponse else {
                        throw FieldApiError.invalidResponse
                    }
                    guard let temporaryURL else {
                        throw FieldApiError.invalidResponse
                    }
                    if !(200...299).contains(response.statusCode) {
                        let data = try Data(contentsOf: temporaryURL)
                        let body =
                            (try? JSONSerialization.jsonObject(with: data))
                            as? [String: Any]
                            ?? [
                                "error": [
                                    "code": "INVALID_RESPONSE",
                                    "message": "Aether Field API returned HTTP \(response.statusCode)."
                                ]
                            ]
                        completion(
                            .success(
                                FieldApiResponse(
                                    status: response.statusCode,
                                    body: body
                                )
                            )
                        )
                        return
                    }

                    guard
                        let lengthValue = response.value(
                            forHTTPHeaderField: "Content-Length"
                        ),
                        let expectedLength = Int64(lengthValue),
                        (0...(512 * 1024 * 1024)).contains(expectedLength)
                    else {
                        throw FieldApiError.invalidRequest(
                            "Downloaded media size is unavailable or exceeds 512 MiB."
                        )
                    }
                    guard
                        let checksum = response.value(
                            forHTTPHeaderField: "X-Aether-Sha256"
                        )?.lowercased(),
                        checksum.range(
                            of: #"^[0-9a-f]{64}$"#,
                            options: .regularExpression
                        ) != nil
                    else {
                        throw FieldApiError.invalidResponse
                    }
                    if let expectedSha256 {
                        guard checksum == expectedSha256.lowercased() else {
                            throw FieldApiError.invalidRequest(
                                "The media response digest does not match its field record."
                            )
                        }
                    }
                    let contentType = (
                        response.value(forHTTPHeaderField: "Content-Type")
                            ?? "application/octet-stream"
                    )
                    .split(separator: ";", maxSplits: 1)
                    .first?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased() ?? "application/octet-stream"
                    if let expectedContentType {
                        let normalizedExpected = expectedContentType
                            .split(separator: ";", maxSplits: 1)
                            .first?
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                            .lowercased()
                        guard normalizedExpected == contentType else {
                            throw FieldApiError.invalidRequest(
                                "The media response content type does not match its field record."
                            )
                        }
                    }
                    let values = try temporaryURL.resourceValues(
                        forKeys: [.fileSizeKey]
                    )
                    guard Int64(values.fileSize ?? -1) == expectedLength else {
                        throw FieldApiError.invalidResponse
                    }
                    let actualSha256 = try self.sha256(temporaryURL)
                    guard actualSha256 == checksum else {
                        throw FieldApiError.invalidRequest(
                            "The downloaded media SHA-256 does not match the server digest."
                        )
                    }

                    let fileManager = FileManager.default
                    let applicationSupport = try fileManager.url(
                        for: .applicationSupportDirectory,
                        in: .userDomainMask,
                        appropriateFor: nil,
                        create: true
                    )
                    let directory = applicationSupport
                        .appendingPathComponent("AetherTAK", isDirectory: true)
                        .appendingPathComponent("FieldMedia", isDirectory: true)
                    try fileManager.createDirectory(
                        at: directory,
                        withIntermediateDirectories: true,
                        attributes: [
                            .protectionKey:
                                FileProtectionType
                                .completeUntilFirstUserAuthentication
                        ]
                    )
                    let staged = directory.appendingPathComponent(
                        ".\(mediaId)-\(UUID().uuidString).part"
                    )
                    let destination = directory.appendingPathComponent(
                        "\(mediaId)\(self.mediaExtension(contentType))"
                    )
                    try fileManager.copyItem(at: temporaryURL, to: staged)
                    do {
                        try fileManager.setAttributes(
                            [
                                .protectionKey:
                                    FileProtectionType
                                    .completeUntilFirstUserAuthentication
                            ],
                            ofItemAtPath: staged.path
                        )
                        if fileManager.fileExists(atPath: destination.path) {
                            _ = try fileManager.replaceItemAt(
                                destination,
                                withItemAt: staged
                            )
                        } else {
                            try fileManager.moveItem(
                                at: staged,
                                to: destination
                            )
                        }
                    } catch {
                        try? fileManager.removeItem(at: staged)
                        throw error
                    }
                    completion(
                        .success(
                            FieldApiResponse(
                                status: response.statusCode,
                                body: [
                                    "mediaId": mediaId,
                                    "localUri": destination.absoluteString,
                                    "sha256": actualSha256,
                                    "sizeBytes": expectedLength,
                                    "contentType": contentType
                                ]
                            )
                        )
                    )
                } catch {
                    completion(.failure(error))
                }
            }.resume()
        } catch {
            completion(.failure(error))
        }
    }

    private func perform(
        profile: TakProfile,
        port: Int,
        method: String,
        path: String,
        body: Data? = nil,
        contentType: String? = nil,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) throws {
        var request = URLRequest(url: try endpoint(profile, port: port, path: path))
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 60
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let session = try authenticatedSession(profile)
        session.dataTask(with: request) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            Self.complete(data: data, response: response, error: error, completion: completion)
        }.resume()
    }

    private func performUpload(
        profile: TakProfile,
        port: Int,
        path: String,
        fileURL: URL,
        headers: [String: String],
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) throws {
        var request = URLRequest(url: try endpoint(profile, port: port, path: path))
        request.httpMethod = "PUT"
        request.timeoutInterval = 300
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let session = try authenticatedSession(profile)
        session.uploadTask(with: request, fromFile: fileURL) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            Self.complete(data: data, response: response, error: error, completion: completion)
        }.resume()
    }

    private func authenticatedSession(_ profile: TakProfile) throws -> URLSession {
        guard
            let identity = identityStore.identity(label: profile.clientLabel),
            let anchor = identityStore.certificate(label: profile.caLabel)
        else {
            throw FieldApiError.identityUnavailable
        }
        let delegate = FieldApiSessionDelegate(
            identity: identity,
            anchor: anchor,
            host: profile.host
        )
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        return URLSession(
            configuration: configuration,
            delegate: delegate,
            delegateQueue: nil
        )
    }

    private func endpoint(_ profile: TakProfile, port: Int, path: String) throws -> URL {
        guard (1...65535).contains(port) else {
            throw FieldApiError.invalidRequest("Invalid Aether Field API port.")
        }
        var components = URLComponents()
        components.scheme = "https"
        components.host = profile.host
        components.port = port
        if let queryStart = path.firstIndex(of: "?") {
            components.path = String(path[..<queryStart])
            components.percentEncodedQuery = String(path[path.index(after: queryStart)...])
        } else {
            components.path = path
        }
        guard let url = components.url else {
            throw FieldApiError.invalidRequest("Invalid Aether Field API URL.")
        }
        return url
    }

    private func localFileURL(_ value: String) throws -> URL {
        if let url = URL(string: value), url.isFileURL {
            return url
        }
        if value.hasPrefix("/") {
            return URL(fileURLWithPath: value)
        }
        throw FieldApiError.invalidRequest("Only app-private file URIs can be uploaded.")
    }

    private func sha256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var digest = SHA256()
        while true {
            let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
            if data.isEmpty { break }
            digest.update(data: data)
        }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func mediaExtension(_ contentType: String) -> String {
        switch contentType {
        case "image/jpeg": return ".jpg"
        case "video/mp4": return ".mp4"
        case "model/ply": return ".ply"
        case "model/obj": return ".obj"
        case "application/x-aether-depth-f32le": return ".f32le"
        case "application/x-aether-depth-u16le": return ".u16le"
        case "application/x-aether-depth-confidence": return ".u8"
        default: return ".bin"
        }
    }

    private static func complete(
        data: Data?,
        response: URLResponse?,
        error: Error?,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        if let error {
            completion(.failure(error))
            return
        }
        guard
            let response = response as? HTTPURLResponse,
            let data,
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            completion(.failure(FieldApiError.invalidResponse))
            return
        }
        completion(.success(FieldApiResponse(status: response.statusCode, body: body)))
    }
}

private final class FieldApiSessionDelegate: NSObject, URLSessionDelegate {
    private let identity: SecIdentity
    private let anchor: SecCertificate
    private let host: String

    init(identity: SecIdentity, anchor: SecCertificate, host: String) {
        self.identity = identity
        self.anchor = anchor
        self.host = host
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (
            URLSession.AuthChallengeDisposition,
            URLCredential?
        ) -> Void
    ) {
        switch challenge.protectionSpace.authenticationMethod {
        case NSURLAuthenticationMethodClientCertificate:
            completionHandler(
                .useCredential,
                URLCredential(
                    identity: identity,
                    certificates: nil,
                    persistence: .forSession
                )
            )
        case NSURLAuthenticationMethodServerTrust:
            guard let trust = challenge.protectionSpace.serverTrust else {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
            SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString))
            SecTrustSetAnchorCertificates(trust, [anchor] as CFArray)
            SecTrustSetAnchorCertificatesOnly(trust, true)
            if SecTrustEvaluateWithError(trust, nil) {
                completionHandler(.useCredential, URLCredential(trust: trust))
            } else {
                completionHandler(.cancelAuthenticationChallenge, nil)
            }
        default:
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
