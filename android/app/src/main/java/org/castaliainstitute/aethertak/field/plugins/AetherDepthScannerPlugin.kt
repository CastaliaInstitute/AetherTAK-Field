package org.castaliainstitute.aethertak.field.plugins

import android.content.pm.PackageManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AetherDepthScanner")
class AetherDepthScannerPlugin : Plugin() {
    private fun hasArCore(): Boolean = try {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo("com.google.ar.core", 0)
        context.packageManager.hasSystemFeature("android.hardware.camera.ar")
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    @PluginMethod
    fun getCapability(call: PluginCall) {
        val supported = hasArCore()
        call.resolve(JSObject().apply {
            put("supported", supported)
            put("provider", if (supported) "arcore-depth" else "none")
            put("supportsPointCloud", supported)
            put("supportsMesh", false)
            put("supportsConfidence", supported)
            put(
                "reason",
                if (supported) JSObject.NULL
                else "ARCore with a depth-capable rear camera is not available.",
            )
        })
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!hasArCore()) {
            call.reject("ARCore Depth is unavailable on this device.", "UNAVAILABLE")
            return
        }
        call.reject(
            "ARCore capture session is not included in this build.",
            "NOT_IMPLEMENTED",
        )
    }

    @PluginMethod
    fun cancelScan(call: PluginCall) = call.resolve()
}
