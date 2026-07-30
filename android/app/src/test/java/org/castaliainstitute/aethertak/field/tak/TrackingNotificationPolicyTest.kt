package org.castaliainstitute.aethertak.field.tak

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrackingNotificationPolicyTest {
    @Test
    fun `accepts visible notifications on current Android`() {
        assertNull(
            trackingNotificationProblem(
                TrackingNotificationPrerequisites(
                    sdkInt = 36,
                    runtimePermissionGranted = true,
                    appNotificationsEnabled = true,
                    channelBlocked = false,
                ),
            ),
        )
    }

    @Test
    fun `requires Android 13 notification permission`() {
        assertEquals(
            "Allow notifications so Android can visibly show background team location.",
            trackingNotificationProblem(
                TrackingNotificationPrerequisites(
                    sdkInt = 33,
                    runtimePermissionGranted = false,
                    appNotificationsEnabled = false,
                    channelBlocked = false,
                ),
            ),
        )
    }

    @Test
    fun `rejects globally disabled notifications before Android 13`() {
        assertEquals(
            "Enable AetherTAK Field notifications before sharing background team location.",
            trackingNotificationProblem(
                TrackingNotificationPrerequisites(
                    sdkInt = 32,
                    runtimePermissionGranted = false,
                    appNotificationsEnabled = false,
                    channelBlocked = false,
                ),
            ),
        )
    }

    @Test
    fun `rejects a blocked tracking channel`() {
        assertEquals(
            "Enable the TAK background location notification channel before sharing.",
            trackingNotificationProblem(
                TrackingNotificationPrerequisites(
                    sdkInt = 36,
                    runtimePermissionGranted = true,
                    appNotificationsEnabled = true,
                    channelBlocked = true,
                ),
            ),
        )
    }
}
