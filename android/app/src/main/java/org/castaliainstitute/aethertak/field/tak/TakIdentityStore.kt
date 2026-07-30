package org.castaliainstitute.aethertak.field.tak

import android.content.Context
import android.security.keystore.KeyProperties
import android.security.keystore.KeyProtection
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.util.UUID

data class TakProfile(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val callsign: String,
    val team: String,
    val clientAlias: String,
    val caAlias: String,
)

class TakIdentityStore(context: Context) {
    private val preferences = context.getSharedPreferences(
        "aethertak-secure-profile",
        Context.MODE_PRIVATE,
    )

    private val keyStore: KeyStore
        get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun import(material: TakEnrollmentMaterial): TakProfile {
        val caStore = KeyStore.getInstance("PKCS12").apply {
            load(material.caBytes.inputStream(), material.caPassword)
        }
        val caCertificate = caStore.aliases().toList()
            .mapNotNull { caStore.getCertificate(it) as? X509Certificate }
            .firstOrNull()
            ?: error("CA PKCS#12 contains no certificate.")

        val clientStore = KeyStore.getInstance("PKCS12").apply {
            load(material.clientBytes.inputStream(), material.clientPassword)
        }
        val sourceAlias = clientStore.aliases().toList()
            .firstOrNull { clientStore.isKeyEntry(it) }
            ?: error("Client PKCS#12 contains no private identity.")
        val privateKey = clientStore.getKey(
            sourceAlias,
            material.clientPassword,
        ) as? PrivateKey ?: error("Client identity has no private key.")
        val chain = clientStore.getCertificateChain(sourceAlias)
            ?: error("Client identity has no certificate chain.")
        val leaf = chain.first() as? X509Certificate
            ?: error("Client identity certificate is invalid.")

        val id = stableId(leaf.encoded)
        val clientAlias = "aethertak-client-$id"
        val caAlias = "aethertak-ca-$id"
        val protectionBuilder = KeyProtection.Builder(
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_DECRYPT,
        ).setDigests(
            KeyProperties.DIGEST_SHA256,
            KeyProperties.DIGEST_SHA512,
        )
        if (privateKey.algorithm.equals("RSA", ignoreCase = true)) {
            protectionBuilder.setEncryptionPaddings(
                KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1,
                KeyProperties.ENCRYPTION_PADDING_RSA_OAEP,
            )
            protectionBuilder.setSignaturePaddings(
                KeyProperties.SIGNATURE_PADDING_RSA_PKCS1,
                KeyProperties.SIGNATURE_PADDING_RSA_PSS,
            )
        }

        val store = keyStore
        load()?.let { previous ->
            if (store.containsAlias(previous.clientAlias)) {
                store.deleteEntry(previous.clientAlias)
            }
            if (store.containsAlias(previous.caAlias)) {
                store.deleteEntry(previous.caAlias)
            }
        }
        store.setEntry(
            clientAlias,
            KeyStore.PrivateKeyEntry(privateKey, chain),
            protectionBuilder.build(),
        )
        store.setCertificateEntry(caAlias, caCertificate)

        val profile = TakProfile(
            id = id,
            name = material.name,
            host = material.host,
            port = material.port,
            callsign = commonName(leaf) ?: "Aether Field",
            team = "Green",
            clientAlias = clientAlias,
            caAlias = caAlias,
        )
        persist(profile)
        return profile
    }

    fun load(): TakProfile? {
        val id = preferences.getString("id", null) ?: return null
        val profile = TakProfile(
            id = id,
            name = preferences.getString("name", "TAK Server")!!,
            host = preferences.getString("host", null) ?: return null,
            port = preferences.getInt("port", 0),
            callsign = preferences.getString("callsign", "Aether Field")!!,
            team = preferences.getString("team", "Green")!!,
            clientAlias = preferences.getString("clientAlias", null)
                ?: return null,
            caAlias = preferences.getString("caAlias", null) ?: return null,
        )
        val store = keyStore
        return profile.takeIf {
            profile.port in 1..65535 &&
                store.containsAlias(profile.clientAlias) &&
                store.containsAlias(profile.caAlias)
        }
    }

    fun keyStore(): KeyStore = keyStore

    private fun persist(profile: TakProfile) {
        preferences.edit()
            .putString("id", profile.id)
            .putString("name", profile.name)
            .putString("host", profile.host)
            .putInt("port", profile.port)
            .putString("callsign", profile.callsign)
            .putString("team", profile.team)
            .putString("clientAlias", profile.clientAlias)
            .putString("caAlias", profile.caAlias)
            .apply()
    }

    private fun stableId(certificate: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(certificate)
        val bytes = digest.copyOfRange(0, 16)
        bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x50).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
        val most = bytes.take(8).fold(0L) { value, byte ->
            (value shl 8) or (byte.toLong() and 0xff)
        }
        val least = bytes.drop(8).fold(0L) { value, byte ->
            (value shl 8) or (byte.toLong() and 0xff)
        }
        return UUID(most, least).toString()
    }

    private fun commonName(certificate: X509Certificate): String? =
        certificate.subjectX500Principal.name
            .split(',')
            .map { it.trim() }
            .firstOrNull { it.startsWith("CN=", ignoreCase = true) }
            ?.substringAfter('=')
}
