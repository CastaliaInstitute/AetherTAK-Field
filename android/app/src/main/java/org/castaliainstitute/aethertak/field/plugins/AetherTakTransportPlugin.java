package org.castaliainstitute.aethertak.field.plugins;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AetherTakTransport")
public class AetherTakTransportPlugin extends Plugin {

    private String state = "not_enrolled";

    private JSObject status(String error) {
        JSObject result = new JSObject();
        result.put("state", state);
        result.put("profile", JSObject.NULL);
        result.put("lastConnectedAt", JSObject.NULL);
        result.put("error", error == null ? JSObject.NULL : error);
        return result;
    }

    @PluginMethod
    public void importEnrollmentPackage(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isBlank()) {
            call.reject("An enrollment package path is required.", "INVALID_PACKAGE");
            return;
        }
        call.reject(
            "Secure Android KeyStore enrollment import is not included in this foundation build.",
            "NOT_IMPLEMENTED"
        );
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if ("not_enrolled".equals(state)) {
            call.resolve(status("Import an AetherTAK enrollment package first."));
            return;
        }
        state = "disconnected";
        call.resolve(status("Certificate-backed CoT transport is not configured."));
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        state = "disconnected";
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status(null));
    }

    @PluginMethod
    public void getContacts(PluginCall call) {
        JSObject result = new JSObject();
        result.put("contacts", new JSArray());
        call.resolve(result);
    }

    @PluginMethod
    public void sendCot(PluginCall call) {
        String xml = call.getString("xml");
        if (xml == null || !xml.startsWith("<event")) {
            call.reject("A valid CoT event is required.", "INVALID_COT");
            return;
        }
        JSObject result = new JSObject();
        result.put("accepted", false);
        call.resolve(result);
    }
}
