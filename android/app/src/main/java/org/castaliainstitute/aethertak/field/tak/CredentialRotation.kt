package org.castaliainstitute.aethertak.field.tak

internal data class CredentialAliases(
    val client: String,
    val ca: String,
)

/**
 * Installs replacement credentials before activating their profile. A failed
 * staging or activation step removes only the replacement material and leaves
 * the previously active aliases untouched.
 */
internal class CredentialRotation(
    private val installClient: (String) -> Unit,
    private val installCa: (String) -> Unit,
    private val activate: () -> Unit,
    private val remove: (String) -> Unit,
) {
    fun replace(next: CredentialAliases, previous: CredentialAliases?) {
        var clientInstalled = false
        var caInstalled = false
        try {
            installClient(next.client)
            clientInstalled = true
            installCa(next.ca)
            caInstalled = true
            activate()
        } catch (error: Throwable) {
            if (caInstalled) runCatching { remove(next.ca) }
            if (clientInstalled) runCatching { remove(next.client) }
            throw error
        }

        previous
            ?.let { listOf(it.client, it.ca) }
            ?.filterNot { it == next.client || it == next.ca }
            ?.forEach { runCatching { remove(it) } }
    }
}
