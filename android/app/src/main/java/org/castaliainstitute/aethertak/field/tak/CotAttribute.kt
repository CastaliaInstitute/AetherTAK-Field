package org.castaliainstitute.aethertak.field.tak

private const val MAXIMUM_COT_XML_BYTES = 1024 * 1024
private const val MAXIMUM_COT_START_TAG_CHARACTERS = 64 * 1024

fun cotAttribute(xml: String, tag: String, name: String): String? {
    if (xml.toByteArray(Charsets.UTF_8).size > MAXIMUM_COT_XML_BYTES) return null

    val escapedTag = Regex.escape(tag)
    val startTag = Regex(
        "<$escapedTag(?=\\s|/?>)[^>]{0,$MAXIMUM_COT_START_TAG_CHARACTERS}>",
    ).find(xml)?.value ?: return null
    val escapedName = Regex.escape(name)
    val encoded = sequenceOf(
        Regex("\\s$escapedName\\s*=\\s*\"([^\"]*)\""),
        Regex("\\s$escapedName\\s*=\\s*'([^']*)'"),
    ).mapNotNull { it.find(startTag)?.groupValues?.get(1) }
        .firstOrNull() ?: return null
    return decodeXmlAttribute(encoded)
}

private fun decodeXmlAttribute(value: String): String? {
    val decoded = StringBuilder()
    var index = 0
    while (index < value.length) {
        if (value[index] != '&') {
            val codePoint = value.codePointAt(index)
            if (!isValidXmlScalar(codePoint)) return null
            decoded.appendCodePoint(codePoint)
            index += Character.charCount(codePoint)
            continue
        }

        val semicolon = value.indexOf(';', index + 1)
        if (semicolon < 0 || semicolon - index > 12) return null
        val token = value.substring(index + 1, semicolon)
        val codePoint = when (token) {
            "amp" -> '&'.code
            "lt" -> '<'.code
            "gt" -> '>'.code
            "quot" -> '"'.code
            "apos" -> '\''.code
            else -> when {
                token.startsWith("#x") ->
                    token.drop(2).toIntOrNull(16)
                token.startsWith("#") ->
                    token.drop(1).toIntOrNull(10)
                else -> null
            }
        } ?: return null
        if (!isValidXmlScalar(codePoint)) return null
        decoded.appendCodePoint(codePoint)
        index = semicolon + 1
    }
    return decoded.toString()
}

private fun isValidXmlScalar(value: Int): Boolean =
    value == 0x9 ||
        value == 0xA ||
        value == 0xD ||
        value in 0x20..0xD7FF ||
        value in 0xE000..0xFFFD ||
        value in 0x10000..0x10FFFF
