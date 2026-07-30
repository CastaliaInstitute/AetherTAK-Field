import CryptoKit
import Foundation
import Security

struct TakProfile: Codable {
    let id: String
    let name: String
    let host: String
    let port: UInt16
    let callsign: String
    let team: String
    let clientLabel: String
    let caLabel: String
}

enum TakIdentityError: LocalizedError {
    case security(String, OSStatus)
    case invalidIdentity(String)

    var errorDescription: String? {
        switch self {
        case .security(let operation, let status):
            let detail = SecCopyErrorMessageString(status, nil) as String? ??
                "OSStatus \(status)"
            return "\(operation): \(detail)"
        case .invalidIdentity(let message):
            return message
        }
    }
}

final class TakIdentityStore {
    private let profileKey = "org.castaliainstitute.aethertak.profile"

    func importMaterial(_ material: TakEnrollmentMaterial) throws -> TakProfile {
        let importedClient = try importIdentity(
            material.clientData,
            password: material.clientPassword
        )
        let identity = importedClient.identity
        let clientCertificate = try certificate(for: identity)
        let caCertificates = try importCertificates(
            material.caData,
            password: material.caPassword
        )
        guard let caCertificate = caCertificates.first else {
            throw TakIdentityError.invalidIdentity(
                "CA PKCS#12 contains no certificate."
            )
        }
        try validate(importedClient.chain, anchoredBy: caCertificate)
        let id = stableIdentifier(clientCertificate)
        let previous = loadProfile()
        let reusesClient = previous.map {
            certificateData(identity(label: $0.clientLabel)) ==
                SecCertificateCopyData(clientCertificate) as Data
        } ?? false
        let reusesCA = previous.map {
            certificate(label: $0.caLabel).map {
                SecCertificateCopyData($0) as Data
            } == SecCertificateCopyData(caCertificate) as Data
        } ?? false
        let rotation = UUID().uuidString.lowercased()
        let clientLabel = reusesClient
            ? previous!.clientLabel
            : "aethertak-client-\(id)-\(rotation)"
        let caLabel = reusesCA
            ? previous!.caLabel
            : "aethertak-ca-\(id)-\(rotation)"

        let profile = TakProfile(
            id: id,
            name: material.name,
            host: material.host,
            port: material.port,
            callsign: SecCertificateCopySubjectSummary(clientCertificate)
                as String? ?? "Aether Field",
            team: "Green",
            clientLabel: clientLabel,
            caLabel: caLabel
        )
        let encoded = try JSONEncoder().encode(profile)
        let previousData = UserDefaults.standard.data(forKey: profileKey)

        var stagedClient = false
        var stagedCA = false
        do {
            if !reusesClient {
                try addIdentity(identity, label: clientLabel)
                stagedClient = true
            }
            if !reusesCA {
                try addCertificate(caCertificate, label: caLabel)
                stagedCA = true
            }
            UserDefaults.standard.set(encoded, forKey: profileKey)
            guard UserDefaults.standard.synchronize() else {
                throw TakIdentityError.invalidIdentity(
                    "Unable to commit TAK enrollment metadata."
                )
            }
        } catch {
            if let previousData {
                UserDefaults.standard.set(previousData, forKey: profileKey)
            } else {
                UserDefaults.standard.removeObject(forKey: profileKey)
            }
            if stagedCA {
                deleteItem(class: kSecClassCertificate, label: caLabel)
            }
            if stagedClient {
                deleteItem(class: kSecClassIdentity, label: clientLabel)
            }
            throw error
        }

        if let previous {
            if previous.clientLabel != clientLabel {
                deleteItem(class: kSecClassIdentity, label: previous.clientLabel)
            }
            if previous.caLabel != caLabel {
                deleteItem(class: kSecClassCertificate, label: previous.caLabel)
            }
        }
        return profile
    }

    func loadProfile() -> TakProfile? {
        guard
            let data = UserDefaults.standard.data(forKey: profileKey),
            let profile = try? JSONDecoder().decode(TakProfile.self, from: data),
            identity(label: profile.clientLabel) != nil,
            certificate(label: profile.caLabel) != nil
        else {
            return nil
        }
        return profile
    }

    func identity(label: String) -> SecIdentity? {
        copyItem(class: kSecClassIdentity, label: label) as! SecIdentity?
    }

    func certificate(label: String) -> SecCertificate? {
        copyItem(class: kSecClassCertificate, label: label) as! SecCertificate?
    }

    func deleteProfile() {
        let profile = loadProfile()
        UserDefaults.standard.removeObject(forKey: profileKey)
        UserDefaults.standard.synchronize()
        if let profile {
            deleteItem(class: kSecClassIdentity, label: profile.clientLabel)
            deleteItem(class: kSecClassCertificate, label: profile.caLabel)
        }
    }

    private func importIdentity(
        _ data: Data,
        password: String
    ) throws -> (identity: SecIdentity, chain: [SecCertificate]) {
        let items = try importPKCS12(data, password: password)
        guard
            let dictionary = items.first as? [CFString: Any],
            let identity = dictionary[kSecImportItemIdentity] as! SecIdentity?
        else {
            throw TakIdentityError.invalidIdentity(
                "Client PKCS#12 contains no private identity."
            )
        }
        let leaf = try certificate(for: identity)
        let chain = dictionary[kSecImportItemCertChain] as? [SecCertificate]
            ?? [leaf]
        return (identity, chain)
    }

    private func importCertificates(
        _ data: Data,
        password: String
    ) throws -> [SecCertificate] {
        let items = try importPKCS12(data, password: password)
        return items.flatMap { item -> [SecCertificate] in
            guard let dictionary = item as? [CFString: Any] else { return [] }
            if let chain = dictionary[kSecImportItemCertChain] as? [SecCertificate] {
                return chain
            }
            if
                let identity = dictionary[kSecImportItemIdentity] as! SecIdentity?,
                let certificate = try? certificate(for: identity)
            {
                return [certificate]
            }
            return []
        }
    }

    private func importPKCS12(
        _ data: Data,
        password: String
    ) throws -> [CFTypeRef] {
        var result: CFArray?
        let status = SecPKCS12Import(
            data as CFData,
            [kSecImportExportPassphrase: password] as CFDictionary,
            &result
        )
        guard status == errSecSuccess else {
            throw TakIdentityError.security("PKCS#12 import failed", status)
        }
        return result as? [CFTypeRef] ?? []
    }

    private func certificate(for identity: SecIdentity) throws -> SecCertificate {
        var result: SecCertificate?
        let status = SecIdentityCopyCertificate(identity, &result)
        guard status == errSecSuccess, let result else {
            throw TakIdentityError.security(
                "Identity certificate access failed",
                status
            )
        }
        return result
    }

    private func certificateData(_ identity: SecIdentity?) -> Data? {
        guard
            let identity,
            let certificate = try? certificate(for: identity)
        else {
            return nil
        }
        return SecCertificateCopyData(certificate) as Data
    }

    private func validate(
        _ clientChain: [SecCertificate],
        anchoredBy ca: SecCertificate
    ) throws {
        guard !clientChain.isEmpty else {
            throw TakIdentityError.invalidIdentity(
                "Client certificate chain is empty."
            )
        }
        let includesAnchor = clientChain.contains {
            SecCertificateCopyData($0) as Data ==
                SecCertificateCopyData(ca) as Data
        }
        let certificates = clientChain + (includesAnchor ? [] : [ca])
        var trust: SecTrust?
        let status = SecTrustCreateWithCertificates(
            certificates as CFArray,
            SecPolicyCreateBasicX509(),
            &trust
        )
        guard status == errSecSuccess, let trust else {
            throw TakIdentityError.security(
                "Certificate-chain validation setup failed",
                status
            )
        }
        SecTrustSetAnchorCertificates(trust, [ca] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        var error: CFError?
        guard SecTrustEvaluateWithError(trust, &error) else {
            throw TakIdentityError.invalidIdentity(
                "Client certificate is expired or is not issued by the packaged TAK CA."
            )
        }
    }

    private func addIdentity(_ identity: SecIdentity, label: String) throws {
        let status = SecItemAdd([
            kSecClass: kSecClassIdentity,
            kSecValueRef: identity,
            kSecAttrLabel: label,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ] as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw TakIdentityError.security("Keychain identity storage failed", status)
        }
    }

    private func addCertificate(
        _ certificate: SecCertificate,
        label: String
    ) throws {
        let status = SecItemAdd([
            kSecClass: kSecClassCertificate,
            kSecValueRef: certificate,
            kSecAttrLabel: label,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ] as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw TakIdentityError.security(
                "Keychain CA certificate storage failed",
                status
            )
        }
    }

    private func copyItem(class itemClass: CFString, label: String) -> CFTypeRef? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass: itemClass,
            kSecAttrLabel: label,
            kSecReturnRef: true,
            kSecMatchLimit: kSecMatchLimitOne
        ] as CFDictionary, &result)
        return status == errSecSuccess ? result : nil
    }

    private func deleteItem(class itemClass: CFString, label: String) {
        SecItemDelete([
            kSecClass: itemClass,
            kSecAttrLabel: label
        ] as CFDictionary)
    }

    private func stableIdentifier(_ certificate: SecCertificate) -> String {
        let digest = SHA256.hash(
            data: SecCertificateCopyData(certificate) as Data
        )
        var bytes = Array(digest.prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x50
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        let value = bytes.map {
            String(format: "%02x", $0)
        }.joined()
        return [
            String(value.prefix(8)),
            String(value.dropFirst(8).prefix(4)),
            String(value.dropFirst(12).prefix(4)),
            String(value.dropFirst(16).prefix(4)),
            String(value.dropFirst(20))
        ].joined(separator: "-")
    }
}
