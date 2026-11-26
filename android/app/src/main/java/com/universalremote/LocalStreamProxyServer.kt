package com.universalremote

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.PushbackInputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.LinkedList
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

data class StreamSession(
    val sessionId: String,
    val targetUrl: String,
    val headers: Map<String, String>,
    val title: String,
    @Volatile var subtitleUrlOrPath: String? = null,
    @Volatile var subtitleOffsetMs: Long = 0L,
    @Volatile var cachedSubSourceKey: String = "",
    @Volatile var cachedSubRawBytes: ByteArray? = null,
    @Volatile var srtBytes: ByteArray? = null,
    @Volatile var vttBytes: ByteArray? = null
)

data class ProxySessionInfo(
    val sessionId: String,
    val proxyStreamUrl: String,
    val proxySubtitleUrl: String?,
    val proxySubtitleVttUrl: String?,
    val lanIp: String,
    val port: Int
)

object LocalStreamProxyServer {
    private const val BASE_PORT = 8899
    private const val MAX_PORT = 8920
    private const val STREAM_BUFFER_SIZE = 65536 // 64 KB fixed streaming chunk buffer
    private const val MAX_PLAYLIST_BYTES = 4 * 1024 * 1024 // 4 MB safety limit for text playlists
    private const val M3U8_CACHE_TTL_MS = 8_000L
    private const val DEFAULT_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

    private val URI_ATTR_REGEX = Regex("""(URI\s*=\s*")([^"]+)(")""", RegexOption.IGNORE_CASE)
    private val HOP_BY_HOP_HEADERS = setOf(
        "host",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "accept-encoding",
        "content-length",
        "range",
        "x-requested-with"
    )
    private val IGNORED_IFACE_PREFIXES = listOf("tun", "tap", "ppp", "wg", "rmnet", "ccmni", "lo", "dummy")

    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectionPool(ConnectionPool(16, 5, TimeUnit.MINUTES))
            .retryOnConnectionFailure(true)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private data class CachedPlaylistEntry(
        val bytes: ByteArray,
        val expiresAtMs: Long
    )

    private val sessions = ConcurrentHashMap<String, StreamSession>()
    private val m3u8Cache = ConcurrentHashMap<String, CachedPlaylistEntry>()

    private const val MAX_CMD_LOG = 60
    private val cmdLock = Object()

    @Volatile
    private var cmdSeq: Long = 0L

    private val commandLog = LinkedList<Pair<Long, String>>()

    @Volatile
    private var activeLoadPayloadJson: String? = null

    @Volatile
    private var currentSubtitleStyleJson: String = JSONObject().apply {
        put("fontSize", 34)
        put("color", "#FFFFFF")
        put("bgOpacity", 0.45)
        put("verticalOffset", 8)
        put("offsetSec", 0.0)
    }.toString()

    @Volatile
    private var lastReceiverStateJson: String = defaultIdleReceiverStateJson()

    @Volatile
    private var receiverStateListener: ((String) -> Unit)? = null

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var serverSocket: ServerSocket? = null

    @Volatile
    private var acceptThread: Thread? = null

    @Volatile
    private var workerPool: ThreadPoolExecutor? = null

    @Volatile
    private var running = false

    @Volatile
    private var boundPort = 0

    @Volatile
    var activeSessionTitle: String = ""
        private set

    fun getPort(): Int = boundPort

    private fun defaultIdleReceiverStateJson(): String {
        return JSONObject().apply {
            put("sessionId", "")
            put("status", "idle")
            put("positionSec", 0.0)
            put("durationSec", 0.0)
            put("bufferedSec", 0.0)
            put("qualityIndex", -1)
            put("levels", JSONArray())
            put("playbackRate", 1.0)
            put("aspectMode", "contain")
            put("volume", 100)
            put("muted", false)
            put("title", "")
            put("errorMessage", "")
            put("updatedAtMs", 0L)
        }.toString()
    }

    fun setReceiverStateListener(listener: ((String) -> Unit)?) {
        receiverStateListener = listener
    }

    fun getReceiverStateJson(): String = lastReceiverStateJson

    fun pushReceiverCommand(type: String, payloadJson: String?): Long {
        val cleanType = type.trim()
        require(cleanType.isNotEmpty()) { "نوع أمر المشغّل فارغ." }
        val payloadObj = if (!payloadJson.isNullOrBlank()) {
            try {
                JSONObject(payloadJson)
            } catch (_: Throwable) {
                JSONObject()
            }
        } else {
            JSONObject()
        }

        when (cleanType) {
            "load" -> {
                activeLoadPayloadJson = payloadObj.toString()
                lastReceiverStateJson = JSONObject().apply {
                    put("sessionId", payloadObj.optString("sessionId", ""))
                    put("status", "loading")
                    put("positionSec", payloadObj.optDouble("startPositionSec", 0.0))
                    put("durationSec", 0.0)
                    put("bufferedSec", 0.0)
                    put("qualityIndex", -1)
                    put("levels", JSONArray())
                    put("playbackRate", 1.0)
                    put("aspectMode", "contain")
                    put("volume", 100)
                    put("muted", false)
                    put("title", payloadObj.optString("title", ""))
                    put("errorMessage", "")
                    put("updatedAtMs", System.currentTimeMillis())
                }.toString()
            }
            "stop" -> {
                activeLoadPayloadJson = null
                lastReceiverStateJson = defaultIdleReceiverStateJson()
            }
            "setSubtitleUrl" -> {
                val snap = activeLoadPayloadJson
                if (!snap.isNullOrBlank()) {
                    try {
                        val obj = JSONObject(snap)
                        obj.put("subtitleUrl", payloadObj.optString("subtitleUrl", ""))
                        activeLoadPayloadJson = obj.toString()
                    } catch (_: Throwable) {
                    }
                }
            }
            "setSubtitleStyle" -> {
                try {
                    val merged = JSONObject(currentSubtitleStyleJson)
                    val keys = payloadObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        merged.put(k, payloadObj.get(k))
                    }
                    currentSubtitleStyleJson = merged.toString()
                } catch (_: Throwable) {
                }
            }
        }

        val assignedSeq: Long
        synchronized(cmdLock) {
            assignedSeq = ++cmdSeq
            val cmdJson = JSONObject().apply {
                put("seq", assignedSeq)
                put("type", cleanType)
                put("payload", payloadObj)
            }.toString()
            commandLog.addLast(Pair(assignedSeq, cmdJson))
            while (commandLog.size > MAX_CMD_LOG) {
                commandLog.removeFirst()
            }
            cmdLock.notifyAll()
        }
        return assignedSeq
    }

    private fun buildInitSnapshotJson(): String {
        val snap = JSONObject()
        synchronized(cmdLock) {
            snap.put("seq", cmdSeq)
        }
        try {
            snap.put("subtitleStyle", JSONObject(currentSubtitleStyleJson))
        } catch (_: Throwable) {
        }
        val loadStr = activeLoadPayloadJson
        if (!loadStr.isNullOrBlank()) {
            try {
                snap.put("activeLoad", JSONObject(loadStr))
            } catch (_: Throwable) {
            }
        }
        return snap.toString()
    }

    private fun buildPollResponseJson(sinceSeq: Long): String {
        val out = JSONObject()
        val cmds = JSONArray()
        val latestSeq: Long
        synchronized(cmdLock) {
            latestSeq = cmdSeq
            if (sinceSeq > 0L) {
                for ((seq, jsonStr) in commandLog) {
                    if (seq > sinceSeq) {
                        try {
                            cmds.put(JSONObject(jsonStr))
                        } catch (_: Throwable) {
                        }
                    }
                }
            }
        }
        out.put("seq", latestSeq)
        out.put("commands", cmds)
        if (sinceSeq <= 0L) {
            try {
                out.put("subtitleStyle", JSONObject(currentSubtitleStyleJson))
            } catch (_: Throwable) {
            }
            val loadStr = activeLoadPayloadJson
            if (!loadStr.isNullOrBlank()) {
                try {
                    out.put("activeLoad", JSONObject(loadStr))
                } catch (_: Throwable) {
                }
            }
        }
        return out.toString()
    }

    fun detectLanIpv4Address(context: Context): String? {
        val appCtx = context.applicationContext
        try {
            val cm = appCtx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (cm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                var fallbackSiteLocal: String? = null
                for (net in cm.allNetworks) {
                    val caps = cm.getNetworkCapabilities(net) ?: continue
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
                    if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                        !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    ) continue
                    val linkProps = cm.getLinkProperties(net) ?: continue
                    val ifaceName = linkProps.interfaceName?.lowercase(Locale.US).orEmpty()
                    if (IGNORED_IFACE_PREFIXES.any { ifaceName.startsWith(it) }) continue

                    for (linkAddr in linkProps.linkAddresses) {
                        val addr = linkAddr.address
                        if (addr is Inet4Address && !addr.isLoopbackAddress && !addr.isLinkLocalAddress && addr.isSiteLocalAddress) {
                            val ip = addr.hostAddress ?: continue
                            if (ip.startsWith("192.168.") || ip.startsWith("10.")) {
                                return ip
                            }
                            if (fallbackSiteLocal == null) fallbackSiteLocal = ip
                        }
                    }
                }
                if (fallbackSiteLocal != null) return fallbackSiteLocal
            }
        } catch (_: Throwable) {
        }

        try {
            var fallbackSiteLocal: String? = null
            val ifaces = NetworkInterface.getNetworkInterfaces()
            while (ifaces != null && ifaces.hasMoreElements()) {
                val iface = ifaces.nextElement()
                if (!iface.isUp || iface.isLoopback || iface.isVirtual) continue
                val name = iface.name?.lowercase(Locale.US).orEmpty()
                if (IGNORED_IFACE_PREFIXES.any { name.startsWith(it) }) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress && !addr.isLinkLocalAddress && addr.isSiteLocalAddress) {
                        val ip = addr.hostAddress ?: continue
                        if (ip.startsWith("192.168.") || ip.startsWith("10.")) {
                            return ip
                        }
                        if (fallbackSiteLocal == null) fallbackSiteLocal = ip
                    }
                }
            }
            if (fallbackSiteLocal != null) return fallbackSiteLocal
        } catch (_: Throwable) {
        }
        return null
    }

    @Synchronized
    fun ensureStarted(context: Context): Int {
        appContext = context.applicationContext
        if (running && serverSocket != null && serverSocket?.isClosed == false && boundPort > 0) {
            return boundPort
        }
        stopServerSocketOnly()

        var socket: ServerSocket? = null
        var chosenPort = 0
        for (candidatePort in BASE_PORT..MAX_PORT) {
            try {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress(candidatePort))
                socket = ss
                chosenPort = candidatePort
                break
            } catch (_: Throwable) {
            }
        }
        if (socket == null) {
            val fallbackSocket = ServerSocket(0).apply { reuseAddress = true }
            socket = fallbackSocket
            chosenPort = fallbackSocket.localPort
        }

        val pool = ThreadPoolExecutor(
            6,
            32,
            60L,
            TimeUnit.SECONDS,
            LinkedBlockingQueue(256)
        )
        pool.allowCoreThreadTimeOut(true)

        serverSocket = socket
        boundPort = chosenPort
        workerPool = pool
        running = true

        val activeSocket = socket
        acceptThread = Thread({
            while (running && !activeSocket.isClosed) {
                try {
                    val client = activeSocket.accept()
                    pool.execute { handleClient(client) }
                } catch (_: Throwable) {
                    if (!running || activeSocket.isClosed) break
                }
            }
        }, "LocalStreamProxyAccept").apply {
            isDaemon = true
            start()
        }
        return chosenPort
    }

    @Synchronized
    private fun stopServerSocketOnly() {
        running = false
        boundPort = 0
        try {
            serverSocket?.close()
        } catch (_: Throwable) {
        }
        serverSocket = null
        try {
            workerPool?.shutdownNow()
        } catch (_: Throwable) {
        }
        workerPool = null
        acceptThread = null
    }

    @Synchronized
    fun stopAllSessions() {
        sessions.clear()
        m3u8Cache.clear()
        activeSessionTitle = ""
        activeLoadPayloadJson = null
        lastReceiverStateJson = defaultIdleReceiverStateJson()
        synchronized(cmdLock) {
            cmdLock.notifyAll()
        }
        stopServerSocketOnly()
    }

    fun createSession(
        context: Context,
        targetUrl: String,
        headers: Map<String, String> = emptyMap(),
        title: String = "",
        subtitleUrlOrPath: String? = null
    ): ProxySessionInfo {
        val cleanTarget = targetUrl.trim()
        require(cleanTarget.isNotEmpty()) { "رابط البث فارغ." }
        val lanIp = detectLanIpv4Address(context)
            ?: throw IllegalStateException("عنوان Wi-Fi المحلي غير متاح. تأكد من الاتصال بالواي فاي.")
        val port = ensureStarted(context)
        val sessionId = UUID.randomUUID().toString().replace("-", "").take(16)

        val cleanHeaders = LinkedHashMap<String, String>()
        for ((k, v) in headers) {
            val ck = k.trim()
            val cv = v.trim()
            if (ck.isNotEmpty() && cv.isNotEmpty()) {
                cleanHeaders[ck] = cv
            }
        }

        val session = StreamSession(
            sessionId = sessionId,
            targetUrl = cleanTarget,
            headers = cleanHeaders,
            title = title.trim().ifBlank { "Video Stream" },
            subtitleUrlOrPath = subtitleUrlOrPath?.trim()?.takeIf { it.isNotEmpty() }
        )

        if (!session.subtitleUrlOrPath.isNullOrBlank()) {
            loadAndProcessSubtitle(context, session, session.subtitleUrlOrPath!!, 0L)
        }

        sessions[sessionId] = session
        activeSessionTitle = session.title

        val base = "http://$lanIp:$port"
        val hasSub = session.srtBytes != null
        return ProxySessionInfo(
            sessionId = sessionId,
            proxyStreamUrl = "$base/stream/$sessionId",
            proxySubtitleUrl = if (hasSub) "$base/sub/$sessionId.srt" else null,
            proxySubtitleVttUrl = if (hasSub) "$base/sub/$sessionId.vtt" else null,
            lanIp = lanIp,
            port = port
        )
    }

    fun updateSessionSubtitle(
        context: Context,
        sessionId: String,
        subtitleUrlOrPath: String?,
        offsetMs: Long = 0L
    ): ProxySessionInfo {
        val session = sessions[sessionId]
            ?: throw IllegalArgumentException("جلسة البث ($sessionId) غير موجودة.")
        val cleanSub = subtitleUrlOrPath?.trim()?.takeIf { it.isNotEmpty() }
        session.subtitleUrlOrPath = cleanSub
        session.subtitleOffsetMs = offsetMs

        if (cleanSub == null) {
            session.cachedSubSourceKey = ""
            session.cachedSubRawBytes = null
            session.srtBytes = null
            session.vttBytes = null
        } else {
            loadAndProcessSubtitle(context, session, cleanSub, offsetMs)
        }

        val lanIp = detectLanIpv4Address(context) ?: "127.0.0.1"
        val port = getPort().takeIf { it > 0 } ?: BASE_PORT
        val base = "http://$lanIp:$port"
        val hasSub = session.srtBytes != null

        val activeLoadStr = activeLoadPayloadJson
        if (!activeLoadStr.isNullOrBlank()) {
            try {
                val activeObj = JSONObject(activeLoadStr)
                if (activeObj.optString("sessionId", "") == sessionId) {
                    val vttUrl = if (hasSub) "$base/sub/$sessionId.vtt?_v=${System.currentTimeMillis()}" else ""
                    pushReceiverCommand(
                        "setSubtitleUrl",
                        JSONObject().apply { put("subtitleUrl", vttUrl) }.toString()
                    )
                    pushReceiverCommand(
                        "setSubtitleStyle",
                        JSONObject().apply { put("offsetSec", offsetMs.toDouble() / 1000.0) }.toString()
                    )
                }
            } catch (_: Throwable) {
            }
        }

        return ProxySessionInfo(
            sessionId = sessionId,
            proxyStreamUrl = "$base/stream/$sessionId",
            proxySubtitleUrl = if (hasSub) "$base/sub/$sessionId.srt" else null,
            proxySubtitleVttUrl = if (hasSub) "$base/sub/$sessionId.vtt" else null,
            lanIp = lanIp,
            port = port
        )
    }

    private fun loadAndProcessSubtitle(
        context: Context,
        session: StreamSession,
        sourceUrlOrPath: String,
        offsetMs: Long
    ) {
        val rawBytes: ByteArray? = if (session.cachedSubSourceKey == sourceUrlOrPath && session.cachedSubRawBytes != null) {
            session.cachedSubRawBytes
        } else {
            SubtitleProcessor.loadRawBytes(context, okHttpClient, sourceUrlOrPath, session.headers)?.also {
                session.cachedSubSourceKey = sourceUrlOrPath
                session.cachedSubRawBytes = it
            }
        }
        if (rawBytes != null && rawBytes.isNotEmpty()) {
            val processed = SubtitleProcessor.processBoth(
                rawBytes = rawBytes,
                sourceHint = sourceUrlOrPath,
                offsetMs = offsetMs,
                includeSrtBom = true
            )
            session.srtBytes = processed.srtBytes
            session.vttBytes = processed.vttBytes
        } else {
            session.srtBytes = null
            session.vttBytes = null
        }
    }

    private fun readHttpHeaderBlock(input: InputStream): String? {
        val buf = ByteArrayOutputStream(1024)
        var state = 0
        var count = 0
        while (count < 16384) {
            val b = input.read()
            if (b == -1) {
                return if (buf.size() == 0) null else String(buf.toByteArray(), StandardCharsets.UTF_8)
            }
            buf.write(b)
            count++
            if (b == '\r'.code) {
                if (state == 0 || state == 2) state++ else state = 1
            } else if (b == '\n'.code) {
                if (state == 1) state = 2 else if (state == 3 || state == 2) break else state = 0
            } else {
                state = 0
            }
        }
        return String(buf.toByteArray(), StandardCharsets.UTF_8)
    }

    private fun readExactBytes(input: InputStream, length: Int): ByteArray {
        if (length <= 0) return ByteArray(0)
        val out = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val n = input.read(out, offset, length - offset)
            if (n <= 0) break
            offset += n
        }
        return if (offset == length) out else out.copyOf(offset)
    }

    private fun handleClient(rawSocket: Socket) {
        rawSocket.use { socket ->
            try {
                socket.soTimeout = 30000
                val input = BufferedInputStream(socket.getInputStream())
                val output = BufferedOutputStream(socket.getOutputStream())

                val headerBlock = readHttpHeaderBlock(input) ?: return
                val headerLines = headerBlock.split("\r\n", "\n")
                val requestLine = headerLines.firstOrNull { it.isNotBlank() } ?: return
                val parts = requestLine.trim().split(Regex("\\s+"))
                if (parts.size < 2) {
                    sendSimpleResponse(output, 400, "Bad Request")
                    return
                }

                val method = parts[0].uppercase(Locale.US)
                val rawTarget = parts[1]
                val reqHeaders = HashMap<String, String>()
                for (i in 1 until headerLines.size) {
                    val line = headerLines[i]
                    if (line.isBlank()) continue
                    val colon = line.indexOf(':')
                    if (colon > 0) {
                        val k = line.substring(0, colon).trim().lowercase(Locale.US)
                        val v = line.substring(colon + 1).trim()
                        reqHeaders[k] = v
                    }
                }

                if (method == "OPTIONS") {
                    sendCorsPreflight(output)
                    return
                }
                if (method != "GET" && method != "HEAD" && method != "POST") {
                    sendSimpleResponse(output, 405, "Method Not Allowed")
                    return
                }

                var postBodyText = ""
                if (method == "POST") {
                    val contentLen = reqHeaders["content-length"]?.toIntOrNull()?.coerceIn(0, 1_048_576) ?: 0
                    if (contentLen > 0) {
                        postBodyText = String(readExactBytes(input, contentLen), StandardCharsets.UTF_8)
                    }
                }

                val isHead = (method == "HEAD")
                val pathOnly = rawTarget.substringBefore('?')
                val queryStr = rawTarget.substringAfter('?', "")
                val hostHeader = reqHeaders["host"]?.trim().orEmpty()
                val localBaseUrl = if (hostHeader.isNotEmpty()) {
                    "http://$hostHeader"
                } else {
                    val ip = appContext?.let { detectLanIpv4Address(it) } ?: "127.0.0.1"
                    "http://$ip:${getPort()}"
                }

                val segments = pathOnly.trim('/').split('/').filter { it.isNotEmpty() }
                if (segments.isEmpty()) {
                    sendSimpleResponse(output, 404, "Not Found")
                    return
                }

                when (segments[0]) {
                    "tv" -> {
                        handleTvReceiverRoute(
                            socket = socket,
                            segments = segments,
                            method = method,
                            queryStr = queryStr,
                            postBodyText = postBodyText,
                            output = output
                        )
                    }

                    "stream" -> {
                        if (method == "POST" || segments.size < 2) {
                            sendSimpleResponse(output, if (method == "POST") 405 else 404, if (method == "POST") "Method Not Allowed" else "Not Found")
                            return
                        }
                        val sessionId = segments[1].trim()
                        val session = sessions[sessionId]
                        if (session == null) {
                            sendSimpleResponse(output, 404, "Session Not Found")
                            return
                        }
                        val wantCaption = reqHeaders["getcaptioninfo.sec"] == "1" || session.srtBytes != null
                        val captionUrl = if (wantCaption && session.srtBytes != null) {
                            "$localBaseUrl/sub/${session.sessionId}.srt"
                        } else {
                            null
                        }

                        if (session.targetUrl.startsWith("content://", ignoreCase = true) ||
                            session.targetUrl.startsWith("file://", ignoreCase = true) ||
                            session.targetUrl.startsWith("/")
                        ) {
                            serveLocalMedia(session.targetUrl, reqHeaders["range"], isHead, captionUrl, output)
                        } else {
                            serveRemoteMedia(session, session.targetUrl, localBaseUrl, reqHeaders["range"], isHead, captionUrl, output)
                        }
                    }

                    "proxy" -> {
                        if (method == "POST" || segments.size < 2) {
                            sendSimpleResponse(output, if (method == "POST") 405 else 404, if (method == "POST") "Method Not Allowed" else "Not Found")
                            return
                        }
                        val sessionId = segments[1].trim()
                        val session = sessions[sessionId]
                        if (session == null) {
                            sendSimpleResponse(output, 404, "Session Not Found")
                            return
                        }
                        val encodedTarget = extractQueryParam(queryStr, "u")
                        if (encodedTarget.isNullOrBlank()) {
                            sendSimpleResponse(output, 400, "Missing u Parameter")
                            return
                        }
                        val decodedUrl = decodeBase64Url(encodedTarget)
                        if (decodedUrl.isNullOrBlank() ||
                            (!decodedUrl.startsWith("http://", ignoreCase = true) &&
                                !decodedUrl.startsWith("https://", ignoreCase = true))
                        ) {
                            sendSimpleResponse(output, 400, "Invalid Target URL")
                            return
                        }
                        serveRemoteMedia(session, decodedUrl, localBaseUrl, reqHeaders["range"], isHead, null, output)
                    }

                    "sub" -> {
                        if (method == "POST" || segments.size < 2) {
                            sendSimpleResponse(output, if (method == "POST") 405 else 404, if (method == "POST") "Method Not Allowed" else "Not Found")
                            return
                        }
                        val fileName = segments[1].trim()
                        val isVtt = fileName.endsWith(".vtt", ignoreCase = true)
                        val isSrt = fileName.endsWith(".srt", ignoreCase = true)
                        if (!isVtt && !isSrt) {
                            sendSimpleResponse(output, 404, "Subtitle Format Not Supported")
                            return
                        }
                        val sessionId = fileName.substringBeforeLast('.')
                        val session = sessions[sessionId]
                        val bytes = if (isVtt) session?.vttBytes else session?.srtBytes
                        if (bytes == null) {
                            sendSimpleResponse(output, 404, "Subtitle Not Found")
                            return
                        }
                        val mime = if (isVtt) "text/vtt; charset=utf-8" else "text/srt; charset=utf-8"
                        val respHeaders = buildString {
                            append("HTTP/1.1 200 OK\r\n")
                            appendCorsHeaders(this)
                            append("Content-Type: ").append(mime).append("\r\n")
                            append("Content-Length: ").append(bytes.size).append("\r\n")
                            append("Cache-Control: no-cache\r\n")
                            append("transferMode.dlna.org: Streaming\r\n")
                            append("Connection: close\r\n")
                            append("\r\n")
                        }
                        output.write(respHeaders.toByteArray(StandardCharsets.US_ASCII))
                        if (!isHead) {
                            output.write(bytes)
                        }
                        output.flush()
                    }

                    else -> sendSimpleResponse(output, 404, "Not Found")
                }
            } catch (_: Throwable) {
            }
        }
    }

    private fun handleTvReceiverRoute(
        socket: Socket,
        segments: List<String>,
        method: String,
        queryStr: String,
        postBodyText: String,
        output: OutputStream
    ) {
        val isHead = (method == "HEAD")
        if (segments.size == 1) {
            if (method != "GET" && !isHead) {
                sendSimpleResponse(output, 405, "Method Not Allowed")
                return
            }
            serveReceiverAsset("tv_receiver/index.html", "text/html; charset=utf-8", "no-cache", isHead, output)
            return
        }

        when (segments[1]) {
            "hls.min.js" -> {
                if (method != "GET" && !isHead) {
                    sendSimpleResponse(output, 405, "Method Not Allowed")
                    return
                }
                serveReceiverAsset("tv_receiver/hls.min.js", "application/javascript; charset=utf-8", "public, max-age=86400", isHead, output)
            }

            "events" -> {
                if (method != "GET") {
                    sendSimpleResponse(output, 405, "Method Not Allowed")
                    return
                }
                serveTvEventsSse(socket, output)
            }

            "poll" -> {
                if (method != "GET" && !isHead) {
                    sendSimpleResponse(output, 405, "Method Not Allowed")
                    return
                }
                val since = extractQueryParam(queryStr, "since")?.toLongOrNull() ?: 0L
                val waitFlag = extractQueryParam(queryStr, "wait") == "1"
                if (since > 0L && waitFlag && !isHead) {
                    val deadline = System.currentTimeMillis() + 2500L
                    synchronized(cmdLock) {
                        while (running && cmdSeq <= since) {
                            val rem = deadline - System.currentTimeMillis()
                            if (rem <= 0L) break
                            try {
                                cmdLock.wait(rem)
                            } catch (_: InterruptedException) {
                                break
                            }
                        }
                    }
                }
                val json = buildPollResponseJson(since)
                sendJsonResponse(output, 200, json, isHead)
            }

            "cmd" -> {
                if (method != "POST") {
                    sendSimpleResponse(output, 405, "Method Not Allowed")
                    return
                }
                try {
                    val req = JSONObject(postBodyText.ifBlank { "{}" })
                    val type = req.optString("type", "").trim()
                    if (type.isEmpty()) {
                        sendSimpleResponse(output, 400, "Missing command type")
                        return
                    }
                    val payloadObj = req.optJSONObject("payload")
                    val seq = pushReceiverCommand(type, payloadObj?.toString())
                    val okJson = JSONObject().apply {
                        put("ok", true)
                        put("seq", seq)
                    }.toString()
                    sendJsonResponse(output, 200, okJson, false)
                } catch (e: Throwable) {
                    sendSimpleResponse(output, 400, e.message ?: "Invalid JSON")
                }
            }

            "state" -> {
                if (method == "POST") {
                    try {
                        val stateObj = JSONObject(postBodyText.ifBlank { "{}" })
                        val cleanState = stateObj.toString()
                        lastReceiverStateJson = cleanState
                        receiverStateListener?.invoke(cleanState)
                        sendJsonResponse(output, 200, """{"ok":true}""", false)
                    } catch (_: Throwable) {
                        sendSimpleResponse(output, 400, "Invalid state JSON")
                    }
                } else if (method == "GET" || isHead) {
                    sendJsonResponse(output, 200, lastReceiverStateJson, isHead)
                } else {
                    sendSimpleResponse(output, 405, "Method Not Allowed")
                }
            }

            else -> sendSimpleResponse(output, 404, "Not Found")
        }
    }

    private fun serveReceiverAsset(
        assetPath: String,
        contentType: String,
        cacheControl: String,
        isHead: Boolean,
        output: OutputStream
    ) {
        val ctx = appContext
        if (ctx == null) {
            sendSimpleResponse(output, 500, "Server Context Unavailable")
            return
        }
        val bytes = try {
            ctx.assets.open(assetPath).use { it.readBytes() }
        } catch (_: Throwable) {
            null
        }
        if (bytes == null) {
            sendSimpleResponse(output, 404, "Receiver Asset Not Found")
            return
        }
        val hdrs = buildString {
            append("HTTP/1.1 200 OK\r\n")
            appendCorsHeaders(this)
            append("Content-Type: ").append(contentType).append("\r\n")
            append("Content-Length: ").append(bytes.size).append("\r\n")
            append("Cache-Control: ").append(cacheControl).append("\r\n")
            append("Connection: close\r\n\r\n")
        }
        output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
        if (!isHead) {
            output.write(bytes)
        }
        output.flush()
    }

    private fun serveTvEventsSse(socket: Socket, output: OutputStream) {
        try {
            socket.soTimeout = 0
            val hdrs = buildString {
                append("HTTP/1.1 200 OK\r\n")
                appendCorsHeaders(this)
                append("Content-Type: text/event-stream; charset=utf-8\r\n")
                append("Cache-Control: no-cache\r\n")
                append("Connection: close\r\n\r\n")
            }
            output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
            val initJson = buildInitSnapshotJson()
            var cursorSeq = try {
                JSONObject(initJson).optLong("seq", cmdSeq)
            } catch (_: Throwable) {
                cmdSeq
            }
            output.write("event: init\ndata: $initJson\n\n".toByteArray(StandardCharsets.UTF_8))
            output.flush()

            while (running && !socket.isClosed) {
                val pending = ArrayList<Pair<Long, String>>()
                synchronized(cmdLock) {
                    for (entry in commandLog) {
                        if (entry.first > cursorSeq) {
                            pending.add(entry)
                        }
                    }
                    if (pending.isEmpty() && running) {
                        try {
                            cmdLock.wait(12_000L)
                        } catch (_: InterruptedException) {
                            return
                        }
                        for (entry in commandLog) {
                            if (entry.first > cursorSeq) {
                                pending.add(entry)
                            }
                        }
                    }
                }
                if (!running || socket.isClosed) break
                if (pending.isNotEmpty()) {
                    for ((seq, jsonStr) in pending) {
                        cursorSeq = maxOf(cursorSeq, seq)
                        output.write("event: cmd\ndata: $jsonStr\n\n".toByteArray(StandardCharsets.UTF_8))
                    }
                    output.flush()
                } else {
                    output.write(": ping\n\n".toByteArray(StandardCharsets.US_ASCII))
                    output.flush()
                }
            }
        } catch (_: Throwable) {
        }
    }

    private fun sendJsonResponse(output: OutputStream, code: Int, jsonBody: String, isHead: Boolean) {
        val bytes = jsonBody.toByteArray(StandardCharsets.UTF_8)
        val hdrs = buildString {
            append("HTTP/1.1 ").append(code).append(" OK\r\n")
            appendCorsHeaders(this)
            append("Content-Type: application/json; charset=utf-8\r\n")
            append("Content-Length: ").append(bytes.size).append("\r\n")
            append("Cache-Control: no-cache\r\n")
            append("Connection: close\r\n\r\n")
        }
        output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
        if (!isHead) {
            output.write(bytes)
        }
        output.flush()
    }

    private fun serveLocalMedia(
        targetUrl: String,
        rangeHeader: String?,
        isHead: Boolean,
        captionUrl: String?,
        output: OutputStream
    ) {
        val ctx = appContext
        if (ctx == null) {
            sendSimpleResponse(output, 500, "Server Context Unavailable")
            return
        }

        if (targetUrl.startsWith("content://", ignoreCase = true)) {
            val uri = Uri.parse(targetUrl)
            val afd = try {
                ctx.contentResolver.openAssetFileDescriptor(uri, "r")
            } catch (_: Throwable) {
                null
            }
            if (afd == null) {
                sendSimpleResponse(output, 404, "Cannot Open Content URI")
                return
            }
            afd.use { descriptor ->
                var totalLength = descriptor.length
                if (totalLength == AssetFileDescriptor.UNKNOWN_LENGTH || totalLength < 0L) {
                    totalLength = queryOpenableSize(ctx, uri)
                }
                val mime = ctx.contentResolver.getType(uri)?.takeIf { it.isNotBlank() }
                    ?: guessMimeFromUrl(targetUrl)
                streamSeekableInput(
                    totalLength = totalLength,
                    mimeType = mime,
                    rangeHeader = rangeHeader,
                    isHead = isHead,
                    captionUrl = captionUrl,
                    output = output,
                    openStream = { descriptor.createInputStream() }
                )
            }
            return
        }

        val path = if (targetUrl.startsWith("file://", ignoreCase = true)) {
            Uri.parse(targetUrl).path.orEmpty()
        } else {
            targetUrl
        }
        val file = File(path)
        if (!file.exists() || !file.isFile) {
            sendSimpleResponse(output, 404, "Local File Not Found")
            return
        }
        val mime = guessMimeFromUrl(file.name)
        streamSeekableInput(
            totalLength = file.length(),
            mimeType = mime,
            rangeHeader = rangeHeader,
            isHead = isHead,
            captionUrl = captionUrl,
            output = output,
            openStream = { FileInputStream(file) }
        )
    }

    private fun streamSeekableInput(
        totalLength: Long,
        mimeType: String,
        rangeHeader: String?,
        isHead: Boolean,
        captionUrl: String?,
        output: OutputStream,
        openStream: () -> InputStream
    ) {
        if (totalLength <= 0L) {
            val hdrs = buildString {
                append("HTTP/1.1 200 OK\r\n")
                appendCorsHeaders(this)
                append("Content-Type: ").append(mimeType).append("\r\n")
                append("Accept-Ranges: none\r\n")
                append("transferMode.dlna.org: Streaming\r\n")
                if (!captionUrl.isNullOrBlank()) {
                    append("CaptionInfo.sec: ").append(captionUrl).append("\r\n")
                }
                append("Connection: close\r\n\r\n")
            }
            output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
            output.flush()
            if (!isHead) {
                openStream().use { stream ->
                    copyStreamChunked(stream, output, Long.MAX_VALUE)
                }
            }
            return
        }

        val parsedRange = parseByteRange(rangeHeader, totalLength)
        if (parsedRange == null && !rangeHeader.isNullOrBlank()) {
            val hdrs = buildString {
                append("HTTP/1.1 416 Range Not Satisfiable\r\n")
                appendCorsHeaders(this)
                append("Content-Range: bytes */").append(totalLength).append("\r\n")
                append("Content-Length: 0\r\n")
                append("Connection: close\r\n\r\n")
            }
            output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
            output.flush()
            return
        }

        val isPartial = parsedRange != null
        val start = parsedRange?.first ?: 0L
        val end = parsedRange?.second ?: (totalLength - 1L)
        val contentLen = (end - start + 1L).coerceAtLeast(0L)

        val hdrs = buildString {
            if (isPartial) {
                append("HTTP/1.1 206 Partial Content\r\n")
                append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(totalLength).append("\r\n")
            } else {
                append("HTTP/1.1 200 OK\r\n")
            }
            appendCorsHeaders(this)
            append("Content-Type: ").append(mimeType).append("\r\n")
            append("Content-Length: ").append(contentLen).append("\r\n")
            append("Accept-Ranges: bytes\r\n")
            append("transferMode.dlna.org: Streaming\r\n")
            append("contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n")
            if (!captionUrl.isNullOrBlank()) {
                append("CaptionInfo.sec: ").append(captionUrl).append("\r\n")
            }
            append("Connection: close\r\n\r\n")
        }
        output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
        output.flush()

        if (!isHead && contentLen > 0L) {
            openStream().use { stream ->
                if (start > 0L) {
                    skipExact(stream, start)
                }
                copyStreamChunked(stream, output, contentLen)
            }
        }
    }

    private fun buildUpstreamRequest(
        targetUrl: String,
        sessionHeaders: Map<String, String>,
        rangeHeader: String?,
        isHead: Boolean,
        omitCookies: Boolean = false,
        omitOrigin: Boolean = false,
        omitReferer: Boolean = false
    ): Request {
        val rb = Request.Builder().url(targetUrl)
        var hasUa = false
        var hasAccept = false
        for ((k, v) in sessionHeaders) {
            val key = k.trim()
            val value = v.trim()
            if (key.isEmpty() || value.isEmpty()) continue
            val lower = key.lowercase(Locale.US)
            if (lower in HOP_BY_HOP_HEADERS) continue
            if (omitCookies && lower == "cookie") continue
            if (omitOrigin && lower == "origin") continue
            if (omitReferer && (lower == "referer" || lower == "referrer")) continue
            if (lower == "user-agent") hasUa = true
            if (lower == "accept") hasAccept = true
            rb.header(key, value)
        }
        if (!hasUa) rb.header("User-Agent", DEFAULT_USER_AGENT)
        if (!hasAccept) rb.header("Accept", "*/*")
        if (!rangeHeader.isNullOrBlank()) {
            rb.header("Range", rangeHeader)
        }
        if (isHead) rb.head() else rb.get()
        return rb.build()
    }

    private fun executeWith403Fallback(
        targetUrl: String,
        sessionHeaders: Map<String, String>,
        rangeHeader: String?,
        isHead: Boolean
    ): Response {
        val resp1 = okHttpClient.newCall(
            buildUpstreamRequest(targetUrl, sessionHeaders, rangeHeader, isHead)
        ).execute()
        if (resp1.code != 403 && resp1.code != 401) {
            return resp1
        }
        resp1.close()

        val resp2 = okHttpClient.newCall(
            buildUpstreamRequest(targetUrl, sessionHeaders, rangeHeader, isHead, omitCookies = true)
        ).execute()
        if (resp2.code != 403 && resp2.code != 401) {
            return resp2
        }
        resp2.close()

        val resp3 = okHttpClient.newCall(
            buildUpstreamRequest(targetUrl, sessionHeaders, rangeHeader, isHead, omitCookies = true, omitOrigin = true)
        ).execute()
        if (resp3.code != 403 && resp3.code != 401) {
            return resp3
        }
        resp3.close()

        return okHttpClient.newCall(
            buildUpstreamRequest(targetUrl, sessionHeaders, rangeHeader, isHead, omitCookies = true, omitOrigin = true, omitReferer = true)
        ).execute()
    }

    private fun serveRemoteMedia(
        session: StreamSession,
        targetUrl: String,
        localBaseUrl: String,
        clientRange: String?,
        isHead: Boolean,
        captionUrl: String?,
        output: OutputStream
    ) {
        val looksM3u8ByUrl = targetUrl.substringBefore('?').substringBefore('#')
            .lowercase(Locale.US).endsWith(".m3u8")

        if (looksM3u8ByUrl) {
            val cacheKey = "${session.sessionId}|$targetUrl"
            val now = System.currentTimeMillis()
            val cached = m3u8Cache[cacheKey]
            if (cached != null && cached.expiresAtMs > now) {
                writePlaylistResponse(cached.bytes, isHead, captionUrl, output)
                return
            }
        }

        if (isHead && !looksM3u8ByUrl) {
            executeWith403Fallback(targetUrl, session.headers, clientRange, isHead = true).use { resp ->
                var finalCode = resp.code
                var finalMsg = resp.message.ifBlank { "OK" }
                var contentType = resp.header("Content-Type") ?: guessMimeFromUrl(resp.request.url.toString())
                val lowerType = contentType.lowercase(Locale.US)
                if (resp.isSuccessful && (lowerType.contains("mpegurl") || lowerType.contains("m3u"))) {
                    serveFetchedPlaylist(session, resp.request.url.toString(), localBaseUrl, isHead = true, captionUrl = captionUrl, output = output)
                    return
                }
                var contentLen = resp.header("Content-Length")
                var contentRange = resp.header("Content-Range")
                var acceptRanges = resp.header("Accept-Ranges") ?: if (resp.isSuccessful) "bytes" else null

                if (!resp.isSuccessful || contentLen.isNullOrBlank()) {
                    try {
                        executeWith403Fallback(targetUrl, session.headers, "bytes=0-0", isHead = false).use { probe ->
                            if (probe.isSuccessful) {
                                contentType = probe.header("Content-Type") ?: contentType
                                val cr = probe.header("Content-Range")
                                val totalMatch = cr?.let { Regex("""bytes\s+\d+-\d+/(\d+)""", RegexOption.IGNORE_CASE).find(it) }
                                if (totalMatch != null && clientRange.isNullOrBlank()) {
                                    finalCode = 200
                                    finalMsg = "OK"
                                    contentLen = totalMatch.groupValues[1]
                                    contentRange = null
                                    acceptRanges = "bytes"
                                } else if (!clientRange.isNullOrBlank()) {
                                    finalCode = probe.code
                                    finalMsg = probe.message.ifBlank { "OK" }
                                    contentRange = cr
                                    contentLen = probe.header("Content-Length") ?: contentLen
                                    acceptRanges = probe.header("Accept-Ranges") ?: "bytes"
                                } else if (probe.code == 200) {
                                    finalCode = 200
                                    finalMsg = "OK"
                                    contentLen = probe.header("Content-Length") ?: contentLen
                                }
                            }
                        }
                    } catch (_: Throwable) {
                    }
                }

                val hdrs = buildString {
                    append("HTTP/1.1 ").append(finalCode).append(" ").append(finalMsg).append("\r\n")
                    appendCorsHeaders(this)
                    append("Content-Type: ").append(contentType).append("\r\n")
                    if (!contentLen.isNullOrBlank()) {
                        append("Content-Length: ").append(contentLen).append("\r\n")
                    }
                    if (!contentRange.isNullOrBlank()) {
                        append("Content-Range: ").append(contentRange).append("\r\n")
                    }
                    if (!acceptRanges.isNullOrBlank()) {
                        append("Accept-Ranges: ").append(acceptRanges).append("\r\n")
                    }
                    append("transferMode.dlna.org: Streaming\r\n")
                    if (!captionUrl.isNullOrBlank()) {
                        append("CaptionInfo.sec: ").append(captionUrl).append("\r\n")
                    }
                    append("Connection: close\r\n\r\n")
                }
                output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
                output.flush()
            }
            return
        }

        executeWith403Fallback(targetUrl, session.headers, if (looksM3u8ByUrl) null else clientRange, isHead = false).use { resp ->
            val finalUrl = resp.request.url.toString()
            val contentType = resp.header("Content-Type") ?: guessMimeFromUrl(finalUrl)
            val lowerType = contentType.lowercase(Locale.US)
            val finalPath = resp.request.url.encodedPath.lowercase(Locale.US)
            val body = resp.body

            if (!resp.isSuccessful || body == null) {
                val errBody = body?.bytes() ?: ByteArray(0)
                val hdrs = buildString {
                    append("HTTP/1.1 ").append(resp.code).append(" ").append(resp.message.ifBlank { "Error" }).append("\r\n")
                    appendCorsHeaders(this)
                    append("Content-Type: ").append(contentType).append("\r\n")
                    append("Content-Length: ").append(errBody.size).append("\r\n")
                    append("Connection: close\r\n\r\n")
                }
                output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
                if (!isHead && errBody.isNotEmpty()) {
                    output.write(errBody)
                }
                output.flush()
                return
            }

            val isHlsByHeader = looksM3u8ByUrl ||
                finalPath.endsWith(".m3u8") ||
                lowerType.contains("mpegurl") ||
                lowerType.contains("m3u")

            val rawStream = body.byteStream()
            if (isHlsByHeader) {
                val playlistText = readTextCapped(rawStream)
                if (playlistText.trimStart('\uFEFF', ' ', '\t', '\r', '\n').startsWith("#EXTM3U") ||
                    finalPath.endsWith(".m3u8")
                ) {
                    val rewrittenBytes = rewriteM3u8Playlist(playlistText, finalUrl, session, localBaseUrl)
                        .toByteArray(StandardCharsets.UTF_8)
                    m3u8Cache["${session.sessionId}|$targetUrl"] =
                        CachedPlaylistEntry(rewrittenBytes, System.currentTimeMillis() + M3U8_CACHE_TTL_MS)
                    writePlaylistResponse(rewrittenBytes, isHead, captionUrl, output)
                    return
                }
                val rawBytes = playlistText.toByteArray(StandardCharsets.UTF_8)
                val hdrs = buildString {
                    append("HTTP/1.1 ").append(resp.code).append(" ").append(resp.message.ifBlank { "OK" }).append("\r\n")
                    appendCorsHeaders(this)
                    append("Content-Type: ").append(contentType).append("\r\n")
                    append("Content-Length: ").append(rawBytes.size).append("\r\n")
                    if (!captionUrl.isNullOrBlank()) {
                        append("CaptionInfo.sec: ").append(captionUrl).append("\r\n")
                    }
                    append("Connection: close\r\n\r\n")
                }
                output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
                if (!isHead) output.write(rawBytes)
                output.flush()
                return
            }

            // Sniff first 16 bytes using PushbackInputStream to detect extensionless #EXTM3U without buffering video in RAM
            val pushback = PushbackInputStream(rawStream, 16)
            val headProbe = ByteArray(16)
            val probeLen = pushback.read(headProbe, 0, headProbe.size)
            val probeStr = if (probeLen > 0) {
                String(headProbe, 0, probeLen, StandardCharsets.UTF_8).trimStart('\uFEFF', ' ', '\t', '\r', '\n')
            } else {
                ""
            }
            if (probeStr.startsWith("#EXTM3U")) {
                val restText = readTextCapped(pushback)
                val fullText = String(headProbe, 0, probeLen, StandardCharsets.UTF_8) + restText
                val rewrittenBytes = rewriteM3u8Playlist(fullText, finalUrl, session, localBaseUrl)
                    .toByteArray(StandardCharsets.UTF_8)
                m3u8Cache["${session.sessionId}|$targetUrl"] =
                    CachedPlaylistEntry(rewrittenBytes, System.currentTimeMillis() + M3U8_CACHE_TTL_MS)
                writePlaylistResponse(rewrittenBytes, isHead, captionUrl, output)
                return
            }
            if (probeLen > 0) {
                pushback.unread(headProbe, 0, probeLen)
            }

            // Direct media chunk-by-chunk 64 KB streaming (supports 206 Partial Content)
            val contentLen = resp.header("Content-Length")
            val contentRange = resp.header("Content-Range")
            val acceptRanges = resp.header("Accept-Ranges") ?: "bytes"

            val hdrs = buildString {
                append("HTTP/1.1 ").append(resp.code).append(" ").append(resp.message.ifBlank { "OK" }).append("\r\n")
                appendCorsHeaders(this)
                append("Content-Type: ").append(contentType).append("\r\n")
                if (!contentLen.isNullOrBlank()) {
                    append("Content-Length: ").append(contentLen).append("\r\n")
                }
                if (!contentRange.isNullOrBlank()) {
                    append("Content-Range: ").append(contentRange).append("\r\n")
                }
                append("Accept-Ranges: ").append(acceptRanges).append("\r\n")
                append("transferMode.dlna.org: Streaming\r\n")
                append("contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n")
                if (!captionUrl.isNullOrBlank()) {
                    append("CaptionInfo.sec: ").append(captionUrl).append("\r\n")
                }
                append("Connection: close\r\n\r\n")
            }
            output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
            output.flush()

            if (!isHead) {
                copyStreamChunked(pushback, output, Long.MAX_VALUE)
            }
        }
    }

    private fun serveFetchedPlaylist(
        session: StreamSession,
        targetUrl: String,
        localBaseUrl: String,
        isHead: Boolean,
        captionUrl: String?,
        output: OutputStream
    ) {
        executeWith403Fallback(targetUrl, session.headers, null, isHead = false).use { resp ->
            val body = resp.body
            if (!resp.isSuccessful || body == null) {
                sendSimpleResponse(output, resp.code, resp.message.ifBlank { "Playlist Fetch Error" })
                return
            }
            val finalUrl = resp.request.url.toString()
            val text = readTextCapped(body.byteStream())
            val rewrittenBytes = rewriteM3u8Playlist(text, finalUrl, session, localBaseUrl)
                .toByteArray(StandardCharsets.UTF_8)
            m3u8Cache["${session.sessionId}|$targetUrl"] =
                CachedPlaylistEntry(rewrittenBytes, System.currentTimeMillis() + M3U8_CACHE_TTL_MS)
            writePlaylistResponse(rewrittenBytes, isHead, captionUrl, output)
        }
    }

    private fun writePlaylistResponse(
        bytes: ByteArray,
        isHead: Boolean,
        captionUrl: String?,
        output: OutputStream
    ) {
        // Explicit uncompressed application/vnd.apple.mpegurl without Content-Encoding: gzip
        val hdrs = buildString {
            append("HTTP/1.1 200 OK\r\n")
            appendCorsHeaders(this)
            append("Content-Type: application/vnd.apple.mpegurl\r\n")
            append("Content-Length: ").append(bytes.size).append("\r\n")
            append("Cache-Control: no-cache\r\n")
            append("transferMode.dlna.org: Streaming\r\n")
            if (!captionUrl.isNullOrBlank()) {
                append("CaptionInfo.sec: ").append(captionUrl).append("\r\n")
            }
            append("Connection: close\r\n\r\n")
        }
        output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
        if (!isHead) {
            output.write(bytes)
        }
        output.flush()
    }

    private fun rewriteM3u8Playlist(
        playlistText: String,
        finalBaseUrl: String,
        session: StreamSession,
        localBaseUrl: String
    ): String {
        val baseUri = URI.create(finalBaseUrl)
        val lines = playlistText.split('\n')
        val sb = StringBuilder(playlistText.length + 512)

        fun buildProxiedLink(rawUrl: String): String {
            val resolved = try {
                baseUri.resolve(rawUrl.trim()).toString()
            } catch (_: Throwable) {
                rawUrl.trim()
            }
            val encoded = Base64.encodeToString(
                resolved.toByteArray(StandardCharsets.UTF_8),
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
            )
            return "$localBaseUrl/proxy/${session.sessionId}?u=$encoded"
        }

        for (rawLine in lines) {
            val line = rawLine.trimEnd('\r')
            val trimmed = line.trim()
            if (trimmed.isEmpty()) {
                sb.append('\n')
                continue
            }
            if (trimmed.startsWith("#")) {
                if (line.contains("URI=\"", ignoreCase = true)) {
                    val rewrittenTag = URI_ATTR_REGEX.replace(line) { m ->
                        val proxied = buildProxiedLink(m.groupValues[2])
                        "${m.groupValues[1]}$proxied${m.groupValues[3]}"
                    }
                    sb.append(rewrittenTag).append('\n')
                } else {
                    sb.append(line).append('\n')
                }
            } else {
                sb.append(buildProxiedLink(trimmed)).append('\n')
            }
        }
        return sb.toString()
    }

    private fun appendCorsHeaders(sb: StringBuilder) {
        sb.append("Access-Control-Allow-Origin: *\r\n")
        sb.append("Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS\r\n")
        sb.append("Access-Control-Allow-Headers: *\r\n")
        sb.append("Access-Control-Expose-Headers: *\r\n")
    }

    private fun sendCorsPreflight(output: OutputStream) {
        val hdrs = buildString {
            append("HTTP/1.1 204 No Content\r\n")
            appendCorsHeaders(this)
            append("Content-Length: 0\r\n")
            append("Connection: close\r\n\r\n")
        }
        output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
        output.flush()
    }

    private fun sendSimpleResponse(output: OutputStream, code: Int, message: String) {
        val bodyBytes = "$code $message".toByteArray(StandardCharsets.UTF_8)
        val hdrs = buildString {
            append("HTTP/1.1 ").append(code).append(" ").append(message).append("\r\n")
            appendCorsHeaders(this)
            append("Content-Type: text/plain; charset=utf-8\r\n")
            append("Content-Length: ").append(bodyBytes.size).append("\r\n")
            append("Connection: close\r\n\r\n")
        }
        output.write(hdrs.toByteArray(StandardCharsets.US_ASCII))
        output.write(bodyBytes)
        output.flush()
    }

    private fun copyStreamChunked(input: InputStream, output: OutputStream, maxBytes: Long) {
        val buffer = ByteArray(STREAM_BUFFER_SIZE)
        var remaining = maxBytes
        while (remaining > 0L) {
            val toRead = if (remaining < buffer.size.toLong()) remaining.toInt() else buffer.size
            val read = input.read(buffer, 0, toRead)
            if (read <= 0) break
            output.write(buffer, 0, read)
            if (remaining != Long.MAX_VALUE) {
                remaining -= read.toLong()
            }
        }
        output.flush()
    }

    private fun skipExact(input: InputStream, bytesToSkip: Long) {
        var remaining = bytesToSkip
        val skipBuf = ByteArray(16384)
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped > 0L) {
                remaining -= skipped
            } else {
                val n = input.read(skipBuf, 0, minOf(skipBuf.size.toLong(), remaining).toInt())
                if (n < 0) break
                remaining -= n.toLong()
            }
        }
    }

    private fun readTextCapped(input: InputStream): String {
        val out = ByteArrayOutputStream(8192)
        val buf = ByteArray(8192)
        var total = 0
        while (total < MAX_PLAYLIST_BYTES) {
            val n = input.read(buf, 0, minOf(buf.size, MAX_PLAYLIST_BYTES - total))
            if (n <= 0) break
            out.write(buf, 0, n)
            total += n
        }
        return String(out.toByteArray(), StandardCharsets.UTF_8)
    }

    private fun extractQueryParam(queryStr: String, paramName: String): String? {
        if (queryStr.isBlank()) return null
        for (pair in queryStr.split('&')) {
            val eq = pair.indexOf('=')
            val key = if (eq > 0) pair.substring(0, eq) else pair
            if (key == paramName) {
                val rawVal = if (eq > 0 && eq + 1 < pair.length) pair.substring(eq + 1) else ""
                return try {
                    URLDecoder.decode(rawVal, "UTF-8")
                } catch (_: Throwable) {
                    rawVal
                }
            }
        }
        return null
    }

    private fun decodeBase64Url(encoded: String): String? {
        val trimmed = encoded.trim()
        if (trimmed.isEmpty()) return null
        return try {
            val bytes = Base64.decode(trimmed, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            String(bytes, StandardCharsets.UTF_8)
        } catch (_: Throwable) {
            try {
                val bytes = Base64.decode(trimmed, Base64.DEFAULT)
                String(bytes, StandardCharsets.UTF_8)
            } catch (_: Throwable) {
                null
            }
        }
    }

    private fun parseByteRange(rangeHeader: String?, totalLength: Long): Pair<Long, Long>? {
        if (rangeHeader.isNullOrBlank()) return null
        val trimmed = rangeHeader.trim()
        if (!trimmed.startsWith("bytes=", ignoreCase = true)) return null
        val spec = trimmed.substring(6).substringBefore(',').trim()
        val dash = spec.indexOf('-')
        if (dash < 0) return null
        val startStr = spec.substring(0, dash).trim()
        val endStr = spec.substring(dash + 1).trim()
        return try {
            if (startStr.isEmpty()) {
                val suffix = endStr.toLong()
                if (suffix <= 0L) return null
                val start = (totalLength - suffix).coerceAtLeast(0L)
                Pair(start, totalLength - 1L)
            } else {
                val start = startStr.toLong()
                val end = if (endStr.isEmpty()) totalLength - 1L else endStr.toLong().coerceAtMost(totalLength - 1L)
                if (start < 0L || start >= totalLength || end < start) null else Pair(start, end)
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun queryOpenableSize(context: Context, uri: Uri): Long {
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (idx >= 0 && !cursor.isNull(idx)) cursor.getLong(idx) else -1L
                } else {
                    -1L
                }
            } ?: -1L
        } catch (_: Throwable) {
            -1L
        }
    }

    private fun guessMimeFromUrl(url: String): String {
        val lower = url.substringBefore('?').substringBefore('#').lowercase(Locale.US)
        return when {
            lower.endsWith(".m3u8") -> "application/vnd.apple.mpegurl"
            lower.endsWith(".mkv") -> "video/x-matroska"
            lower.endsWith(".ts") -> "video/mp2t"
            lower.endsWith(".webm") -> "video/webm"
            lower.endsWith(".mov") -> "video/quicktime"
            lower.endsWith(".avi") -> "video/x-msvideo"
            else -> "video/mp4"
        }
    }
}
