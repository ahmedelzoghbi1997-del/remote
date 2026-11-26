package com.universalremote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class CastProxyForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "cast_proxy_playback"
        const val NOTIFICATION_ID = 4108
        const val EXTRA_TITLE = "extra_title"
        const val ACTION_START = "com.universalremote.action.START_CAST_PROXY_FG"
        const val ACTION_STOP = "com.universalremote.action.STOP_CAST_PROXY_FG"

        fun start(context: Context, title: String) {
            val appCtx = context.applicationContext
            val intent = Intent(appCtx, CastProxyForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TITLE, title)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(appCtx, intent)
                } else {
                    appCtx.startService(intent)
                }
            } catch (_: Throwable) {
            }
        }

        fun stop(context: Context) {
            val appCtx = context.applicationContext
            try {
                appCtx.stopService(Intent(appCtx, CastProxyForegroundService::class.java))
            } catch (_: Throwable) {
            }
        }
    }

    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var isForegroundActive = false
    private var currentTitle: String = "فيديو مباشر"

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireLocks()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                LocalStreamProxyServer.stopAllSessions()
                CastProxyModule.notifyProxyStoppedFromService()
                stopForegroundSafely()
                releaseLocks()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val incomingTitle = intent?.getStringExtra(EXTRA_TITLE)?.trim().orEmpty()
                if (incomingTitle.isNotEmpty()) {
                    currentTitle = incomingTitle
                } else if (LocalStreamProxyServer.activeSessionTitle.isNotBlank()) {
                    currentTitle = LocalStreamProxyServer.activeSessionTitle
                }
                ensureForeground(currentTitle)
                return START_STICKY
            }
        }
    }

    private fun ensureForeground(title: String) {
        val notification = buildNotification(title)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        isForegroundActive = true
    }

    private fun buildNotification(title: String): Notification {
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(this, 21, openIntent, pendingFlags)

        val stopIntent = Intent(this, CastProxyForegroundService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(this, 22, stopIntent, pendingFlags)

        val safeTitle = title.ifBlank { "بث مباشر" }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("جاري البث إلى الشاشة — $safeTitle")
            .setContentText("البروكسي الذكي نشط في الخلفية (مقاوم لقفل الشاشة)")
            .setContentIntent(contentPendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, "إيقاف البث", stopPendingIntent)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "خدمة البث الخلفية (Proxy)",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "استمرار بث الفيديو للشاشة دون توقف عند قفل الهاتف"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.createNotificationChannel(channel)
        }
    }

    private fun acquireLocks() {
        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (wm != null && wifiLock == null) {
                val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                } else {
                    @Suppress("DEPRECATION")
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF
                }
                wifiLock = wm.createWifiLock(mode, "UniversalRemote:CastProxyWifiLock").apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (_: Throwable) {
        }

        try {
            val pm = applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null && wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "UniversalRemote:CastProxyWakeLock").apply {
                    setReferenceCounted(false)
                    acquire(6 * 60 * 60 * 1000L)
                }
            }
        } catch (_: Throwable) {
        }
    }

    private fun releaseLocks() {
        try {
            if (wifiLock?.isHeld == true) {
                wifiLock?.release()
            }
        } catch (_: Throwable) {
        }
        wifiLock = null

        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Throwable) {
        }
        wakeLock = null
    }

    private fun stopForegroundSafely() {
        if (!isForegroundActive) return
        isForegroundActive = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    override fun onDestroy() {
        releaseLocks()
        stopForegroundSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
