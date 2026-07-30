package org.castaliainstitute.aethertak.field.tak

import android.content.Context
import android.net.Uri
import android.system.Os
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

data class FieldApiResponse(val status: Int, val body: String)

class TakFieldApiClient(
    private val context: Context,
    private val transport: TakTlsTransport,
) {
    fun mutate(
        profile: TakProfile,
        port: Int,
        mutationJson: String,
    ): FieldApiResponse = request(
        profile = profile,
        port = port,
        method = "POST",
        path = "/v1/mutations",
        contentType = "application/json",
        body = mutationJson.toByteArray(Charsets.UTF_8),
    )

    fun changes(
        profile: TakProfile,
        port: Int,
        cursor: Long,
        limit: Int,
    ): FieldApiResponse = request(
        profile = profile,
        port = port,
        method = "GET",
        path = "/v1/changes?cursor=$cursor&limit=$limit",
    )

    fun upload(
        profile: TakProfile,
        port: Int,
        mediaId: String,
        uriValue: String,
        contentType: String,
        observationId: String?,
        role: String?,
        suppliedSha256: String?,
    ): FieldApiResponse {
        require(mediaId.matches(Regex("[A-Za-z0-9._-]{1,128}"))) {
            "Invalid media ID."
        }
        val uri = Uri.parse(uriValue)
        val length = mediaLength(uri)
        require(length in 0..(512L * 1024L * 1024L)) {
            "Media size is unavailable or exceeds 512 MiB."
        }
        val checksum = suppliedSha256
            ?.takeIf { it.matches(Regex("[0-9a-fA-F]{64}")) }
            ?.lowercase()
            ?: openMedia(uri).use(::sha256)
        val connection = connection(
            profile,
            port,
            "/v1/media/${java.net.URLEncoder.encode(mediaId, Charsets.UTF_8)}",
        ).apply {
            requestMethod = "PUT"
            doOutput = true
            setFixedLengthStreamingMode(length)
            setRequestProperty("Content-Type", contentType)
            setRequestProperty("X-Aether-Sha256", checksum)
            observationId?.let {
                setRequestProperty("X-Aether-Observation-Id", it)
            }
            role?.let { setRequestProperty("X-Aether-Role", it) }
        }
        try {
            connection.outputStream.use { output ->
                openMedia(uri).use { input -> input.copyTo(output, 1024 * 1024) }
            }
            return response(connection)
        } finally {
            connection.disconnect()
        }
    }

    fun download(
        profile: TakProfile,
        port: Int,
        mediaId: String,
        expectedSha256: String?,
        expectedContentType: String?,
    ): FieldApiResponse {
        require(mediaId.matches(Regex("[A-Za-z0-9._-]{1,128}"))) {
            "Invalid media ID."
        }
        val connection = connection(
            profile,
            port,
            "/v1/media/${java.net.URLEncoder.encode(mediaId, Charsets.UTF_8)}",
        ).apply {
            requestMethod = "GET"
            setRequestProperty("Accept", "application/octet-stream")
        }
        var temporary: File? = null
        try {
            val status = connection.responseCode
            if (status !in 200..299) return response(connection)
            val length = connection.contentLengthLong
            require(length in 0..(512L * 1024L * 1024L)) {
                "Downloaded media size is unavailable or exceeds 512 MiB."
            }
            val checksum = requireNotNull(
                connection.getHeaderField("X-Aether-Sha256")
                    ?.lowercase()
                    ?.takeIf { it.matches(Regex("[0-9a-f]{64}")) },
            ) { "The media response has no valid SHA-256 digest." }
            expectedSha256?.let {
                require(it.equals(checksum, ignoreCase = true)) {
                    "The media response digest does not match its field record."
                }
            }
            val contentType = connection.contentType
                ?.substringBefore(';')
                ?.trim()
                ?.lowercase()
                ?: "application/octet-stream"
            expectedContentType?.let {
                require(it.substringBefore(';').trim().equals(contentType, ignoreCase = true)) {
                    "The media response content type does not match its field record."
                }
            }

            val directory = File(context.filesDir, "aether-field-media")
            check(directory.isDirectory || directory.mkdirs()) {
                "Cannot create app-private media storage."
            }
            temporary = File(directory, ".$mediaId-${UUID.randomUUID()}.part")
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            FileOutputStream(temporary).use { output ->
                connection.inputStream.use { input ->
                    val buffer = ByteArray(1024 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        received += count
                        require(received <= length) {
                            "The media response exceeded Content-Length."
                        }
                    }
                }
                output.flush()
                output.fd.sync()
            }
            require(received == length) {
                "The media response ended before Content-Length bytes arrived."
            }
            val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
            require(actualSha256 == checksum) {
                "The downloaded media SHA-256 does not match the server digest."
            }
            val destination = File(directory, "$mediaId${mediaExtension(contentType)}")
            Os.rename(temporary.absolutePath, destination.absolutePath)
            temporary = null
            return FieldApiResponse(
                status = status,
                body = JSONObject()
                    .put("mediaId", mediaId)
                    .put("localUri", destination.toURI().toString())
                    .put("sha256", actualSha256)
                    .put("sizeBytes", received)
                    .put("contentType", contentType)
                    .toString(),
            )
        } finally {
            temporary?.delete()
            connection.disconnect()
        }
    }

    private fun request(
        profile: TakProfile,
        port: Int,
        method: String,
        path: String,
        contentType: String? = null,
        body: ByteArray? = null,
    ): FieldApiResponse {
        val connection = connection(profile, port, path).apply {
            requestMethod = method
            if (body != null) {
                doOutput = true
                setFixedLengthStreamingMode(body.size)
                contentType?.let { setRequestProperty("Content-Type", it) }
            }
        }
        try {
            if (body != null) {
                connection.outputStream.use { it.write(body) }
            }
            return response(connection)
        } finally {
            connection.disconnect()
        }
    }

    private fun connection(
        profile: TakProfile,
        port: Int,
        path: String,
    ): HttpsURLConnection {
        require(port in 1..65535) { "Invalid Aether Field API port." }
        return (URL("https", profile.host, port, path).openConnection() as HttpsURLConnection)
            .apply {
                sslSocketFactory = sslContext(profile).socketFactory
                connectTimeout = 15_000
                readTimeout = 60_000
                useCaches = false
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
            }
    }

    private fun sslContext(profile: TakProfile) =
        transport.sslContext(profile)

    private fun response(connection: HttpURLConnection): FieldApiResponse {
        val status = connection.responseCode
        val stream = if (status in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }
        val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
            ?: "{}"
        return FieldApiResponse(status, body)
    }

    private fun mediaLength(uri: Uri): Long {
        if (uri.scheme == "file") {
            return java.io.File(requireNotNull(uri.path)).length()
        }
        return context.contentResolver.openAssetFileDescriptor(uri, "r")
            ?.use { it.length }
            ?: -1
    }

    private fun openMedia(uri: Uri): InputStream {
        if (uri.scheme == "file") {
            return java.io.File(requireNotNull(uri.path)).inputStream()
        }
        return requireNotNull(context.contentResolver.openInputStream(uri)) {
            "The media URI cannot be opened."
        }
    }

    private fun sha256(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(1024 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun mediaExtension(contentType: String): String = when (contentType) {
        "image/jpeg" -> ".jpg"
        "video/mp4" -> ".mp4"
        "model/ply" -> ".ply"
        "model/obj" -> ".obj"
        "application/x-aether-depth-f32le" -> ".f32le"
        "application/x-aether-depth-u16le" -> ".u16le"
        "application/x-aether-depth-confidence" -> ".u8"
        else -> ".bin"
    }
}
