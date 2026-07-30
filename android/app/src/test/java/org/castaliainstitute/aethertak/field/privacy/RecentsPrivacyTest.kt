package org.castaliainstitute.aethertak.field.privacy

import org.junit.Assert.assertEquals
import org.junit.Test

class RecentsPrivacyTest {
    @Test
    fun `uses the dedicated recents API on Android 13 and newer`() {
        assertEquals(
            RecentsPrivacyStrategy.DISABLE_RECENTS_SCREENSHOT,
            recentsPrivacyStrategy(33),
        )
        assertEquals(
            RecentsPrivacyStrategy.DISABLE_RECENTS_SCREENSHOT,
            recentsPrivacyStrategy(36),
        )
    }

    @Test
    fun `uses a pause-scoped secure window on older Android`() {
        assertEquals(
            RecentsPrivacyStrategy.SECURE_WHILE_PAUSED,
            recentsPrivacyStrategy(32),
        )
        assertEquals(
            RecentsPrivacyStrategy.SECURE_WHILE_PAUSED,
            recentsPrivacyStrategy(24),
        )
    }
}
