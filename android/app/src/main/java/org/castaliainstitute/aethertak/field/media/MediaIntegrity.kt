package org.castaliainstitute.aethertak.field.media

import java.io.InputStream
import java.security.MessageDigest

data class MediaFileIntegrity(
    val sha256: String,
    val sizeBytes: Long,
)

fun inspectMedia(input: InputStream): MediaFileIntegrity {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(1024 * 1024)
    var sizeBytes = 0L
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (count == 0) continue
        require(sizeBytes <= Long.MAX_VALUE - count) {
            "The captured media file is too large to inspect safely."
        }
        digest.update(buffer, 0, count)
        sizeBytes += count
    }
    require(sizeBytes > 0) { "The captured media file is empty." }
    return MediaFileIntegrity(
        sha256 = digest.digest().joinToString("") { "%02x".format(it) },
        sizeBytes = sizeBytes,
    )
}
