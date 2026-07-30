package org.castaliainstitute.aethertak.field.plugins

import android.net.Uri
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.Executors
import org.castaliainstitute.aethertak.field.media.inspectMedia

@CapacitorPlugin(name = "AetherMediaIntegrity")
class AetherMediaIntegrityPlugin : Plugin() {
    private val worker = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun inspect(call: PluginCall) {
        val value = call.getString("uri")
        if (value.isNullOrBlank()) {
            call.reject("A local captured-media file URI is required.", "INVALID_MEDIA_URI")
            return
        }
        val source = localAppFile(value)
        if (source == null) {
            call.reject(
                "Only app-private captured media can be inspected.",
                "MEDIA_OUTSIDE_SANDBOX",
            )
            return
        }

        worker.execute {
            try {
                val result = FileInputStream(source).use(::inspectMedia)
                call.resolve(JSObject().apply {
                    put("sha256", result.sha256)
                    put("sizeBytes", result.sizeBytes)
                })
            } catch (error: Exception) {
                call.reject(
                    error.message ?: "Captured media inspection failed.",
                    "MEDIA_INSPECTION_FAILED",
                    error,
                )
            }
        }
    }

    override fun handleOnDestroy() {
        worker.shutdownNow()
        super.handleOnDestroy()
    }

    private fun localAppFile(value: String): File? {
        val parsed = Uri.parse(value)
        val candidate = when (parsed.scheme?.lowercase()) {
            null, "" -> File(value)
            "file" -> parsed.path?.let(::File)
            else -> null
        } ?: return null
        val resolved = runCatching { candidate.canonicalFile }.getOrNull() ?: return null
        val roots = listOf(context.filesDir, context.cacheDir, context.noBackupFilesDir)
            .mapNotNull { runCatching { it.canonicalFile }.getOrNull() }
        return resolved.takeIf { file ->
            file.isFile && roots.any { root ->
                file.path != root.path && file.path.startsWith(root.path + File.separator)
            }
        }
    }
}
