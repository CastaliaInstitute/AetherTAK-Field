import Foundation
import ZIPFoundation

struct TakEnrollmentMaterial {
    let name: String
    let host: String
    let port: UInt16
    let caData: Data
    let clientData: Data
    let caPassword: String
    let clientPassword: String
}

enum TakEnrollmentError: LocalizedError {
    case invalidPackage(String)

    var errorDescription: String? {
        switch self {
        case .invalidPackage(let message): return message
        }
    }
}

enum TakEnrollmentPackage {
    private static let maximumEntryBytes: UInt64 = 10 * 1024 * 1024
    private static let maximumPackageBytes = 25 * 1024 * 1024

    static func read(url: URL) throws -> TakEnrollmentMaterial {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let packageSize = (attributes[.size] as? NSNumber)?.intValue ?? 0
        guard packageSize <= maximumPackageBytes else {
            throw TakEnrollmentError.invalidPackage(
                "Enrollment package is too large."
            )
        }

        let archive = try Archive(url: url, accessMode: .read)
        var files: [String: Data] = [:]
        var totalSize: UInt64 = 0
        for entry in archive where entry.type == .file {
            guard entry.uncompressedSize <= maximumEntryBytes else {
                throw TakEnrollmentError.invalidPackage(
                    "Enrollment package entry is too large."
                )
            }
            totalSize += entry.uncompressedSize
            guard totalSize <= UInt64(maximumPackageBytes) else {
                throw TakEnrollmentError.invalidPackage(
                    "Enrollment package expands beyond its size limit."
                )
            }
            var data = Data()
            _ = try archive.extract(entry) { chunk in
                data.append(chunk)
            }
            files[basename(entry.path)] = data
        }

        guard let preferencesData = files["server.pref"] else {
            throw TakEnrollmentError.invalidPackage(
                "Enrollment package does not contain server.pref."
            )
        }
        let preferences = try PreferenceParser.parse(preferencesData)
        guard
            let connectString = preferences["connectString0"],
            let connection = parseConnection(connectString)
        else {
            throw TakEnrollmentError.invalidPackage(
                "Only certificate-authenticated SSL TAK streams are supported."
            )
        }
        guard
            let caLocation = preferences["caLocation"],
            let clientLocation = preferences["certificateLocation"],
            let caPassword = preferences["caPassword"],
            let clientPassword = preferences["clientPassword"],
            let caData = files[basename(caLocation)],
            let clientData = files[basename(clientLocation)]
        else {
            throw TakEnrollmentError.invalidPackage(
                "Enrollment package certificate material is incomplete."
            )
        }

        return TakEnrollmentMaterial(
            name: preferences["description0"] ?? "TAK Server",
            host: connection.host,
            port: connection.port,
            caData: caData,
            clientData: clientData,
            caPassword: caPassword,
            clientPassword: clientPassword
        )
    }

    private static func parseConnection(
        _ value: String
    ) -> (host: String, port: UInt16)? {
        let values = value.split(separator: ":", omittingEmptySubsequences: false)
        guard
            values.count == 3,
            values[2] == "ssl",
            let port = UInt16(values[1]),
            !values[0].isEmpty
        else {
            return nil
        }
        return (String(values[0]), port)
    }

    private static func basename(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/")
            .last
            .map(String.init) ?? ""
    }
}

private final class PreferenceParser: NSObject, XMLParserDelegate {
    private var values: [String: String] = [:]
    private var currentKey: String?
    private var currentValue = ""
    private var parseError: Error?

    static func parse(_ data: Data) throws -> [String: String] {
        let delegate = PreferenceParser()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse() else {
            throw delegate.parseError ?? parser.parserError ??
                TakEnrollmentError.invalidPackage(
                    "Enrollment preferences are invalid."
                )
        }
        return delegate.values
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        guard elementName == "entry" else { return }
        currentKey = attributeDict["key"]
        currentValue = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if currentKey != nil { currentValue += string }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        guard elementName == "entry", let key = currentKey else { return }
        values[key] = currentValue.trimmingCharacters(in: .whitespacesAndNewlines)
        currentKey = nil
        currentValue = ""
    }

    func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) {
        self.parseError = parseError
    }
}
