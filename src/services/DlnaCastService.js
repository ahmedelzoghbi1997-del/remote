import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

const IS_WEB = Platform.OS === 'web';
const DlnaNative =
  NativeModules && NativeModules.DlnaCastModule
    ? NativeModules.DlnaCastModule
    : null;

export const DEFAULT_DLNA_PLAYBACK_STATE = {
  active: false,
  transportState: 'STOPPED',
  deviceName: '',
  deviceIp: '',
  title: '',
  sourceMode: '',
  mimeType: 'video/mp4',
  positionSec: 0,
  durationSec: 0,
  isSeekable: true,
  volume: 18,
  muted: false,
  error: '',
};

export function formatSecondsHms(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return '';
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(size / 1024)} KB`;
}

export function inferMediaTitle(urlOrName, fallback = 'بث فيديو DLNA') {
  const raw = String(urlOrName || '').trim();
  if (!raw) return fallback;
  try {
    const clean = raw.split('?')[0].split('#')[0];
    const seg = decodeURIComponent(clean.substring(clean.lastIndexOf('/') + 1));
    if (seg && seg.length > 1) {
      return seg.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 60) || fallback;
    }
  } catch (_) {
    // ignore
  }
  return fallback;
}

export function isHlsOrLiveUrl(url, mimeType = '') {
  const cleanUrl = String(url || '').split('?')[0].toLowerCase();
  const cleanMime = String(mimeType || '').toLowerCase();
  return (
    cleanUrl.endsWith('.m3u8') ||
    cleanMime.includes('mpegurl') ||
    cleanMime.includes('m3u')
  );
}

class DlnaCastService {
  constructor() {
    this.emitter = DlnaNative ? new NativeEventEmitter(DlnaNative) : null;
    this.webTimer = null;
    this.webState = { ...DEFAULT_DLNA_PLAYBACK_STATE };
    this.webListeners = new Set();
  }

  isSupported() {
    return IS_WEB || Boolean(DlnaNative);
  }

  async ensureNotificationPermission() {
    if (Platform.OS !== 'android') return true;
    try {
      const apiLevel = Number(Platform.Version) || 0;
      if (apiLevel >= 33 && PermissionsAndroid && PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
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

  async discoverRenderers(priorityIp = '') {
    if (IS_WEB) {
      await new Promise((r) => setTimeout(r, 320));
      const baseIp = String(priorityIp || '192.168.1.50').trim() || '192.168.1.50';
      return [
        {
          udn: 'uuid:samsung-au7000-preview',
          name: 'Samsung AU7000 UHD TV (معاينة)',
          manufacturer: 'Samsung Electronics',
          modelName: 'UE55AU7000',
          ip: baseIp,
          port: 9197,
          location: `http://${baseIp}:9197/dmr`,
          avTransportControlUrl: `http://${baseIp}:9197/upnp/control/AVTransport1`,
          renderingControlUrl: `http://${baseIp}:9197/upnp/control/RenderingControl1`,
        },
      ];
    }
    if (!DlnaNative || typeof DlnaNative.discoverRenderers !== 'function') {
      throw new Error('وحدة البث DLNA غير متاحة في هذا البناء.');
    }
    return DlnaNative.discoverRenderers(priorityIp || null);
  }

  async pickLocalVideo() {
    if (IS_WEB) {
      return {
        uri: 'content://media/external/video/media/4096',
        name: 'Sample_4K_HDR_Movie.mkv',
        sizeBytes: 3420 * 1024 * 1024,
        mimeType: 'video/x-matroska',
        simulated: true,
      };
    }
    if (!DlnaNative || typeof DlnaNative.pickLocalVideo !== 'function') {
      throw new Error('منتقي الفيديو المحلي غير متاح.');
    }
    return DlnaNative.pickLocalVideo();
  }

  async getInitialIntent() {
    if (IS_WEB || !DlnaNative || typeof DlnaNative.getInitialIntent !== 'function') {
      return null;
    }
    return DlnaNative.getInitialIntent();
  }

  async getPlaybackState() {
    if (IS_WEB) {
      return { ...this.webState };
    }
    if (!DlnaNative || typeof DlnaNative.getPlaybackState !== 'function') {
      return { ...DEFAULT_DLNA_PLAYBACK_STATE };
    }
    return DlnaNative.getPlaybackState();
  }

  subscribeState(callback) {
    if (IS_WEB) {
      this.webListeners.add(callback);
      callback({ ...this.webState });
      return () => {
        this.webListeners.delete(callback);
      };
    }
    if (!this.emitter) {
      return () => {};
    }
    const sub = this.emitter.addListener('DlnaPlaybackState', callback);
    return () => sub.remove();
  }

  subscribeIncomingIntent(callback) {
    if (IS_WEB || !this.emitter) {
      return () => {};
    }
    const sub = this.emitter.addListener('DlnaCastIntentReceived', callback);
    return () => sub.remove();
  }

  _emitWebState() {
    const snap = { ...this.webState };
    this.webListeners.forEach((cb) => cb(snap));
  }

  _startWebTicker() {
    this._stopWebTicker();
    this.webTimer = setInterval(() => {
      if (!this.webState.active || this.webState.transportState !== 'PLAYING') return;
      if (this.webState.isSeekable && this.webState.durationSec > 0) {
        const nextPos = Math.min(this.webState.durationSec, this.webState.positionSec + 1);
        this.webState = { ...this.webState, positionSec: nextPos };
      } else {
        this.webState = { ...this.webState, positionSec: this.webState.positionSec + 1 };
      }
      this._emitWebState();
    }, 1000);
  }

  _stopWebTicker() {
    if (this.webTimer) {
      clearInterval(this.webTimer);
      this.webTimer = null;
    }
  }

  async castLocalFile(device, fileInfo) {
    if (!device || !device.ip) {
      throw new Error('يرجى اختيار الشاشة المستهدفة أولاً.');
    }
    if (!fileInfo || !fileInfo.uri) {
      throw new Error('يرجى اختيار ملف فيديو محلي أولاً.');
    }
    await this.ensureNotificationPermission();

    if (IS_WEB) {
      this.webState = {
        ...DEFAULT_DLNA_PLAYBACK_STATE,
        active: true,
        transportState: 'PLAYING',
        deviceName: device.name,
        deviceIp: device.ip,
        title: fileInfo.name || 'Local 4K Video',
        sourceMode: 'LOCAL_HTTP_206',
        mimeType: fileInfo.mimeType || 'video/mp4',
        positionSec: 0,
        durationSec: 5400,
        isSeekable: true,
        volume: this.webState.volume || 20,
        muted: false,
      };
      this._emitWebState();
      this._startWebTicker();
      return { ...this.webState };
    }

    return DlnaNative.castLocalFile(
      device,
      fileInfo.uri,
      fileInfo.name || 'Local Video',
      fileInfo.mimeType || 'video/mp4'
    );
  }

  async castRemoteUrl(device, { url, title, useProxy = true, pinHighestQuality = true, headers = {} }) {
    if (!device || !device.ip) {
      throw new Error('يرجى اختيار الشاشة المستهدفة أولاً.');
    }
    const cleanUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      throw new Error('أدخل رابط فيديو أو بث صالح يبدأ بـ http:// أو https://');
    }
    await this.ensureNotificationPermission();

    // ترقية روابط https:// تلقائياً إلى البروكسي المحلي لأن شاشات سامسونج ترفض HTTPS المباشر
    const effectiveUseProxy = Boolean(useProxy) || /^https:\/\//i.test(cleanUrl);
    const cleanHeaders = {};
    Object.entries(headers || {}).forEach(([k, v]) => {
      const ck = String(k || '').trim();
      const cv = String(v || '').trim();
      if (ck && cv) cleanHeaders[ck] = cv;
    });

    if (IS_WEB) {
      const liveHls = isHlsOrLiveUrl(cleanUrl);
      this.webState = {
        ...DEFAULT_DLNA_PLAYBACK_STATE,
        active: true,
        transportState: 'PLAYING',
        deviceName: device.name,
        deviceIp: device.ip,
        title: (title || '').trim() || inferMediaTitle(cleanUrl),
        sourceMode: effectiveUseProxy ? 'LOCAL_PROXY' : 'DIRECT_URL',
        mimeType: liveHls ? 'application/vnd.apple.mpegurl' : 'video/mp4',
        positionSec: 0,
        durationSec: liveHls ? 0 : 2700,
        isSeekable: !liveHls,
        volume: this.webState.volume || 20,
        muted: false,
      };
      this._emitWebState();
      this._startWebTicker();
      return { ...this.webState };
    }

    return DlnaNative.castRemoteUrl(
      device,
      cleanUrl,
      (title || '').trim() || inferMediaTitle(cleanUrl),
      Boolean(effectiveUseProxy),
      Boolean(pinHighestQuality),
      cleanHeaders
    );
  }

  async play() {
    if (IS_WEB) {
      this.webState = { ...this.webState, transportState: 'PLAYING' };
      this._emitWebState();
      this._startWebTicker();
      return true;
    }
    return DlnaNative ? DlnaNative.play() : false;
  }

  async pause() {
    if (IS_WEB) {
      this.webState = { ...this.webState, transportState: 'PAUSED_PLAYBACK' };
      this._emitWebState();
      this._stopWebTicker();
      return true;
    }
    return DlnaNative ? DlnaNative.pause() : false;
  }

  async stop() {
    if (IS_WEB) {
      this._stopWebTicker();
      this.webState = { ...DEFAULT_DLNA_PLAYBACK_STATE, volume: this.webState.volume };
      this._emitWebState();
      return true;
    }
    return DlnaNative ? DlnaNative.stop() : false;
  }

  async seek(seconds) {
    const safeSec = Math.max(0, Math.round(Number(seconds) || 0));
    if (IS_WEB) {
      this.webState = { ...this.webState, positionSec: safeSec };
      this._emitWebState();
      return true;
    }
    return DlnaNative ? DlnaNative.seek(safeSec) : false;
  }

  async setVolume(volume) {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    if (IS_WEB) {
      this.webState = { ...this.webState, volume: clamped };
      this._emitWebState();
      return true;
    }
    return DlnaNative ? DlnaNative.setVolume(clamped) : false;
  }

  async setMute(muted) {
    const nextMuted = Boolean(muted);
    if (IS_WEB) {
      this.webState = { ...this.webState, muted: nextMuted };
      this._emitWebState();
      return true;
    }
    return DlnaNative ? DlnaNative.setMute(nextMuted) : false;
  }
}

export default new DlnaCastService();
