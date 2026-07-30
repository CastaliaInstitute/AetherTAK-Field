package org.castaliainstitute.aethertak.field.tak

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CredentialRotationTest {
    @Test
    fun `activates replacement before retiring previous aliases`() {
        val entries = mutableSetOf("old-client", "old-ca")
        val events = mutableListOf<String>()
        val rotation = CredentialRotation(
            installClient = { entries += it; events += "client" },
            installCa = { entries += it; events += "ca" },
            activate = {
                assertTrue(entries.containsAll(listOf("new-client", "new-ca")))
                assertTrue(entries.containsAll(listOf("old-client", "old-ca")))
                events += "activate"
            },
            remove = { entries -= it; events += "remove:$it" },
        )

        rotation.replace(
            CredentialAliases("new-client", "new-ca"),
            CredentialAliases("old-client", "old-ca"),
        )

        assertEquals(
            listOf(
                "client",
                "ca",
                "activate",
                "remove:old-client",
                "remove:old-ca",
            ),
            events,
        )
        assertEquals(setOf("new-client", "new-ca"), entries)
    }

    @Test
    fun `rolls back staged aliases when CA storage fails`() {
        val entries = mutableSetOf("old-client", "old-ca")
        var activated = false
        val rotation = CredentialRotation(
            installClient = { entries += it },
            installCa = { error("CA storage failed") },
            activate = { activated = true },
            remove = { entries -= it },
        )

        runCatching {
            rotation.replace(
                CredentialAliases("new-client", "new-ca"),
                CredentialAliases("old-client", "old-ca"),
            )
        }

        assertFalse(activated)
        assertEquals(setOf("old-client", "old-ca"), entries)
    }

    @Test
    fun `rolls back both staged aliases when profile activation fails`() {
        val entries = mutableSetOf("old-client", "old-ca")
        val rotation = CredentialRotation(
            installClient = { entries += it },
            installCa = { entries += it },
            activate = { error("Profile commit failed") },
            remove = { entries -= it },
        )

        runCatching {
            rotation.replace(
                CredentialAliases("new-client", "new-ca"),
                CredentialAliases("old-client", "old-ca"),
            )
        }

        assertEquals(setOf("old-client", "old-ca"), entries)
    }
}
