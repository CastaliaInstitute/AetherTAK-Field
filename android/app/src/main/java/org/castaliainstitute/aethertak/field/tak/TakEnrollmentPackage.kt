package org.castaliainstitute.aethertak.field.tak

import android.content.Context
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.zip.ZipInputStream
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory

data class TakEnrollmentMaterial(
    val name: String,
    val host: String,
    val port: Int,
    val caBytes: ByteArray,
    val clientBytes: ByteArray,
    val caPassword: CharArray,
    val clientPassword: CharArray,
) : Closeable {
    override fun close() {
        caBytes.fill(0)
        clientBytes.fill(0)
        caPassword.fill('\u0000')
        clientPassword.fill('\u0000')
    }
}

object TakEnrollmentPackage {
    private const val MAX_ENTRY_BYTES = 10 * 1024 * 1024
    private const val MAX_PACKAGE_BYTES = 25 * 1024 * 1024

    fun read(context: Context, path: String): TakEnrollmentMaterial {
        val files = mutableMapOf<String, ByteArray>()
        open(context, path).use { input ->
            ZipInputStream(input.buffered()).use { archive ->
                var totalBytes = 0
                while (true) {
                    val entry = archive.nextEntry ?: break
                    if (entry.isDirectory) continue
                    val name = basename(entry.name)
                    require(name.isNotBlank()) { "Invalid enrollment package entry." }
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    var entryBytes = 0
                    while (true) {
                        val count = archive.read(buffer)
                        if (count < 0) break
                        entryBytes += count
                        totalBytes += count
                        require(entryBytes <= MAX_ENTRY_BYTES) {
                            "Enrollment package entry is too large."
                        }
                        require(totalBytes <= MAX_PACKAGE_BYTES) {
                            "Enrollment package is too large."
                        }
                        output.write(buffer, 0, count)
                    }
                    files[name] = output.toByteArray()
                    archive.closeEntry()
                }
            }
        }

        val preferencesBytes = files["server.pref"]
            ?: error("Enrollment package does not contain server.pref.")
        val preferences = parsePreferences(preferencesBytes)
        val connect = preferences["connectString0"]
            ?: error("Enrollment package has no TAK connection.")
        val match = Regex("^(.+):(\\d+):(ssl)$").matchEntire(connect)
            ?: error("Only certificate-authenticated SSL TAK streams are supported.")
        val caName = basename(
            preferences["caLocation"] ?: error("CA certificate is missing."),
        )
        val clientName = basename(
            preferences["certificateLocation"]
                ?: error("Client certificate is missing."),
        )
        val caPassword = preferences["caPassword"]?.toCharArray()
            ?: error("CA passphrase is missing.")
        val clientPassword = preferences["clientPassword"]?.toCharArray()
            ?: error("Client passphrase is missing.")

        return TakEnrollmentMaterial(
            name = preferences["description0"] ?: "TAK Server",
            host = match.groupValues[1],
            port = match.groupValues[2].toInt(),
            caBytes = files[caName] ?: error("CA certificate file is missing."),
            clientBytes = files[clientName]
                ?: error("Client certificate file is missing."),
            caPassword = caPassword,
            clientPassword = clientPassword,
        )
    }

    private fun open(context: Context, path: String): InputStream {
        val uri = Uri.parse(path)
        return when (uri.scheme?.lowercase()) {
            "content" -> context.contentResolver.openInputStream(uri)
                ?: error("Unable to open enrollment package.")
            "file" -> FileInputStream(File(requireNotNull(uri.path)))
            else -> FileInputStream(File(path))
        }
    }

    private fun basename(value: String): String =
        value.replace('\\', '/').substringAfterLast('/')

    private fun parsePreferences(xml: ByteArray): Map<String, String> {
        val factory = DocumentBuilderFactory.newInstance().apply {
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            setFeature("http://xml.org/sax/features/external-general-entities", false)
            setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
            setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "")
            setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "")
            isXIncludeAware = false
            isExpandEntityReferences = false
        }
        val document = factory.newDocumentBuilder()
            .parse(xml.inputStream())
        val entries = document.getElementsByTagName("entry")
        return buildMap {
            for (index in 0 until entries.length) {
                val node = entries.item(index)
                val key = node.attributes?.getNamedItem("key")?.nodeValue
                if (!key.isNullOrBlank()) put(key, node.textContent)
            }
        }
    }
}
