package org.castaliainstitute.aethertak.field.media

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MediaIntegrityTest {
    @Test
    fun `streams a stable SHA-256 digest and byte count`() {
        val result = ByteArrayInputStream("abc".toByteArray()).use(::inspectMedia)

        assertEquals(3L, result.sizeBytes)
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            result.sha256,
        )
    }

    @Test
    fun `rejects empty captured media`() {
        assertThrows(IllegalArgumentException::class.java) {
            ByteArrayInputStream(byteArrayOf()).use(::inspectMedia)
        }
    }
}
