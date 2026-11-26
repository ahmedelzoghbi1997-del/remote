package com.universalremote

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors

class CastProxyModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val PICK_SUBTITLE_REQ = 45011
        private const val OPEN_SMART_BROWSER_REQ = 45012
        private const val EVENT_EXTERNAL_MEDIA = "onExternalMediaReceived"
        private const val EVENT_PROXY_STOPPED = "onCastProxyStopped"
        private const val EVENT_WEB_RECEIVER_STATE = "onWebReceiverState"
        private val URL_EXTRACT_REGEX = Regex("""https?://\S+""", RegexOption.IGNORE_CASE)

        @Volatile
        private var pendingExternalMedia: WritableMap? = null

        @Volatile
        private var activeModuleInstance: CastProxyModule? = null

        @Volatile
        private var lastActiveDlnaControlUrl: String? = null

        fun storeInitialIntent(intent: Intent?) {
            val parsed = parseExternalIntent(intent)
            if (parsed != null) {
                pendingExternalMedia = parsed
            }
        }

        fun handleNewIntent(activity: Activity, intent: Intent?) {
            val parsed = parseExternalIntent(intent) ?: return
            pendingExternalMedia = parsed
            try {
                val reactApp = activity.application as? com.facebook.react.ReactApplication
                val rnCtx = reactApp?.reactNativeHost?.reactInstanceManager?.currentReactContext
                if (rnCtx != null && rnCtx.hasActiveReactInstance()) {
                    pendingExternalMedia = null
                    rnCtx
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(EVENT_EXTERNAL_MEDIA, parsed)
                }
            } catch (_: Throwable) {
            }
        }

        fun notifyProxyStoppedFromService() {
            val mod = activeModuleInstance ?: return
            val map = Arguments.createMap().apply {
                putBoolean("stopped", true)
            }
            mod.emitEvent(EVENT_PROXY_STOPPED, map)
        }

        fun parseExternalIntent(intent: Intent?): WritableMap? {
            if (intent == null) return null
            val action = intent.action ?: return null

            var targetUrl = ""
            var isLocalUri = false
            var title = intent.getStringExtra(Intent.EXTRA_SUBJECT)
                ?: intent.getStringExtra(Intent.EXTRA_TITLE)
                ?: intent.getStringExtra("title")
                ?: intent.getStringExtra("name")
                ?: ""

            when (action) {
                Intent.ACTION_VIEW -> {
                    val dataUri = intent.data
                    val rawStr = intent.dataString ?: dataUri?.toString().orEmpty()
                    if (rawStr.isBlank()) return null
                    val scheme = dataUri?.scheme?.lowercase(Locale.US) ?: ""
                    isLocalUri = scheme == "content" || scheme == "file"
                    targetUrl = rawStr.trim()
                }
                Intent.ACTION_SEND -> {
                    val streamUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(Intent.EXTRA_STREAM)
                    }
                    if (streamUri != null) {
                        targetUrl = streamUri.toString().trim()
                        val scheme = streamUri.scheme?.lowercase(Locale.US) ?: ""
                        isLocalUri = scheme == "content" || scheme == "file" || scheme.isEmpty()
                    } else {
                        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
                        val match = URL_EXTRACT_REGEX.find(sharedText)
                        if (match != null) {
                            targetUrl = match.value.trimEnd('.', ',', ')', ']', '"', '\'')
                            if (title.isBlank()) {
                                title = sharedText.replace(match.value, "").trim()
                            }
                        }
                    }
                }
                else -> return null
            }

            if (targetUrl.isBlank()) return null

            val headersMap = Arguments.createMap()
            extractHeadersFromExtras(intent.extras, headersMap)
            val subtitleUrl = extractSubtitleFromExtras(intent.extras)

            val map = Arguments.createMap()
            map.putString("url", targetUrl)
            map.putBoolean("isLocalUri", isLocalUri)
            map.putString("title", title.trim())
            map.putString("mimeType", intent.type ?: "")
            map.putString("action", action)
            map.putMap("headers", headersMap)
            if (!subtitleUrl.isNullOrBlank()) {
                map.putString("subtitleUrl", subtitleUrl)
            } else {
                map.putNull("subtitleUrl")
            }
            return map
        }

        private fun extractHeadersFromExtras(extras: Bundle?, outMap: WritableMap) {
            if (extras == null) return

            fun putNormalized(rawKey: String?, rawVal: Any?, overwrite: Boolean = true) {
                val k = rawKey?.trim().orEmpty()
                val v = rawVal?.toString()?.trim().orEmpty()
                if (k.isBlank() || v.isBlank()) return
                val canonical = when (k.lowercase(Locale.US)) {
                    "referer", "referrer" -> "Referer"
                    "user-agent", "user_agent" -> "User-Agent"
                    "cookie", "cookies" -> "Cookie"
                    "origin" -> "Origin"
                    "authorization" -> "Authorization"
                    else -> k
                }
                if (!overwrite && outMap.hasKey(canonical)) return
                outMap.putString(canonical, v)
            }

            for (extraKey in extras.keySet()) {
                val lowerKey = extraKey.lowercase(Locale.US)
                @Suppress("DEPRECATION")
                val value = extras.get(extraKey)
                if (lowerKey == "headers" || lowerKey == "android.media.intent.extra.http_headers") {
                    when (value) {
                        is Array<*> -> {
                            val items = value.mapNotNull { it?.toString() }
                            var idx = 0
                            while (idx + 1 < items.size) {
                                putNormalized(items[idx], items[idx + 1])
                                idx += 2
                            }
                        }
                        is List<*> -> {
                            val items = value.mapNotNull { it?.toString() }
                            var idx = 0
                            while (idx + 1 < items.size) {
                                putNormalized(items[idx], items[idx + 1])
                                idx += 2
                            }
                        }
                        is Bundle -> {
                            for (subKey in value.keySet()) {
                                @Suppress("DEPRECATION")
                                putNormalized(subKey, value.get(subKey))
                            }
                        }
                        is Map<*, *> -> {
                            for ((mk, mv) in value) {
                                putNormalized(mk?.toString(), mv)
                            }
                        }
                    }
                } else if (lowerKey in setOf("referer", "referrer", "user-agent", "user_agent", "cookie", "cookies", "origin", "authorization")) {
                    putNormalized(extraKey, value)
                }
            }

            @Suppress("DEPRECATION")
            val rawExtraRef = extras.get(Intent.EXTRA_REFERRER) ?: extras.get(Intent.EXTRA_REFERRER_NAME)
            val refStr = rawExtraRef?.toString()?.trim().orEmpty()
            if (refStr.startsWith("http://", ignoreCase = true) || refStr.startsWith("https://", ignoreCase = true)) {
                putNormalized("Referer", refStr, overwrite = false)
            }
        }

        private fun extractSubtitleFromExtras(extras: Bundle?): String? {
            if (extras == null) return null
            val candidateKeys = listOf("subs.uri", "subs", "subtitle", "subtitles", "sub")
            for (extraKey in extras.keySet()) {
                if (extraKey.lowercase(Locale.US) !in candidateKeys) continue
                @Suppress("DEPRECATION")
                val v = extras.get(extraKey)
                when (v) {
                    is Uri -> return v.toString()
                    is String -> if (v.isNotBlank()) return v.trim()
                    is Array<*> -> {
                        val first = v.firstOrNull { it != null && it.toString().isNotBlank() }
                        if (first != null) return first.toString().trim()
                    }
                    is List<*> -> {
                        val first = v.firstOrNull { it != null && it.toString().isNotBlank() }
                        if (first != null) return first.toString().trim()
                    }
                }
            }
            return null
        }
    }

    private val bgExecutor = Executors.newCachedThreadPool()
    private val soapClient: DlnaSoapClient by lazy { DlnaSoapClient(reactApplicationContext) }

    @Volatile
    private var pickSubtitlePromise: Promise? = null

    @Volatile
    private var smartBrowserPromise: Promise? = null

    init {
        activeModuleInstance = this
        reactContext.addActivityEventListener(this)
        LocalStreamProxyServer.setReceiverStateListener { stateJson ->
            val map = Arguments.createMap().apply {
                putString("json", stateJson)
            }
            emitEvent(EVENT_WEB_RECEIVER_STATE, map)
        }
    }

    override fun getName(): String = "CastProxyModule"

    private fun emitEvent(eventName: String, params: WritableMap) {
        try {
            if (reactApplicationContext.hasActiveReactInstance()) {
                reactApplicationContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
            }
        } catch (_: Throwable) {
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for React Native NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native NativeEventEmitter
    }

    @ReactMethod
    fun getPendingExternalIntent(promise: Promise) {
        val pending = pendingExternalMedia
        pendingExternalMedia = null
        promise.resolve(pending)
    }

    @ReactMethod
    fun startProxySession(
        url: String,
        headersMap: ReadableMap?,
        title: String?,
        subtitleUrl: String?,
        promise: Promise
    ) {
        bgExecutor.execute {
            try {
                val headers = readableMapToStringMap(headersMap)
                val safeTitle = title?.trim().orEmpty().ifBlank { "بث فيديو" }
                val info = LocalStreamProxyServer.createSession(
                    context = reactApplicationContext,
                    targetUrl = url,
                    headers = headers,
                    title = safeTitle,
                    subtitleUrlOrPath = subtitleUrl
                )
                CastProxyForegroundService.start(reactApplicationContext, safeTitle)
                promise.resolve(sessionInfoToWritableMap(info))
            } catch (e: Throwable) {
                promise.reject("PROXY_START_ERROR", e.message ?: "تعذر تشغيل خادم البروكسي المحلي.", e)
            }
        }
    }

    @ReactMethod
    fun updateSessionSubtitle(
        sessionId: String,
        subtitleUrlOrPath: String?,
        offsetMs: Double,
        promise: Promise
    ) {
        bgExecutor.execute {
            try {
                val info = LocalStreamProxyServer.updateSessionSubtitle(
                    context = reactApplicationContext,
                    sessionId = sessionId,
                    subtitleUrlOrPath = subtitleUrlOrPath,
                    offsetMs = offsetMs.toLong()
                )
                promise.resolve(sessionInfoToWritableMap(info))
            } catch (e: Throwable) {
                promise.reject("PROXY_SUBTITLE_ERROR", e.message ?: "تعذر تحديث ملف الترجمة.", e)
            }
        }
    }

    @ReactMethod
    fun getServerInfo(promise: Promise) {
        bgExecutor.execute {
            try {
                val lanIp = LocalStreamProxyServer.detectLanIpv4Address(reactApplicationContext)
                    ?: throw IllegalStateException("عنوان Wi-Fi المحلي غير متاح. تأكد من الاتصال بالواي فاي.")
                val port = LocalStreamProxyServer.ensureStarted(reactApplicationContext)
                val out = Arguments.createMap().apply {
                    putString("lanIp", lanIp)
                    putInt("port", port)
                    putString("receiverUrl", "http://$lanIp:$port/tv")
                }
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("SERVER_INFO_ERROR", e.message ?: "تعذر تشغيل الخادم المحلي.", e)
            }
        }
    }

    @ReactMethod
    fun sendReceiverCommand(type: String, payloadJson: String?, promise: Promise) {
        bgExecutor.execute {
            try {
                LocalStreamProxyServer.ensureStarted(reactApplicationContext)
                if (type.trim() == "load" && !payloadJson.isNullOrBlank()) {
                    val title = try {
                        JSONObject(payloadJson).optString("title", "").ifBlank { "مشغّل السينما الذكي" }
                    } catch (_: Throwable) {
                        "مشغّل السينما الذكي"
                    }
                    CastProxyForegroundService.start(reactApplicationContext, title)
                }
                val seq = LocalStreamProxyServer.pushReceiverCommand(type, payloadJson)
                val out = Arguments.createMap().apply {
                    putBoolean("ok", true)
                    putDouble("seq", seq.toDouble())
                }
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("RECEIVER_CMD_ERROR", e.message ?: "تعذر إرسال الأمر إلى مشغّل الشاشة.", e)
            }
        }
    }

    @ReactMethod
    fun getReceiverState(promise: Promise) {
        promise.resolve(LocalStreamProxyServer.getReceiverStateJson())
    }

    @ReactMethod
    fun openSmartBrowser(initialUrl: String?, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "لا توجد نافذة نشطة لفتح متصفح الصيد الذكي.")
            return
        }
        smartBrowserPromise?.reject("BROWSER_CANCELLED", "تم فتح نافذة تصفح جديدة.")
        smartBrowserPromise = promise
        try {
            val intent = Intent(activity, MediaSnifferActivity::class.java).apply {
                if (!initialUrl.isNullOrBlank()) {
                    putExtra(MediaSnifferActivity.EXTRA_INITIAL_URL, initialUrl.trim())
                }
            }
            activity.startActivityForResult(intent, OPEN_SMART_BROWSER_REQ)
        } catch (e: Throwable) {
            smartBrowserPromise = null
            promise.reject("SMART_BROWSER_ERROR", e.message ?: "تعذر فتح متصفح الصيد الذكي.", e)
        }
    }

    @ReactMethod
    fun copyToClipboard(text: String, promise: Promise) {
        try {
            val cm = reactApplicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("SmartReceiverUrl", text))
            }
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject("CLIPBOARD_ERROR", e.message ?: "تعذر النسخ إلى الحافظة.", e)
        }
    }

    @ReactMethod
    fun stopProxySession(promise: Promise) {
        bgExecutor.execute {
            try {
                val ctrlUrl = lastActiveDlnaControlUrl
                lastActiveDlnaControlUrl = null
                if (!ctrlUrl.isNullOrBlank()) {
                    try {
                        soapClient.stop(ctrlUrl)
                    } catch (_: Throwable) {
                    }
                }
                LocalStreamProxyServer.stopAllSessions()
                CastProxyForegroundService.stop(reactApplicationContext)
                promise.resolve(true)
            } catch (e: Throwable) {
                promise.reject("PROXY_STOP_ERROR", e.message ?: "تعذر إيقاف خادم البروكسي.", e)
            }
        }
    }

    @ReactMethod
    fun pickLocalSubtitle(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "لا توجد نافذة نشطة لفتح منتقي الملفات.")
            return
        }
        pickSubtitlePromise?.reject("PICK_CANCELLED", "تم استبدال طلب اختيار الترجمة.")
        pickSubtitlePromise = promise
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    arrayOf("application/x-subrip", "text/vtt", "text/srt", "text/plain")
                )
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, PICK_SUBTITLE_REQ)
        } catch (e: Throwable) {
            pickSubtitlePromise = null
            promise.reject("PICK_SUBTITLE_ERROR", e.message ?: "تعذر فتح منتقي ملفات الترجمة.", e)
        }
    }

    @ReactMethod
    fun castSessionToDlna(
        targetIp: String?,
        streamUrl: String,
        title: String?,
        subtitleUrl: String?,
        mimeType: String?,
        promise: Promise
    ) {
        bgExecutor.execute {
            try {
                val cleanIp = targetIp?.trim().orEmpty()
                val discovered = soapClient.discoverRenderers(cleanIp.ifBlank { null })
                val targetDevice = discovered.firstOrNull()
                    ?: if (cleanIp.isNotBlank()) {
                        DlnaRendererDevice(
                            udn = "manual:$cleanIp",
                            name = "Samsung TV ($cleanIp)",
                            manufacturer = "Samsung Electronics",
                            modelName = "DLNA DMR",
                            ip = cleanIp,
                            port = 9197,
                            location = "http://$cleanIp:9197/dmr",
                            avTransportControlUrl = "http://$cleanIp:9197/upnp/control/AVTransport1",
                            renderingControlUrl = "http://$cleanIp:9197/upnp/control/RenderingControl1"
                        )
                    } else {
                        null
                    }

                if (targetDevice == null) {
                    promise.reject("NO_DLNA_TV", "لم يتم العثور على شاشة تدعم DLNA على الشبكة. أدخل IP الشاشة في الإعدادات.")
                    return@execute
                }

                lastActiveDlnaControlUrl = targetDevice.avTransportControlUrl
                try {
                    soapClient.stop(targetDevice.avTransportControlUrl)
                    Thread.sleep(150)
                } catch (_: Throwable) {
                }

                val safeTitle = title?.trim().orEmpty().ifBlank { "Video Stream" }
                val safeMime = mimeType?.trim().orEmpty().ifBlank { "video/mp4" }
                val isHls = safeMime.contains("mpegurl", ignoreCase = true) ||
                    streamUrl.lowercase(Locale.US).contains(".m3u8")

                soapClient.setAvTransportUri(
                    controlUrl = targetDevice.avTransportControlUrl,
                    mediaUrl = streamUrl,
                    title = safeTitle,
                    mimeType = safeMime,
                    isSeekable = !isHls,
                    isDirectExternal = false,
                    subtitleUrl = subtitleUrl?.takeIf { it.isNotBlank() },
                    isHlsVod = false
                )
                soapClient.play(targetDevice.avTransportControlUrl)

                val out = Arguments.createMap().apply {
                    putBoolean("casted", true)
                    putString("deviceName", targetDevice.name)
                    putString("deviceIp", targetDevice.ip)
                }
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("DLNA_CAST_ERROR", e.message ?: "تعذر بدء البث إلى مشغّل الشاشة DLNA.", e)
            }
        }
    }

    private fun jsonObjToWritableMap(obj: JSONObject?): WritableMap {
        val map = Arguments.createMap()
        if (obj == null) return map
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val v = obj.optString(k, "")
            if (v.isNotBlank()) {
                map.putString(k, v)
            }
        }
        return map
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == OPEN_SMART_BROWSER_REQ) {
            val promise = smartBrowserPromise ?: return
            smartBrowserPromise = null
            val rawJson = data?.getStringExtra(MediaSnifferActivity.EXTRA_RESULT_JSON)
            if (resultCode != Activity.RESULT_OK || rawJson.isNullOrBlank()) {
                promise.reject("BROWSER_CANCELLED", "تم إغلاق المتصفح دون اختيار فيديو.")
                return
            }
            try {
                val root = JSONObject(rawJson)
                val out = Arguments.createMap()
                out.putString("mode", root.optString("mode", "cast"))
                val vid = root.getJSONObject("video")
                val vidMap = Arguments.createMap().apply {
                    putString("url", vid.optString("url"))
                    putString("title", vid.optString("title"))
                    putString("mimeType", vid.optString("mimeType", "video/mp4"))
                    putMap("headers", jsonObjToWritableMap(vid.optJSONObject("headers")))
                }
                out.putMap("video", vidMap)
                val sub = root.optJSONObject("subtitle")
                if (sub != null) {
                    val subMap = Arguments.createMap().apply {
                        putString("url", sub.optString("url"))
                        putString("title", sub.optString("title"))
                        putString("mimeType", sub.optString("mimeType", "text/srt"))
                        putMap("headers", jsonObjToWritableMap(sub.optJSONObject("headers")))
                    }
                    out.putMap("subtitle", subMap)
                }
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("BROWSER_PARSE_ERROR", e.message ?: "تعذر قراءة بيانات الرابط الملتقط.", e)
            }
            return
        }

        if (requestCode != PICK_SUBTITLE_REQ) return
        val promise = pickSubtitlePromise ?: return
        pickSubtitlePromise = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            promise.reject("PICK_CANCELLED", "لم يتم اختيار ملف ترجمة.")
            return
        }
        val uri = data.data!!
        try {
            val flags = data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION
            if (flags != 0) {
                reactApplicationContext.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
        } catch (_: Throwable) {
        }

        var displayName = "subtitle.srt"
        var sizeBytes = -1L
        try {
            reactApplicationContext.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                        displayName = cursor.getString(nameIdx) ?: displayName
                    }
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        sizeBytes = cursor.getLong(sizeIdx)
                    }
                }
            }
        } catch (_: Throwable) {
        }

        val lowerName = displayName.lowercase(Locale.US)
        val lowerUri = uri.toString().lowercase(Locale.US)
        if (!lowerName.endsWith(".srt") && !lowerName.endsWith(".vtt") &&
            !lowerUri.endsWith(".srt") && !lowerUri.endsWith(".vtt")
        ) {
            promise.reject("INVALID_SUBTITLE_FILE", "يرجى اختيار ملف ترجمة بصيغة .srt أو .vtt فقط.")
            return
        }

        val res = Arguments.createMap().apply {
            putString("uri", uri.toString())
            putString("name", displayName)
            putDouble("sizeBytes", sizeBytes.toDouble())
            putString("mimeType", reactApplicationContext.contentResolver.getType(uri) ?: "text/srt")
        }
        promise.resolve(res)
    }

    override fun onNewIntent(intent: Intent) {
        val parsed = parseExternalIntent(intent) ?: return
        emitEvent(EVENT_EXTERNAL_MEDIA, parsed)
    }

    private fun sessionInfoToWritableMap(info: ProxySessionInfo): WritableMap {
        return Arguments.createMap().apply {
            putString("sessionId", info.sessionId)
            putString("proxyStreamUrl", info.proxyStreamUrl)
            if (!info.proxySubtitleUrl.isNullOrBlank()) {
                putString("proxySubtitleUrl", info.proxySubtitleUrl)
            } else {
                putNull("proxySubtitleUrl")
            }
            if (!info.proxySubtitleVttUrl.isNullOrBlank()) {
                putString("proxySubtitleVttUrl", info.proxySubtitleVttUrl)
            } else {
                putNull("proxySubtitleVttUrl")
            }
            putString("lanIp", info.lanIp)
            putInt("port", info.port)
        }
    }

    private fun readableMapToStringMap(m: ReadableMap?): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        if (m == null) return out
        val iter = m.keySetIterator()
        while (iter.hasNextKey()) {
            val k = iter.nextKey()
            val v = m.getString(k)
            if (!v.isNullOrBlank()) {
                out[k] = v
            }
        }
        return out
    }

    override fun onCatalystInstanceDestroy() {
        if (activeModuleInstance === this) {
            activeModuleInstance = null
        }
        LocalStreamProxyServer.setReceiverStateListener(null)
        reactApplicationContext.removeActivityEventListener(this)
        bgExecutor.shutdownNow()
        super.onCatalystInstanceDestroy()
    }
}
