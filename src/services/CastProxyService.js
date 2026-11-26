import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

const IS_WEB = Platform.OS === 'web';
const CastProxyNative =
  NativeModules && NativeModules.CastProxyModule
    ? NativeModules.CastProxyModule
    : null;

export function isLikelyDirectVideoUrl(rawUrl) {
  const clean = String(rawUrl || '')
    .trim()
    .split('?')[0]
    .split('#')[0]
    .toLowerCase();
  if (!clean) return false;
  if (clean.startsWith('content://') || clean.startsWith('file://')) return true;
  return /\.(mp4|mkv|m3u8|m3u|ts|webm|mov|avi|m4v|mpd)$/i.test(clean);
}

export function inferMovieTitleFromUrl(urlOrPath, fallback = 'فيلم مباشر') {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return fallback;
  try {
    const clean = raw.split('?')[0].split('#')[0];
    const lastSeg = decodeURIComponent(clean.substring(clean.lastIndexOf('/') + 1));
    if (lastSeg && lastSeg.length > 1) {
      const stripped = lastSeg
        .replace(/\.(mp4|mkv|m3u8|m3u|ts|webm|mov|avi|m4v|srt|vtt)$/i, '')
        .replace(/[._]+/g, ' ')
        .trim();
      if (stripped.length > 1) {
        return stripped.slice(0, 72);
      }
    }
  } catch (_) {
  }
  return fallback;
}

export function guessMimeTypeFromUrl(urlOrPath, explicitMime = '') {
  const cleanExplicit = String(explicitMime || '').trim().toLowerCase();
  if (cleanExplicit && cleanExplicit !== 'text/plain' && cleanExplicit !== '*/*') {
    return cleanExplicit;
  }
  const clean = String(urlOrPath || '')
    .trim()
    .split('?')[0]
    .split('#')[0]
    .toLowerCase();
  if (clean.endsWith('.m3u8') || clean.endsWith('.m3u')) {
    return 'application/vnd.apple.mpegurl';
  }
  if (clean.endsWith('.mkv')) return 'video/x-matroska';
  if (clean.endsWith('.ts')) return 'video/mp2t';
  if (clean.endsWith('.webm')) return 'video/webm';
  if (clean.endsWith('.mov')) return 'video/quicktime';
  if (clean.endsWith('.avi')) return 'video/x-msvideo';
  return 'video/mp4';
}

function sanitizeHeaders(headers) {
  const clean = {};
  if (!headers || typeof headers !== 'object') return clean;
  Object.entries(headers).forEach(([k, v]) => {
    const ck = String(k || '').trim();
    const cv = String(v || '').trim();
    if (ck && cv) clean[ck] = cv;
  });
  return clean;
}

class CastProxyService {
  constructor() {
    this.emitter = CastProxyNative ? new NativeEventEmitter(CastProxyNative) : null;
    this._webListeners = new Set();
    this._webSimTimer = null;
    this._webState = {
      sessionId: '',
      status: 'idle',
      positionSec: 0,
      durationSec: 0,
      bufferedSec: 0,
      qualityIndex: -1,
      levels: [],
      playbackRate: 1,
      aspectMode: 'contain',
      volume: 100,
      muted: false,
      title: '',
      errorMessage: '',
      updatedAtMs: Date.now(),
    };
  }

  _emitWebState() {
    this._webState.updatedAtMs = Date.now();
    const snapshot = { ...this._webState, levels: [...this._webState.levels] };
    this._webListeners.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (_) {}
    });
  }

  _stopWebSimTimer() {
    if (this._webSimTimer) {
      clearInterval(this._webSimTimer);
      this._webSimTimer = null;
    }
  }

  _ensureWebSimTimer() {
    if (this._webSimTimer) return;
    this._webSimTimer = setInterval(() => {
      if (this._webState.status !== 'playing') return;
      const rate = Number(this._webState.playbackRate) || 1;
      const dur = Number(this._webState.durationSec) || 2700;
      const nextPos = Math.min(dur, (Number(this._webState.positionSec) || 0) + rate);
      this._webState.positionSec = nextPos;
      this._webState.bufferedSec = Math.min(dur, nextPos + 45);
      if (dur > 0 && nextPos >= dur) {
        this._webState.status = 'ended';
        this._stopWebSimTimer();
      }
      this._emitWebState();
    }, 1000);
  }

  isSupported() {
    return IS_WEB || Boolean(CastProxyNative);
  }

  async ensureNotificationPermission() {
    if (Platform.OS !== 'android') return true;
    try {
      const apiLevel = Number(Platform.Version) || 0;
      if (
        apiLevel >= 33 &&
        PermissionsAndroid &&
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      ) {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        return res === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async getPendingExternalIntent() {
    if (
      IS_WEB ||
      !CastProxyNative ||
      typeof CastProxyNative.getPendingExternalIntent !== 'function'
    ) {
      return null;
    }
    return CastProxyNative.getPendingExternalIntent();
  }

  subscribeExternalMedia(callback) {
    if (IS_WEB || !this.emitter || typeof callback !== 'function') {
      return () => {};
    }
    const sub = this.emitter.addListener('onExternalMediaReceived', callback);
    return () => sub.remove();
  }

  subscribeProxyStopped(callback) {
    if (IS_WEB || !this.emitter || typeof callback !== 'function') {
      return () => {};
    }
    const sub = this.emitter.addListener('onCastProxyStopped', callback);
    return () => sub.remove();
  }

  subscribeReceiverState(callback) {
    if (typeof callback !== 'function') return () => {};
    if (IS_WEB) {
      this._webListeners.add(callback);
      callback({ ...this._webState, levels: [...this._webState.levels] });
      return () => {
        this._webListeners.delete(callback);
      };
    }
    if (!this.emitter) return () => {};
    const sub = this.emitter.addListener('onWebReceiverState', (evt) => {
      try {
        const raw = evt && evt.json ? evt.json : evt;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          callback(parsed);
        }
      } catch (_) {
        // ignore malformed state event
      }
    });
    return () => sub.remove();
  }

  async getServerInfo() {
    if (IS_WEB) {
      return {
        lanIp: '192.168.1.25',
        port: 8899,
        receiverUrl: 'http://192.168.1.25:8899/tv',
        simulated: true,
      };
    }
    if (!CastProxyNative || typeof CastProxyNative.getServerInfo !== 'function') {
      throw new Error('معلومات الخادم المحلي غير متاحة في هذا البناء.');
    }
    return CastProxyNative.getServerInfo();
  }

  async getReceiverState() {
    if (IS_WEB) {
      return { ...this._webState, levels: [...this._webState.levels] };
    }
    if (!CastProxyNative || typeof CastProxyNative.getReceiverState !== 'function') {
      return null;
    }
    const raw = await CastProxyNative.getReceiverState();
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      return null;
    }
  }

  async sendReceiverCommand(type, payload = {}) {
    const cleanType = String(type || '').trim();
    if (!cleanType) return { ok: false };

    if (IS_WEB) {
      const p = payload && typeof payload === 'object' ? payload : {};
      if (cleanType === 'load') {
        this._webState = {
          ...this._webState,
          sessionId: p.sessionId || this._webState.sessionId || 'web_sim',
          status: 'playing',
          positionSec: Math.max(0, Number(p.startPositionSec) || 0),
          durationSec: 2745,
          bufferedSec: Math.min(2745, (Number(p.startPositionSec) || 0) + 60),
          qualityIndex: -1,
          levels: [
            { index: 0, label: '1080p', height: 1080, bitrate: 5200000 },
            { index: 1, label: '720p', height: 720, bitrate: 2800000 },
            { index: 2, label: '480p', height: 480, bitrate: 1200000 },
          ],
          title: p.title || 'بث سينمائي تجريبي',
          errorMessage: '',
        };
        this._ensureWebSimTimer();
      } else if (cleanType === 'play') {
        this._webState.status = 'playing';
        this._ensureWebSimTimer();
      } else if (cleanType === 'pause') {
        this._webState.status = 'paused';
      } else if (cleanType === 'toggle') {
        this._webState.status = this._webState.status === 'playing' ? 'paused' : 'playing';
        if (this._webState.status === 'playing') this._ensureWebSimTimer();
      } else if (cleanType === 'seek') {
        const dur = this._webState.durationSec || 2745;
        this._webState.positionSec = Math.max(0, Math.min(dur, Number(p.positionSec) || 0));
      } else if (cleanType === 'seekDelta') {
        const dur = this._webState.durationSec || 2745;
        this._webState.positionSec = Math.max(
          0,
          Math.min(dur, (this._webState.positionSec || 0) + (Number(p.deltaSec) || 0))
        );
      } else if (cleanType === 'setQuality') {
        this._webState.qualityIndex = Number(p.levelIndex ?? -1);
      } else if (cleanType === 'setRate') {
        this._webState.playbackRate = Number(p.playbackRate) || 1;
      } else if (cleanType === 'setAspect') {
        this._webState.aspectMode = p.aspectMode === 'cover' ? 'cover' : 'contain';
      } else if (cleanType === 'setVolume') {
        this._webState.volume = Math.max(0, Math.min(100, Math.round(Number(p.volume) || 0)));
      } else if (cleanType === 'setMute') {
        this._webState.muted = Boolean(p.muted);
      } else if (cleanType === 'stop') {
        this._stopWebSimTimer();
        this._webState.status = 'idle';
        this._webState.positionSec = 0;
      }
      this._emitWebState();
      return { ok: true, seq: Date.now(), simulated: true };
    }

    if (!CastProxyNative || typeof CastProxyNative.sendReceiverCommand !== 'function') {
      throw new Error('التحكم في مشغّل السينما غير متاح في هذا البناء.');
    }
    const payloadJson = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
    return CastProxyNative.sendReceiverCommand(cleanType, payloadJson);
  }

  async openSmartBrowser(initialUrl = '') {
    if (IS_WEB) {
      const sampleUrl =
        String(initialUrl || '').trim() ||
        'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
      return {
        mode: 'cast',
        video: {
          url: sampleUrl,
          title: 'Big Buck Bunny HLS (معاينة الويب)',
          mimeType: 'application/vnd.apple.mpegurl',
          headers: { Referer: 'https://test-streams.mux.dev/' },
        },
        subtitle: null,
        simulated: true,
      };
    }
    if (!CastProxyNative || typeof CastProxyNative.openSmartBrowser !== 'function') {
      throw new Error('متصفح الصيد الذكي غير متاح في هذا البناء.');
    }
    return CastProxyNative.openSmartBrowser(initialUrl ? String(initialUrl).trim() : null);
  }

  async copyToClipboard(text) {
    const clean = String(text || '');
    if (!clean) return false;
    if (IS_WEB) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(clean);
        return true;
      }
      return false;
    }
    if (!CastProxyNative || typeof CastProxyNative.copyToClipboard !== 'function') {
      return false;
    }
    return CastProxyNative.copyToClipboard(clean);
  }

  async startProxySession(url, headersMap = {}, title = '', subtitleUrl = null) {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) {
      throw new Error('أدخل رابط الفيديو أو مسار الملف أولاً.');
    }
    await this.ensureNotificationPermission();
    const cleanHeaders = sanitizeHeaders(headersMap);
    const safeTitle = String(title || '').trim() || inferMovieTitleFromUrl(cleanUrl);
    const cleanSub = subtitleUrl ? String(subtitleUrl).trim() : null;

    if (IS_WEB) {
      const sid = `web${Date.now().toString(36).slice(-6)}`;
      const lanIp = '192.168.1.25';
      const port = 8899;
      return {
        sessionId: sid,
        proxyStreamUrl: `http://${lanIp}:${port}/stream/${sid}`,
        proxySubtitleUrl: cleanSub ? `http://${lanIp}:${port}/sub/${sid}.srt` : null,
        proxySubtitleVttUrl: cleanSub ? `http://${lanIp}:${port}/sub/${sid}.vtt` : null,
        lanIp,
        port,
        simulated: true,
      };
    }

    if (!CastProxyNative || typeof CastProxyNative.startProxySession !== 'function') {
      throw new Error('وحدة البروكسي المحلي غير متاحة في هذا البناء.');
    }
    return CastProxyNative.startProxySession(cleanUrl, cleanHeaders, safeTitle, cleanSub);
  }

  async updateSessionSubtitle(sessionId, subtitleUrlOrPath, offsetMs = 0) {
    const cleanId = String(sessionId || '').trim();
    if (!cleanId) {
      throw new Error('لا توجد جلسة بث نشطة.');
    }
    const cleanSub = subtitleUrlOrPath ? String(subtitleUrlOrPath).trim() : null;
    const safeOffset = Math.round(Number(offsetMs) || 0);

    if (IS_WEB) {
      const lanIp = '192.168.1.25';
      const port = 8899;
      return {
        sessionId: cleanId,
        proxyStreamUrl: `http://${lanIp}:${port}/stream/${cleanId}`,
        proxySubtitleUrl: cleanSub ? `http://${lanIp}:${port}/sub/${cleanId}.srt` : null,
        proxySubtitleVttUrl: cleanSub ? `http://${lanIp}:${port}/sub/${cleanId}.vtt` : null,
        lanIp,
        port,
        simulated: true,
      };
    }

    if (!CastProxyNative || typeof CastProxyNative.updateSessionSubtitle !== 'function') {
      throw new Error('تحديث الترجمة غير متاح في هذا البناء.');
    }
    return CastProxyNative.updateSessionSubtitle(cleanId, cleanSub, safeOffset);
  }

  async stopProxySession() {
    if (IS_WEB) {
      this._stopWebSimTimer();
      this._webState.status = 'idle';
      this._webState.positionSec = 0;
      this._emitWebState();
      return true;
    }
    if (!CastProxyNative || typeof CastProxyNative.stopProxySession !== 'function') {
      return false;
    }
    return CastProxyNative.stopProxySession();
  }

  async pickLocalSubtitle() {
    if (IS_WEB) {
      return {
        uri: 'content://media/external/file/arabic_sub.srt',
        name: 'Arabic_Subtitle.srt',
        sizeBytes: 48 * 1024,
        mimeType: 'application/x-subrip',
        simulated: true,
      };
    }
    if (!CastProxyNative || typeof CastProxyNative.pickLocalSubtitle !== 'function') {
      throw new Error('منتقي ملفات الترجمة غير متاح.');
    }
    return CastProxyNative.pickLocalSubtitle();
  }

  async castSessionToDlna(targetIp, streamUrl, title, subtitleUrl = null, mimeType = 'video/mp4') {
    if (IS_WEB) {
      await new Promise((r) => setTimeout(r, 250));
      return {
        casted: true,
        deviceName: `Samsung AU7000 (${targetIp || '192.168.1.50'})`,
        deviceIp: targetIp || '192.168.1.50',
        simulated: true,
      };
    }
    if (!CastProxyNative || typeof CastProxyNative.castSessionToDlna !== 'function') {
      throw new Error('البث المباشر عبر DLNA غير متاح في هذا البناء.');
    }
    return CastProxyNative.castSessionToDlna(
      targetIp ? String(targetIp).trim() : null,
      String(streamUrl || '').trim(),
      String(title || '').trim() || 'Video Stream',
      subtitleUrl ? String(subtitleUrl).trim() : null,
      String(mimeType || 'video/mp4')
    );
  }
}

export default new CastProxyService();
