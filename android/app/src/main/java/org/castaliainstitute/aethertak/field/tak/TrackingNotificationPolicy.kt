package org.castaliainstitute.aethertak.field.tak

data class TrackingNotificationPrerequisites(
    val sdkInt: Int,
    val runtimePermissionGranted: Boolean,
    val appNotificationsEnabled: Boolean,
    val channelBlocked: Boolean,
)

fun trackingNotificationProblem(
    prerequisites: TrackingNotificationPrerequisites,
): String? = when {
    prerequisites.sdkInt >= 33 && !prerequisites.runtimePermissionGranted ->
        "Allow notifications so Android can visibly show background team location."
    !prerequisites.appNotificationsEnabled ->
        "Enable AetherTAK Field notifications before sharing background team location."
    prerequisites.channelBlocked ->
        "Enable the TAK background location notification channel before sharing."
    else -> null
}
