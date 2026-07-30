package org.castaliainstitute.aethertak.field.plugins

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import org.castaliainstitute.aethertak.field.tak.TakEnrollmentPackage
import org.castaliainstitute.aethertak.field.tak.TakIdentityStore
import org.castaliainstitute.aethertak.field.tak.TakProfile
import org.castaliainstitute.aethertak.field.tak.TakTlsTransport

@CapacitorPlugin(name = "AetherTakTransport")
class AetherTakTransportPlugin : Plugin() {
    private val worker = Executors.newSingleThreadExecutor()
    private val contacts = ConcurrentHashMap<String, JSObject>()
    private lateinit var identityStore: TakIdentityStore
    private lateinit var transport: TakTlsTransport
    @Volatile private var state = "not_enrolled"
    @Volatile private var lastError: String? = null

    override fun load() {
        identityStore = TakIdentityStore(context)
        state = if (identityStore.load() == null) "not_enrolled" else "disconnected"
        transport = TakTlsTransport(
            identityStore = identityStore,
            onEvent = ::receiveEvent,
            onDisconnected = { error ->
                state = "disconnected"
                lastError = error
                notifyListeners("statusChanged", status())
            },
        )
    }

    @PluginMethod
    fun importEnrollmentPackage(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) {
            call.reject("An enrollment package path is required.", "INVALID_PACKAGE")
            return
        }
        worker.execute {
            try {
                TakEnrollmentPackage.read(context, path).use { material ->
                    val profile = identityStore.import(material)
                    state = "disconnected"
                    lastError = null
                    call.resolve(profileObject(profile))
                }
            } catch (error: Exception) {
                call.reject(
                    error.message ?: "Enrollment package import failed.",
                    "ENROLLMENT_FAILED",
                    error,
                )
            }
        }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val profile = identityStore.load()
        if (profile == null) {
            state = "not_enrolled"
            call.resolve(status("Import an AetherTAK enrollment package first."))
            return
        }
        state = "connecting"
        lastError = null
        transport.connect(profile) { result ->
            result.fold(
                onSuccess = {
                    state = "connected"
                    call.resolve(status())
                    notifyListeners("statusChanged", status())
                },
                onFailure = { error ->
                    state = "disconnected"
                    lastError = error.message
                    call.resolve(status(error.message))
                },
            )
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        transport.disconnect()
        state = if (identityStore.load() == null) "not_enrolled" else "disconnected"
        call.resolve()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) = call.resolve(status())

    @PluginMethod
    fun getContacts(call: PluginCall) {
        val values = contacts.values
            .filter { contact ->
                val stale = contact.getString("staleAt")
                stale != null && runCatching {
                    Instant.parse(stale).isAfter(Instant.now())
                }.getOrDefault(false)
            }
        call.resolve(JSObject().put("contacts", JSArray(values)))
    }

    @PluginMethod
    fun sendCot(call: PluginCall) {
        val xml = call.getString("xml")
        if (xml == null || !xml.startsWith("<event") || !xml.endsWith("</event>")) {
            call.reject("A valid CoT event is required.", "INVALID_COT")
            return
        }
        transport.send(xml) { result ->
            result.fold(
                onSuccess = {
                    call.resolve(JSObject().put("accepted", true))
                },
                onFailure = { error ->
                    val exception = error as? Exception ?: Exception(error)
                    call.reject(
                        error.message ?: "CoT send failed.",
                        "SEND_FAILED",
                        exception,
                    )
                },
            )
        }
    }

    override fun handleOnDestroy() {
        transport.shutdown()
        worker.shutdownNow()
        super.handleOnDestroy()
    }

    private fun status(error: String? = lastError): JSObject {
        val profile = identityStore.load()
        return JSObject().apply {
            put("state", state)
            put("profile", profile?.let(::profileObject) ?: JSObject.NULL)
            put(
                "lastConnectedAt",
                transport.lastConnectedAt?.toString() ?: JSObject.NULL,
            )
            put("error", error ?: JSObject.NULL)
        }
    }

    private fun profileObject(profile: TakProfile): JSObject = JSObject().apply {
        put("id", profile.id)
        put("name", profile.name)
        put("host", profile.host)
        put("port", profile.port)
        put("callsign", profile.callsign)
        put("team", profile.team)
    }

    private fun receiveEvent(xml: String) {
        val event = JSObject().put("xml", xml)
        notifyListeners("cotEvent", event)
        val type = attribute(xml, "event", "type") ?: return
        if (!type.startsWith("a-")) return
        val uid = attribute(xml, "event", "uid") ?: return
        val callsign = attribute(xml, "contact", "callsign") ?: return
        val stale = attribute(xml, "event", "stale") ?: return
        val latitude = attribute(xml, "point", "lat")?.toDoubleOrNull() ?: return
        val longitude = attribute(xml, "point", "lon")?.toDoubleOrNull() ?: return
        val coordinate = JSObject().apply {
            put("latitude", latitude)
            put("longitude", longitude)
            put("altitudeMeters", attribute(xml, "point", "hae")?.toDoubleOrNull())
            put(
                "horizontalAccuracyMeters",
                attribute(xml, "point", "ce")?.toDoubleOrNull(),
            )
            put(
                "verticalAccuracyMeters",
                attribute(xml, "point", "le")?.toDoubleOrNull(),
            )
            put("headingDegrees", attribute(xml, "track", "course")?.toDoubleOrNull())
        }
        contacts[uid] = JSObject().apply {
            put("uid", uid)
            put("callsign", callsign)
            put("team", attribute(xml, "__group", "name") ?: JSObject.NULL)
            put("coordinate", coordinate)
            put("staleAt", stale)
        }
    }

    private fun attribute(xml: String, tag: String, name: String): String? {
        val escapedTag = Regex.escape(tag)
        val escapedName = Regex.escape(name)
        return Regex("<$escapedTag\\b[^>]*\\b$escapedName=\"([^\"]*)\"")
            .find(xml)
            ?.groupValues
            ?.get(1)
    }
}
