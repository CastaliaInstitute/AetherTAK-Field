import Foundation

private let maximumCotXmlBytes = 1024 * 1024
private let maximumCotStartTagCharacters = 64 * 1024

func cotAttribute(
    _ xml: String,
    tag: String,
    name: String
) -> String? {
    guard xml.utf8.count <= maximumCotXmlBytes else { return nil }

    let escapedTag = NSRegularExpression.escapedPattern(for: tag)
    let tagPattern = "<\(escapedTag)(?=\\s|/?>)[^>]{0,\(maximumCotStartTagCharacters)}>"
    guard
        let tagRegex = try? NSRegularExpression(pattern: tagPattern),
        let tagMatch = tagRegex.firstMatch(
            in: xml,
            range: NSRange(xml.startIndex..., in: xml)
        ),
        let tagRange = Range(tagMatch.range, in: xml)
    else {
        return nil
    }

    let startTag = String(xml[tagRange])
    let escapedName = NSRegularExpression.escapedPattern(for: name)
    for pattern in [
        "\\s\(escapedName)\\s*=\\s*\"([^\"]*)\"",
        "\\s\(escapedName)\\s*=\\s*'([^']*)'"
    ] {
        guard
            let attributeRegex = try? NSRegularExpression(pattern: pattern),
            let match = attributeRegex.firstMatch(
                in: startTag,
                range: NSRange(startTag.startIndex..., in: startTag)
            ),
            let valueRange = Range(match.range(at: 1), in: startTag)
        else {
            continue
        }
        return decodeXmlAttribute(String(startTag[valueRange]))
    }
    return nil
}

private func decodeXmlAttribute(_ value: String) -> String? {
    var decoded = ""
    var index = value.startIndex

    while index < value.endIndex {
        guard value[index] == "&" else {
            decoded.append(value[index])
            index = value.index(after: index)
            continue
        }
        guard
            let semicolon = value[index...].firstIndex(of: ";"),
            value.distance(from: index, to: semicolon) <= 12
        else {
            return nil
        }
        let tokenStart = value.index(after: index)
        let token = String(value[tokenStart..<semicolon])
        guard let scalar = scalar(forXmlEntity: token) else { return nil }
        decoded.unicodeScalars.append(scalar)
        index = value.index(after: semicolon)
    }

    guard decoded.unicodeScalars.allSatisfy({
        isValidXmlScalar(UInt32($0.value))
    }) else {
        return nil
    }
    return decoded
}

private func scalar(forXmlEntity token: String) -> UnicodeScalar? {
    switch token {
    case "amp": return UnicodeScalar(0x26)
    case "lt": return UnicodeScalar(0x3C)
    case "gt": return UnicodeScalar(0x3E)
    case "quot": return UnicodeScalar(0x22)
    case "apos": return UnicodeScalar(0x27)
    default:
        let value: UInt32?
        if token.hasPrefix("#x") {
            value = UInt32(token.dropFirst(2), radix: 16)
        } else if token.hasPrefix("#") {
            value = UInt32(token.dropFirst(), radix: 10)
        } else {
            return nil
        }
        guard
            let value,
            isValidXmlScalar(value),
            let scalar = UnicodeScalar(value)
        else {
            return nil
        }
        return scalar
    }
}

private func isValidXmlScalar(_ value: UInt32) -> Bool {
    value == 0x9 ||
        value == 0xA ||
        value == 0xD ||
        (0x20...0xD7FF).contains(value) ||
        (0xE000...0xFFFD).contains(value) ||
        (0x10000...0x10FFFF).contains(value)
}
