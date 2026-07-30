package org.castaliainstitute.aethertak.field;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import org.castaliainstitute.aethertak.field.plugins.AetherDepthScannerPlugin;
import org.castaliainstitute.aethertak.field.plugins.AetherTakTransportPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AetherTakTransportPlugin.class);
        registerPlugin(AetherDepthScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
