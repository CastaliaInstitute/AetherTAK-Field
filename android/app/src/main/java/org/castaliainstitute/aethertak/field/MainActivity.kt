package org.castaliainstitute.aethertak.field

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import org.castaliainstitute.aethertak.field.plugins.AetherDepthScannerPlugin
import org.castaliainstitute.aethertak.field.plugins.AetherMediaIntegrityPlugin
import org.castaliainstitute.aethertak.field.plugins.AetherTakTransportPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AetherTakTransportPlugin::class.java)
        registerPlugin(AetherDepthScannerPlugin::class.java)
        registerPlugin(AetherMediaIntegrityPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
