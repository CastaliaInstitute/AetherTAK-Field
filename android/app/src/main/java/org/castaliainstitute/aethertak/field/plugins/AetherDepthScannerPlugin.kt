package org.castaliainstitute.aethertak.field.plugins

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ar.core.ArCoreApk
import org.castaliainstitute.aethertak.field.depth.AetherDepthCaptureActivity

@CapacitorPlugin(name = "AetherDepthScanner")
class AetherDepthScannerPlugin : Plugin() {
    private fun hasArCore(): Boolean {
        val availability = ArCoreApk.getInstance().checkAvailability(context)
        return availability.isSupported &&
            context.packageManager.hasSystemFeature("android.hardware.camera.ar")
    }

    @PluginMethod
    fun getCapability(call: PluginCall) {
        val supported = hasArCore()
        call.resolve(JSObject().apply {
            put("supported", supported)
            put("provider", if (supported) "arcore-depth" else "none")
            put("supportsPointCloud", supported)
            put("supportsMesh", supported)
            put("supportsConfidence", supported)
            put(
                "reason",
                if (supported) JSObject.NULL
                else "ARCore is unavailable; depth support is verified when capture starts.",
            )
        })
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!hasArCore()) {
            call.reject("ARCore is unavailable on this device.", "UNAVAILABLE")
            return
        }
        val coordinate = call.getObject("coordinate")
        if (coordinate == null) {
            call.reject("A coordinate is required.", "INVALID_OPTIONS")
            return
        }
        val mode = call.getString("mode", "measure") ?: "measure"
        if (mode !in setOf("measure", "point_cloud", "mesh")) {
            call.reject("Unsupported depth scan mode.", "INVALID_OPTIONS")
            return
        }
        val intent = Intent(context, AetherDepthCaptureActivity::class.java).apply {
            putExtra(AetherDepthCaptureActivity.EXTRA_COORDINATE, coordinate.toString())
            putExtra(
                AetherDepthCaptureActivity.EXTRA_MODE,
                mode,
            )
        }
        startActivityForResult(call, intent, "depthCaptureResult")
    }

    @ActivityCallback
    private fun depthCaptureResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK) {
            val payload = data?.getStringExtra(AetherDepthCaptureActivity.EXTRA_RESULT)
            if (payload == null) {
                call.reject("Depth capture returned no result.", "CAPTURE_FAILED")
            } else {
                call.resolve(JSObject(payload))
            }
            return
        }
        val code = data?.getStringExtra(AetherDepthCaptureActivity.EXTRA_ERROR_CODE)
            ?: if (result.resultCode == Activity.RESULT_CANCELED) "CANCELLED" else "CAPTURE_FAILED"
        val message = data?.getStringExtra(AetherDepthCaptureActivity.EXTRA_ERROR_MESSAGE)
            ?: "Depth capture was cancelled."
        call.reject(message, code)
    }

    @PluginMethod
    fun cancelScan(call: PluginCall) {
        activity.sendBroadcast(
            Intent(AetherDepthCaptureActivity.ACTION_CANCEL)
                .setPackage(context.packageName),
        )
        call.resolve()
    }
}
