package org.castaliainstitute.aethertak.field.plugins;

import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AetherDepthScanner")
public class AetherDepthScannerPlugin extends Plugin {

    private boolean hasArCore() {
        try {
            getContext().getPackageManager().getPackageInfo("com.google.ar.core", 0);
            return getContext()
                .getPackageManager()
                .hasSystemFeature("android.hardware.camera.ar");
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        }
    }

    @PluginMethod
    public void getCapability(PluginCall call) {
        boolean supported = hasArCore();
        JSObject result = new JSObject();
        result.put("supported", supported);
        result.put("provider", supported ? "arcore-depth" : "none");
        result.put("supportsPointCloud", supported);
        result.put("supportsMesh", false);
        result.put("supportsConfidence", supported);
        result.put(
            "reason",
            supported
                ? JSObject.NULL
                : "ARCore with a depth-capable rear camera is not available."
        );
        call.resolve(result);
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (!hasArCore()) {
            call.reject("ARCore Depth is unavailable on this device.", "UNAVAILABLE");
            return;
        }
        call.reject(
            "ARCore capture session is not included in this foundation build.",
            "NOT_IMPLEMENTED"
        );
    }

    @PluginMethod
    public void cancelScan(PluginCall call) {
        call.resolve();
    }
}
