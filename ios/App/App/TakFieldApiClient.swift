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
    private let maximumMissionPackageBytes = 25 * 1024 * 1024

    init(identityStore: TakIdentityStore) {
        self.identityStore = identityStore
    }

    func health(
        profile: TakProfile,
        port: Int,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        do {
            try perform(
                profile: profile,
                port: port,
                method: "GET",
                path: "/healthz",
                completion: completion
            )
        } catch {
            completion(.failure(error))
        }
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
                    var mediaDirectoryValues = URLResourceValues()
                    mediaDirectoryValues.isExcludedFromBackup = true
                    var protectedMediaDirectory = directory
                    try protectedMediaDirectory.setResourceValues(
                        mediaDirectoryValues
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

    func uploadMissionPackage(
        profile: TakProfile,
        port: Int,
        uri: String,
        fileName: String,
        creatorUid: String,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        do {
            try validateMissionFileName(fileName)
            guard
                creatorUid.range(
                    of: #"^[A-Za-z0-9._:-]{1,160}$"#,
                    options: .regularExpression
                ) != nil
            else {
                throw FieldApiError.invalidRequest(
                    "A valid TAK creator UID is required."
                )
            }
            let fileURL = try localFileURL(uri)
            let values = try fileURL.resourceValues(forKeys: [.fileSizeKey])
            guard
                let size = values.fileSize,
                (1...maximumMissionPackageBytes).contains(size)
            else {
                throw FieldApiError.invalidRequest(
                    "Mission packages must be between 1 byte and 25 MiB."
                )
            }
            try validateMissionContainer(fileURL)
            let checksum = try sha256(fileURL)
            var request = URLRequest(
                url: try missionEndpoint(
                    profile,
                    port: port,
                    path: "/Marti/sync/missionquery",
                    query: [URLQueryItem(name: "hash", value: checksum)]
                )
            )
            request.httpMethod = "GET"
            request.timeoutInterval = 60
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.setValue("text/plain", forHTTPHeaderField: "Accept")
            let session = try authenticatedSession(profile)
            session.dataTask(with: request) { data, response, error in
                defer { session.finishTasksAndInvalidate() }
                do {
                    if let error { throw error }
                    guard
                        let response = response as? HTTPURLResponse,
                        let data,
                        data.count <= 16 * 1024
                    else {
                        throw FieldApiError.invalidResponse
                    }
                    if (200...299).contains(response.statusCode) {
                        guard let senderURL = String(data: data, encoding: .utf8) else {
                            throw FieldApiError.invalidResponse
                        }
                        try self.completeMissionUpload(
                            profile: profile,
                            port: port,
                            senderURL: senderURL,
                            checksum: checksum,
                            size: size,
                            completion: completion
                        )
                    } else if response.statusCode == 404 {
                        try self.performMissionUpload(
                            profile: profile,
                            port: port,
                            fileURL: fileURL,
                            fileName: fileName,
                            creatorUid: creatorUid,
                            checksum: checksum,
                            size: size,
                            completion: completion
                        )
                    } else {
                        throw FieldApiError.invalidRequest(
                            "TAK Server mission query returned HTTP \(response.statusCode)."
                        )
                    }
                } catch {
                    completion(.failure(error))
                }
            }.resume()
        } catch {
            completion(.failure(error))
        }
    }

    func downloadMissionPackage(
        profile: TakProfile,
        port: Int,
        senderURL: String,
        fileName: String,
        expectedSha256: String,
        expectedSizeBytes: Int,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) {
        do {
            try validateMissionFileName(fileName)
            guard
                expectedSha256.range(
                    of: #"^[0-9a-fA-F]{64}$"#,
                    options: .regularExpression
                ) != nil
            else {
                throw FieldApiError.invalidRequest(
                    "A valid mission-package SHA-256 digest is required."
                )
            }
            guard
                (1...maximumMissionPackageBytes).contains(expectedSizeBytes)
            else {
                throw FieldApiError.invalidRequest(
                    "Mission package size is invalid or exceeds 25 MiB."
                )
            }
            let source = try validateMissionURL(
                profile,
                port: port,
                value: senderURL
            )
            var request = URLRequest(url: source)
            request.httpMethod = "GET"
            request.timeoutInterval = 300
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.setValue(
                "application/zip, application/x-zip-compressed",
                forHTTPHeaderField: "Accept"
            )
            let session = try authenticatedSession(profile)
            session.downloadTask(with: request) { temporaryURL, response, error in
                defer { session.finishTasksAndInvalidate() }
                do {
                    if let error { throw error }
                    guard
                        let response = response as? HTTPURLResponse,
                        (200...299).contains(response.statusCode),
                        let temporaryURL
                    else {
                        throw FieldApiError.invalidResponse
                    }
                    if
                        let length = response.value(
                            forHTTPHeaderField: "Content-Length"
                        ),
                        let parsed = Int(length),
                        parsed != expectedSizeBytes
                    {
                        throw FieldApiError.invalidRequest(
                            "Mission package Content-Length does not match the CoT request."
                        )
                    }
                    let values = try temporaryURL.resourceValues(
                        forKeys: [.fileSizeKey]
                    )
                    guard values.fileSize == expectedSizeBytes else {
                        throw FieldApiError.invalidRequest(
                            "Mission package ended before its declared size."
                        )
                    }
                    let actualSha256 = try self.sha256(temporaryURL)
                    guard actualSha256 == expectedSha256.lowercased() else {
                        throw FieldApiError.invalidRequest(
                            "Mission package SHA-256 verification failed."
                        )
                    }
                    try self.validateMissionContainer(temporaryURL)
                    let fileManager = FileManager.default
                    let applicationSupport = try fileManager.url(
                        for: .applicationSupportDirectory,
                        in: .userDomainMask,
                        appropriateFor: nil,
                        create: true
                    )
                    let directory = applicationSupport
                        .appendingPathComponent("AetherTAK", isDirectory: true)
                        .appendingPathComponent(
                            "MissionPackages",
                            isDirectory: true
                        )
                    try fileManager.createDirectory(
                        at: directory,
                        withIntermediateDirectories: true,
                        attributes: [
                            .protectionKey:
                                FileProtectionType
                                .completeUntilFirstUserAuthentication
                        ]
                    )
                    var packageDirectoryValues = URLResourceValues()
                    packageDirectoryValues.isExcludedFromBackup = true
                    var protectedPackageDirectory = directory
                    try protectedPackageDirectory.setResourceValues(
                        packageDirectoryValues
                    )
                    let staged = directory.appendingPathComponent(
                        ".\(fileName)-\(UUID().uuidString).part"
                    )
                    let destination = directory.appendingPathComponent(
                        "\(actualSha256.prefix(12))-\(fileName)"
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
                                    "localUri": destination.absoluteString,
                                    "sha256": actualSha256,
                                    "sizeBytes": expectedSizeBytes,
                                    "fileName": fileName
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

    private func performMissionUpload(
        profile: TakProfile,
        port: Int,
        fileURL: URL,
        fileName: String,
        creatorUid: String,
        checksum: String,
        size: Int,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) throws {
        let boundary = "AetherTAK-\(UUID().uuidString)"
        var body = Data()
        body.append(
            Data(
                (
                    "--\(boundary)\r\n" +
                    "Content-Disposition: form-data; name=\"assetfile\"; filename=\"\(fileName)\"\r\n" +
                    "Content-Type: application/x-zip-compressed\r\n\r\n"
                ).utf8
            )
        )
        body.append(try Data(contentsOf: fileURL, options: [.mappedIfSafe]))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(
            url: try missionEndpoint(
                profile,
                port: port,
                path: "/Marti/sync/missionupload",
                query: [
                    URLQueryItem(name: "hash", value: checksum),
                    URLQueryItem(name: "filename", value: fileName),
                    URLQueryItem(name: "creatorUid", value: creatorUid)
                ]
            )
        )
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue("text/plain", forHTTPHeaderField: "Accept")
        let session = try authenticatedSession(profile)
        session.uploadTask(with: request, from: body) {
            data,
            response,
            error in
            defer { session.finishTasksAndInvalidate() }
            do {
                if let error { throw error }
                guard
                    let response = response as? HTTPURLResponse,
                    (200...299).contains(response.statusCode),
                    let data,
                    data.count <= 16 * 1024,
                    let senderURL = String(data: data, encoding: .utf8)
                else {
                    throw FieldApiError.invalidResponse
                }
                try self.completeMissionUpload(
                    profile: profile,
                    port: port,
                    senderURL: senderURL,
                    checksum: checksum,
                    size: size,
                    completion: completion
                )
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    private func completeMissionUpload(
        profile: TakProfile,
        port: Int,
        senderURL: String,
        checksum: String,
        size: Int,
        completion: @escaping (Result<FieldApiResponse, Error>) -> Void
    ) throws {
        let validated = try validateMissionURL(
            profile,
            port: port,
            value: senderURL
        )
        setMissionPackagePrivate(
            profile: profile,
            port: port,
            checksum: checksum
        )
        completion(
            .success(
                FieldApiResponse(
                    status: 200,
                    body: [
                        "senderUrl": validated.absoluteString,
                        "sha256": checksum,
                        "sizeBytes": size
                    ]
                )
            )
        )
    }

    private func setMissionPackagePrivate(
        profile: TakProfile,
        port: Int,
        checksum: String
    ) {
        do {
            var request = URLRequest(
                url: try missionEndpoint(
                    profile,
                    port: port,
                    path: "/Marti/api/sync/metadata/\(checksum)/tool"
                )
            )
            request.httpMethod = "PUT"
            request.httpBody = Data("private".utf8)
            request.timeoutInterval = 30
            request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
            let session = try authenticatedSession(profile)
            session.dataTask(with: request) { _, _, _ in
                session.finishTasksAndInvalidate()
            }.resume()
        } catch {
            // Older TAK Server versions may not expose metadata/tool.
        }
    }

    private func validateMissionFileName(_ value: String) throws {
        guard
            value.range(
                of: #"^[A-Za-z0-9._-]{1,128}\.zip$"#,
                options: [.regularExpression, .caseInsensitive]
            ) != nil
        else {
            throw FieldApiError.invalidRequest(
                "A safe mission-package ZIP filename is required."
            )
        }
    }

    private func validateMissionContainer(_ url: URL) throws {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard
            data.count >= 4,
            data[0] == 0x50,
            data[1] == 0x4b,
            (
                (data[2] == 0x03 && data[3] == 0x04) ||
                (data[2] == 0x05 && data[3] == 0x06) ||
                (data[2] == 0x07 && data[3] == 0x08)
            ),
            data.range(of: Data("MANIFEST/manifest.xml".utf8)) != nil
        else {
            throw FieldApiError.invalidRequest(
                "The ZIP has no MANIFEST/manifest.xml and is not a TAK mission package."
            )
        }
    }

    private func missionEndpoint(
        _ profile: TakProfile,
        port: Int,
        path: String,
        query: [URLQueryItem] = []
    ) throws -> URL {
        guard (1...65535).contains(port) else {
            throw FieldApiError.invalidRequest(
                "Invalid TAK mission-package port."
            )
        }
        var components = URLComponents()
        components.scheme = "https"
        components.host = profile.host
        components.port = port
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else {
            throw FieldApiError.invalidRequest(
                "Invalid TAK mission-package URL."
            )
        }
        return url
    }

    private func validateMissionURL(
        _ profile: TakProfile,
        port: Int,
        value: String
    ) throws -> URL {
        guard
            let url = URL(
                string: value.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
            ),
            url.scheme?.lowercased() == "https",
            url.host?.lowercased() == profile.host.lowercased(),
            url.port == port,
            url.path.hasPrefix("/Marti/")
        else {
            throw FieldApiError.invalidRequest(
                "TAK mission-package URL does not match the enrolled Marti server."
            )
        }
        return url
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
