package com.universalremote

import android.content.Context
import android.net.Uri
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Locale

data class ProcessedSubtitles(
    val srtBytes: ByteArray,
    val vttBytes: ByteArray
)

object SubtitleProcessor {
    private const val MAX_SUBTITLE_BYTES = 5 * 1024 * 1024 // 5 MB safety cap
    private val TIMING_LINE_REGEX = Regex(
        """(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})"""
    )
    private val VTT_TAG_REGEX = Regex("""</?(?:c|v|lang|b|i|u|ruby|rt)(?:\.[^>\s]+)?(?:\s+[^>]*)?>""", RegexOption.IGNORE_CASE)
    private val NUMERIC_ENTITY_REGEX = Regex("""&#(\d{1,6});""")
    private val HEX_ENTITY_REGEX = Regex("""&#x([0-9a-fA-F]{1,6});""")
    private val HOP_HEADERS = setOf("host", "connection", "keep-alive", "content-length", "accept-encoding")

    fun loadRawBytes(
        context: Context,
        httpClient: OkHttpClient,
        sourceUrlOrPath: String,
        headers: Map<String, String> = emptyMap()
    ): ByteArray? {
        val clean = sourceUrlOrPath.trim()
        if (clean.isEmpty()) return null

        return when {
            clean.startsWith("http://", ignoreCase = true) ||
                clean.startsWith("https://", ignoreCase = true) -> {
                val rb = Request.Builder().url(clean).get()
                var hasUa = false
                for ((k, v) in headers) {
                    val key = k.trim()
                    val value = v.trim()
                    if (key.isEmpty() || value.isEmpty()) continue
                    if (key.lowercase(Locale.US) in HOP_HEADERS) continue
                    if (key.equals("user-agent", ignoreCase = true)) hasUa = true
                    rb.header(key, value)
                }
                if (!hasUa) {
                    rb.header(
                        "User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
                    )
                }
                httpClient.newCall(rb.build()).execute().use { resp ->
                    if (!resp.isSuccessful) return null
                    val stream = resp.body?.byteStream() ?: return null
                    readCappedBytes(stream)
                }
            }
            clean.startsWith("content://", ignoreCase = true) -> {
                val uri = Uri.parse(clean)
                context.contentResolver.openInputStream(uri)?.use { readCappedBytes(it) }
            }
            clean.startsWith("file://", ignoreCase = true) -> {
                val path = Uri.parse(clean).path ?: return null
                val file = File(path)
                if (!file.exists() || !file.isFile) return null
                FileInputStream(file).use { readCappedBytes(it) }
            }
            else -> {
                val file = File(clean)
                if (!file.exists() || !file.isFile) return null
                FileInputStream(file).use { readCappedBytes(it) }
            }
        }
    }

    private fun readCappedBytes(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream(8192)
        val buf = ByteArray(8192)
        var total = 0
        while (total < MAX_SUBTITLE_BYTES) {
            val toRead = minOf(buf.size, MAX_SUBTITLE_BYTES - total)
            val n = input.read(buf, 0, toRead)
            if (n <= 0) break
            out.write(buf, 0, n)
            total += n
        }
        return out.toByteArray()
    }

    fun decodeWithArabicFallback(raw: ByteArray): String {
        if (raw.isEmpty()) return ""
        if (raw.size >= 3 &&
            raw[0] == 0xEF.toByte() &&
            raw[1] == 0xBB.toByte() &&
            raw[2] == 0xBF.toByte()
        ) {
            return String(raw, 3, raw.size - 3, StandardCharsets.UTF_8)
        }
        if (raw.size >= 2 && raw[0] == 0xFF.toByte() && raw[1] == 0xFE.toByte()) {
            return String(raw, 2, raw.size - 2, StandardCharsets.UTF_16LE)
        }
        if (raw.size >= 2 && raw[0] == 0xFE.toByte() && raw[1] == 0xFF.toByte()) {
            return String(raw, 2, raw.size - 2, StandardCharsets.UTF_16BE)
        }

        try {
            val strictUtf8 = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            return strictUtf8.decode(ByteBuffer.wrap(raw)).toString()
        } catch (_: Throwable) {
        }

        return try {
            String(raw, Charset.forName("windows-1256"))
        } catch (_: Throwable) {
            String(raw, StandardCharsets.UTF_8)
        }
    }

    fun processBoth(
        rawBytes: ByteArray,
        sourceHint: String = "",
        offsetMs: Long = 0L,
        includeSrtBom: Boolean = true
    ): ProcessedSubtitles {
        val decoded = decodeWithArabicFallback(rawBytes)
        val isVttHint = sourceHint.substringBefore('?').lowercase(Locale.US).endsWith(".vtt") ||
            decoded.trimStart().startsWith("WEBVTT", ignoreCase = true)
        val cues = parseCues(decoded, isVttHint, offsetMs)

        val srtText = renderSrt(cues)
        val vttText = renderVtt(cues)

        val srtBody = srtText.toByteArray(StandardCharsets.UTF_8)
        val srtBytes = if (includeSrtBom) {
            val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
            ByteArray(bom.size + srtBody.size).also {
                System.arraycopy(bom, 0, it, 0, bom.size)
                System.arraycopy(srtBody, 0, it, bom.size, srtBody.size)
            }
        } else {
            srtBody
        }
        val vttBytes = vttText.toByteArray(StandardCharsets.UTF_8)
        return ProcessedSubtitles(srtBytes = srtBytes, vttBytes = vttBytes)
    }

    private data class SubtitleCue(
        val startMs: Long,
        val endMs: Long,
        val lines: List<String>
    )

    private fun parseCues(rawText: String, isVtt: Boolean, offsetMs: Long): List<SubtitleCue> {
        val normalized = rawText.replace("\r\n", "\n").replace('\r', '\n')
        val lines = normalized.split('\n')
        val cues = ArrayList<SubtitleCue>(lines.size / 4 + 8)
        var i = 0

        while (i < lines.size) {
            val trimmed = lines[i].trim()
            if (trimmed.isEmpty()) {
                i++
                continue
            }
            if (isVtt && (trimmed.startsWith("WEBVTT", ignoreCase = true) ||
                    trimmed.startsWith("STYLE", ignoreCase = true) ||
                    trimmed.startsWith("REGION", ignoreCase = true) ||
                    trimmed.startsWith("NOTE", ignoreCase = true))
            ) {
                i++
                while (i < lines.size && lines[i].trim().isNotEmpty()) {
                    i++
                }
                continue
            }

            val timing = TIMING_LINE_REGEX.find(trimmed)
            if (timing != null) {
                val startRaw = toMillis(
                    timing.groupValues[1].ifBlank { "0" },
                    timing.groupValues[2],
                    timing.groupValues[3],
                    timing.groupValues[4]
                )
                val endRaw = toMillis(
                    timing.groupValues[5].ifBlank { "0" },
                    timing.groupValues[6],
                    timing.groupValues[7],
                    timing.groupValues[8]
                )

                val startShifted = (startRaw + offsetMs).coerceAtLeast(0L)
                var endShifted = (endRaw + offsetMs).coerceAtLeast(0L)
                if (endShifted <= startShifted) {
                    endShifted = startShifted + 350L
                }

                i++
                val textLines = ArrayList<String>(3)
                while (i < lines.size && lines[i].trim().isNotEmpty()) {
                    var lineText = lines[i].trimEnd()
                    lineText = VTT_TAG_REGEX.replace(lineText, "")
                    lineText = decodeHtmlEntities(lineText).trim()
                    if (lineText.isNotEmpty()) {
                        textLines.add(lineText)
                    }
                    i++
                }
                if (textLines.isNotEmpty()) {
                    cues.add(SubtitleCue(startShifted, endShifted, textLines))
                }
                continue
            }
            i++
        }
        return cues
    }

    private fun renderSrt(cues: List<SubtitleCue>): String {
        val sb = StringBuilder(cues.size * 64 + 32)
        cues.forEachIndexed { idx, cue ->
            sb.append(idx + 1).append("\r\n")
            sb.append(formatTimestamp(cue.startMs, ',')).append(" --> ").append(formatTimestamp(cue.endMs, ',')).append("\r\n")
            for (line in cue.lines) {
                sb.append(line).append("\r\n")
            }
            sb.append("\r\n")
        }
        return sb.toString()
    }

    private fun renderVtt(cues: List<SubtitleCue>): String {
        val sb = StringBuilder(cues.size * 64 + 64)
        sb.append("WEBVTT\n\n")
        for (cue in cues) {
            sb.append(formatTimestamp(cue.startMs, '.')).append(" --> ").append(formatTimestamp(cue.endMs, '.')).append('\n')
            for (line in cue.lines) {
                sb.append(line).append('\n')
            }
            sb.append('\n')
        }
        return sb.toString()
    }

    private fun formatTimestamp(totalMs: Long, millisSep: Char): String {
        val clamped = totalMs.coerceAtLeast(0L)
        val h = clamped / 3600000L
        val m = (clamped % 3600000L) / 60000L
        val s = (clamped % 60000L) / 1000L
        val ms = clamped % 1000L
        return String.format(Locale.US, "%02d:%02d:%02d%c%03d", h, m, s, millisSep, ms)
    }

    private fun toMillis(hStr: String, mStr: String, sStr: String, msStr: String): Long {
        val h = hStr.toLongOrNull() ?: 0L
        val m = mStr.toLongOrNull() ?: 0L
        val s = sStr.toLongOrNull() ?: 0L
        val ms = msStr.padEnd(3, '0').take(3).toLongOrNull() ?: 0L
        return h * 3600000L + m * 60000L + s * 1000L + ms
    }

    private fun decodeHtmlEntities(input: String): String {
        var out = input
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
        if (out.contains("&#")) {
            out = NUMERIC_ENTITY_REGEX.replace(out) { m ->
                val code = m.groupValues[1].toIntOrNull()
                if (code != null && code in 32..0x10FFFF) String(Character.toChars(code)) else m.value
            }
            out = HEX_ENTITY_REGEX.replace(out) { m ->
                val code = m.groupValues[1].toIntOrNull(16)
                if (code != null && code in 32..0x10FFFF) String(Character.toChars(code)) else m.value
            }
        }
        return out
    }
}
