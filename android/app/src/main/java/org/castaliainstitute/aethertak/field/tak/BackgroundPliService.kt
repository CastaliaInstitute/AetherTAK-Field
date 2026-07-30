package org.castaliainstitute.aethertak.field.tak

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.BatteryManager
import android.os.Bundle
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import java.time.Instant
import org.castaliainstitute.aethertak.field.MainActivity

class BackgroundPliService : Service(), LocationListener {
    private lateinit var identityStore: TakIdentityStore
    private lateinit var transport: TakTlsTransport
    private lateinit var locationManager: LocationManager
    private var profile: TakProfile? = null
    private var pendingLocation: Location? = null
    private var connecting = false
    private var lastPublishedAt = 0L

    override fun onCreate() {
        super.onCreate()
        running = true
        lastError = null
        identityStore = TakIdentityStore(applicationContext)
        locationManager = getSystemService(LocationManager::class.java)
        transport = TakTlsTransport(
            identityStore = identityStore,
            onEvent = {},
            onDisconnected = { error ->
                connecting = false
                lastError = error
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        val enrolled = identityStore.load()
        if (enrolled == null) {
            lastError = "TAK enrollment is unavailable."
            stopSelf()
            return START_NOT_STICKY
        }
        if (!hasLocationPermission()) {
            lastError = "Precise or approximate location permission is required."
            stopSelf()
            return START_NOT_STICKY
        }
        profile = enrolled
        startVisible(enrolled.callsign)
        requestLocations()
        ensureConnected()
        return START_STICKY
    }

    override fun onLocationChanged(location: Location) {
        if (location.time > 0 && kotlin.math.abs(System.currentTimeMillis() - location.time) > 30_000L) {
            return
        }
        pendingLocation = location
        if (!transport.isConnected) {
            ensureConnected()
            return
        }
        publish(location)
    }

    @Deprecated("Deprecated in Android")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) {
        lastError = "$provider location provider is disabled."
    }

    override fun onDestroy() {
        running = false
        runCatching { locationManager.removeUpdates(this) }
        transport.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startVisible(callsign: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "TAK background location",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shows when AetherTAK Field is sharing team position."
            },
        )
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, BackgroundPliService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("AetherTAK team location is live")
            .setContentText("$callsign is sharing position with the TAK team.")
            .setContentIntent(openApp)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, "Stop sharing", stop)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun requestLocations() {
        if (!hasLocationPermission()) return
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false)) {
                try {
                    locationManager.requestLocationUpdates(
                        provider,
                        5_000L,
                        5f,
                        this,
                    )
                } catch (error: SecurityException) {
                    lastError = error.message
                }
            }
        }
    }

    private fun ensureConnected() {
        val activeProfile = profile ?: return
        if (transport.isConnected || connecting) return
        connecting = true
        transport.connect(activeProfile) { result ->
            connecting = false
            result.fold(
                onSuccess = {
                    lastError = null
                    pendingLocation?.let(::publish)
                },
                onFailure = { lastError = it.message },
            )
        }
    }

    private fun publish(location: Location) {
        val activeProfile = profile ?: return
        val now = System.currentTimeMillis()
        if (now - lastPublishedAt < 15_000L) return
        lastPublishedAt = now
        val xml = backgroundPliToCot(
            BackgroundPli(
                uid = "AETHER-${activeProfile.id}",
                callsign = activeProfile.callsign,
                team = activeProfile.team,
                latitude = location.latitude,
                longitude = location.longitude,
                altitudeMeters = location.takeIf(Location::hasAltitude)?.altitude,
                horizontalAccuracyMeters = location.takeIf(Location::hasAccuracy)
                    ?.accuracy
                    ?.toDouble(),
                headingDegrees = location.takeIf(Location::hasBearing)
                    ?.bearing
                    ?.toDouble(),
                speedMetersPerSecond = location.takeIf(Location::hasSpeed)
                    ?.speed
                    ?.toDouble(),
                verticalAccuracyMeters = if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                    location.hasVerticalAccuracy()
                ) {
                    location.verticalAccuracyMeters.toDouble()
                } else {
                    null
                },
                batteryPercent = batteryPercent(),
                deviceModel = Build.MODEL,
                osVersion = Build.VERSION.RELEASE,
                appVersion = packageManager
                    .getPackageInfo(packageName, 0)
                    .versionName ?: "unknown",
                createdAt = Instant.ofEpochMilli(now),
            ),
        )
        transport.send(xml) { result ->
            result.onFailure {
                lastError = it.message
                transport.disconnect()
                ensureConnected()
            }
        }
    }

    private fun hasLocationPermission(): Boolean =
        ActivityCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED ||
            ActivityCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED

    private fun batteryPercent(): Int? {
        val value = getSystemService(BatteryManager::class.java)
            .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return value.takeIf { it in 0..100 }
    }

    companion object {
        const val ACTION_START = "org.castaliainstitute.aethertak.field.START_BACKGROUND_PLI"
        const val ACTION_STOP = "org.castaliainstitute.aethertak.field.STOP_BACKGROUND_PLI"
        private const val CHANNEL_ID = "aethertak-background-pli"
        private const val NOTIFICATION_ID = 4821

        @Volatile var running = false
            private set
        @Volatile var lastError: String? = null
            private set
    }
}
