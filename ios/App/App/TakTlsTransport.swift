import Foundation
import Network
import Security

final class TakTlsTransport {
    private let identityStore: TakIdentityStore
    private let queue = DispatchQueue(label: "org.castaliainstitute.aethertak.tls")
    private let onEvent: (String) -> Void
    private let onDisconnected: (String?) -> Void
    private var connection: NWConnection?
    private var pending = Data()
    private(set) var connectedAt: Date?

    var isConnected: Bool {
        connection != nil && connectedAt != nil
    }

    init(
        identityStore: TakIdentityStore,
        onEvent: @escaping (String) -> Void,
        onDisconnected: @escaping (String?) -> Void
    ) {
        self.identityStore = identityStore
        self.onEvent = onEvent
        self.onDisconnected = onDisconnected
    }

    func connect(
        profile: TakProfile,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        disconnect()
        guard
            let identity = identityStore.identity(label: profile.clientLabel),
            let anchor = identityStore.certificate(label: profile.caLabel),
            let port = NWEndpoint.Port(rawValue: profile.port)
        else {
            completion(.failure(
                TakIdentityError.invalidIdentity(
                    "The enrolled TAK identity is unavailable."
                )
            ))
            return
        }

        let tls = NWProtocolTLS.Options()
        if let localIdentity = sec_identity_create(identity) {
            sec_protocol_options_set_local_identity(
                tls.securityProtocolOptions,
                localIdentity
            )
        }
        sec_protocol_options_set_min_tls_protocol_version(
            tls.securityProtocolOptions,
            .TLSv12
        )
        sec_protocol_options_set_verify_block(
            tls.securityProtocolOptions,
            { _, trust, complete in
                let secTrust = sec_trust_copy_ref(trust).takeRetainedValue()
                SecTrustSetPolicies(
                    secTrust,
                    SecPolicyCreateSSL(true, profile.host as CFString)
                )
                SecTrustSetAnchorCertificates(
                    secTrust,
                    [anchor] as CFArray
                )
                SecTrustSetAnchorCertificatesOnly(secTrust, true)
                complete(SecTrustEvaluateWithError(secTrust, nil))
            },
            queue
        )

        let active = NWConnection(
            host: NWEndpoint.Host(profile.host),
            port: port,
            using: NWParameters(tls: tls)
        )
        var completionPending = true
        active.stateUpdateHandler = { [weak self, weak active] state in
            guard let self, let active else { return }
            switch state {
            case .ready:
                self.connectedAt = Date()
                if completionPending {
                    completionPending = false
                    completion(.success(()))
                }
                self.receive(from: active)
            case .failed(let error):
                self.connectedAt = nil
                self.connection = nil
                if completionPending {
                    completionPending = false
                    completion(.failure(error))
                } else {
                    self.onDisconnected(error.localizedDescription)
                }
            case .cancelled:
                self.connectedAt = nil
                self.connection = nil
            default:
                break
            }
        }
        connection = active
        active.start(queue: queue)
    }

    func send(
        xml: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard
            xml.hasPrefix("<event"),
            xml.hasSuffix("</event>"),
            let connection,
            isConnected
        else {
            completion(.failure(
                TakEnrollmentError.invalidPackage(
                    "TAK transport is disconnected or the CoT event is invalid."
                )
            ))
            return
        }
        connection.send(
            content: Data((xml + "\n").utf8),
            completion: .contentProcessed { error in
                if let error {
                    completion(.failure(error))
                } else {
                    completion(.success(()))
                }
            }
        )
    }

    func disconnect() {
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        connectedAt = nil
        pending.removeAll(keepingCapacity: false)
    }

    private func receive(from active: NWConnection) {
        active.receive(
            minimumIncompleteLength: 1,
            maximumLength: 64 * 1024
        ) { [weak self, weak active] data, _, complete, error in
            guard let self, let active else { return }
            if let data, !data.isEmpty {
                self.pending.append(data)
                if self.pending.count > 2 * 1024 * 1024 {
                    active.cancel()
                    self.onDisconnected("Incoming TAK event exceeded the buffer limit.")
                    return
                }
                self.consumeEvents()
            }
            if let error {
                self.onDisconnected(error.localizedDescription)
                active.cancel()
                return
            }
            if complete {
                self.onDisconnected(nil)
                active.cancel()
                return
            }
            self.receive(from: active)
        }
    }

    private func consumeEvents() {
        let terminator = Data("</event>".utf8)
        while let range = pending.range(of: terminator) {
            let end = range.upperBound
            let candidate = pending.subdata(in: pending.startIndex..<end)
            pending.removeSubrange(pending.startIndex..<end)
            guard
                let xml = String(data: candidate, encoding: .utf8),
                let start = xml.range(of: "<event")
            else {
                continue
            }
            onEvent(String(xml[start.lowerBound...]))
        }
    }
}
