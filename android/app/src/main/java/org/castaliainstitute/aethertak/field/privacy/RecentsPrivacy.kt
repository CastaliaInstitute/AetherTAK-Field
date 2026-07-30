package org.castaliainstitute.aethertak.field.privacy

import android.app.Activity
import android.os.Build
import android.view.WindowManager

enum class RecentsPrivacyStrategy {
    DISABLE_RECENTS_SCREENSHOT,
    SECURE_WHILE_PAUSED,
}

fun recentsPrivacyStrategy(sdkInt: Int): RecentsPrivacyStrategy =
    if (sdkInt >= Build.VERSION_CODES.TIRAMISU) {
        RecentsPrivacyStrategy.DISABLE_RECENTS_SCREENSHOT
    } else {
        RecentsPrivacyStrategy.SECURE_WHILE_PAUSED
    }

object RecentsPrivacy {
    fun configure(activity: Activity) {
        if (
            recentsPrivacyStrategy(Build.VERSION.SDK_INT) ==
            RecentsPrivacyStrategy.DISABLE_RECENTS_SCREENSHOT
        ) {
            activity.setRecentsScreenshotEnabled(false)
        }
    }

    fun obscureBeforePause(activity: Activity) {
        if (
            recentsPrivacyStrategy(Build.VERSION.SDK_INT) ==
            RecentsPrivacyStrategy.SECURE_WHILE_PAUSED
        ) {
            activity.window.addFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
            )
        }
    }

    fun revealAfterResume(activity: Activity) {
        if (
            recentsPrivacyStrategy(Build.VERSION.SDK_INT) ==
            RecentsPrivacyStrategy.SECURE_WHILE_PAUSED
        ) {
            activity.window.clearFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
            )
        }
    }
}
