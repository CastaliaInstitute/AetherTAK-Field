package org.castaliainstitute.aethertak.field.tak

import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketException
import java.security.KeyStore
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.time.Instant
import java.util.concurrent.Executors
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedKeyManager

class TakTlsTransport(
    private val identityStore: TakIdentityStore,
    private val onEvent: (String) -> Unit,
    private val onDisconnected: (String?) -> Unit,
) {
    private val executor = Executors.newFixedThreadPool(2)
    @Volatile private var socket: SSLSocket? = null
    @Volatile private var connectedAt: Instant? = null
    private val outputLock = Any()

    val isConnected: Boolean
        get() = socket?.isConnected == true && socket?.isClosed == false

    val lastConnectedAt: Instant?
        get() = connectedAt

    fun connect(profile: TakProfile, completion: (Result<Unit>) -> Unit) {
        executor.execute {
            try {
                disconnect()
                val context = sslContext(profile)
                val plain = Socket()
                plain.connect(InetSocketAddress(profile.host, profile.port), 15_000)
                val tls = context.socketFactory.createSocket(
                    plain,
                    profile.host,
                    profile.port,
                    true,
                ) as SSLSocket
                tls.enabledProtocols = tls.supportedProtocols.filter {
                    it == "TLSv1.3" || it == "TLSv1.2"
                }.toTypedArray()
                tls.sslParameters = tls.sslParameters.apply {
                    endpointIdentificationAlgorithm = "HTTPS"
                }
                tls.startHandshake()
                socket = tls
                connectedAt = Instant.now()
                completion(Result.success(Unit))
                receive(tls)
            } catch (error: Exception) {
                socket = null
                connectedAt = null
                completion(Result.failure(error))
            }
        }
    }

    fun send(xml: String, completion: (Result<Unit>) -> Unit) {
        executor.execute {
            try {
                require(xml.startsWith("<event") && xml.endsWith("</event>")) {
                    "Invalid CoT event."
                }
                val active = socket?.takeIf { isConnected }
                    ?: error("TAK transport is disconnected.")
                synchronized(outputLock) {
                    active.outputStream.write(xml.toByteArray(Charsets.UTF_8))
                    active.outputStream.write('\n'.code)
                    active.outputStream.flush()
                }
                completion(Result.success(Unit))
            } catch (error: Exception) {
                completion(Result.failure(error))
            }
        }
    }

    fun disconnect() {
        try {
            socket?.close()
        } catch (_: Exception) {
            // Closing is best effort.
        } finally {
            socket = null
            connectedAt = null
        }
    }

    fun shutdown() {
        disconnect()
        executor.shutdownNow()
    }

    private fun receive(active: SSLSocket) {
        val buffer = ByteArray(8192)
        val pending = StringBuilder()
        try {
            while (!active.isClosed) {
                val count = active.inputStream.read(buffer)
                if (count < 0) break
                pending.append(String(buffer, 0, count, Charsets.UTF_8))
                require(pending.length <= 2 * 1024 * 1024) {
                    "Incoming TAK event exceeded the buffer limit."
                }
                while (true) {
                    val end = pending.indexOf("</event>")
                    if (end < 0) break
                    val length = end + "</event>".length
                    val xml = pending.substring(0, length)
                    pending.delete(0, length)
                    val start = xml.indexOf("<event")
                    if (start >= 0) onEvent(xml.substring(start))
                }
            }
        } catch (_: SocketException) {
            // A local disconnect closes the socket.
        } catch (error: Exception) {
            onDisconnected(error.message)
        } finally {
            if (socket === active) {
                socket = null
                connectedAt = null
                onDisconnected(null)
            }
        }
    }

    private fun sslContext(profile: TakProfile): SSLContext {
        val androidStore = identityStore.keyStore()
        val keyManagerFactory = KeyManagerFactory.getInstance(
            KeyManagerFactory.getDefaultAlgorithm(),
        ).apply { init(androidStore, null) }
        val delegate = keyManagerFactory.keyManagers
            .filterIsInstance<X509ExtendedKeyManager>()
            .first()
        val keyManager = AliasKeyManager(delegate, profile.clientAlias)

        val trustStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null)
            setCertificateEntry("aethertak-anchor", androidStore.getCertificate(profile.caAlias))
        }
        val trustManagers = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm(),
        ).apply { init(trustStore) }.trustManagers

        return SSLContext.getInstance("TLS").apply {
            init(arrayOf(keyManager), trustManagers, null)
        }
    }
}

private class AliasKeyManager(
    private val delegate: X509ExtendedKeyManager,
    private val alias: String,
) : X509ExtendedKeyManager() {
    override fun chooseClientAlias(
        keyType: Array<out String>?,
        issuers: Array<out Principal>?,
        socket: Socket?,
    ): String = alias

    override fun chooseEngineClientAlias(
        keyType: Array<out String>?,
        issuers: Array<out Principal>?,
        engine: SSLEngine?,
    ): String = alias

    override fun getCertificateChain(requestedAlias: String?): Array<X509Certificate>? =
        delegate.getCertificateChain(alias)

    override fun getPrivateKey(requestedAlias: String?): PrivateKey? =
        delegate.getPrivateKey(alias)

    override fun getClientAliases(
        keyType: String?,
        issuers: Array<out Principal>?,
    ): Array<String> = arrayOf(alias)

    override fun chooseServerAlias(
        keyType: String?,
        issuers: Array<out Principal>?,
        socket: Socket?,
    ): String? = delegate.chooseServerAlias(keyType, issuers, socket)

    override fun chooseEngineServerAlias(
        keyType: String?,
        issuers: Array<out Principal>?,
        engine: SSLEngine?,
    ): String? = delegate.chooseEngineServerAlias(keyType, issuers, engine)

    override fun getServerAliases(
        keyType: String?,
        issuers: Array<out Principal>?,
    ): Array<String>? = delegate.getServerAliases(keyType, issuers)
}
