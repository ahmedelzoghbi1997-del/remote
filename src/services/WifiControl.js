import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const IS_WEB = Platform.OS === 'web';
const SAMSUNG_YOUTUBE_APP_ID = '111299001912';

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.privacyredirect.com',
  'https://iv.datura.network',
];

const STORAGE_TOKEN_PREFIX = '@universal_remote_tizen_token_';
const STORAGE_LAST_TV_KEY = '@universal_remote_last_tv_config';
const SAMSUNG_REMOTE_APP_NAME = 'Remote App';
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(input) {
  const str = String(input || '');
  let output = '';
  for (let i = 0; i < str.length; i += 3) {
    const b1 = str.charCodeAt(i) & 0xff;
    const hasB2 = i + 1 < str.length;
    const hasB3 = i + 2 < str.length;
    const b2 = hasB2 ? str.charCodeAt(i + 1) & 0xff : 0;
    const b3 = hasB3 ? str.charCodeAt(i + 2) & 0xff : 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;

    output += BASE64_CHARS[(triplet >>> 18) & 0x3f];
    output += BASE64_CHARS[(triplet >>> 12) & 0x3f];
    output += hasB2 ? BASE64_CHARS[(triplet >>> 6) & 0x3f] : '=';
    output += hasB3 ? BASE64_CHARS[triplet & 0x3f] : '=';
  }
  return output;
}

const WIFI_KEY_MAP = {
  POWER: { roku: 'Power', androidTv: 'KEYCODE_POWER', tizen: 'KEY_POWER' },
  VOL_UP: { roku: 'VolumeUp', androidTv: 'KEYCODE_VOLUME_UP', tizen: 'KEY_VOLUP' },
  VOL_DOWN: { roku: 'VolumeDown', androidTv: 'KEYCODE_VOLUME_DOWN', tizen: 'KEY_VOLDOWN' },
  MUTE: { roku: 'VolumeMute', androidTv: 'KEYCODE_VOLUME_MUTE', tizen: 'KEY_MUTE' },
  CH_UP: { roku: 'ChannelUp', androidTv: 'KEYCODE_CHANNEL_UP', tizen: 'KEY_CHUP' },
  CH_DOWN: { roku: 'ChannelDown', androidTv: 'KEYCODE_CHANNEL_DOWN', tizen: 'KEY_CHDOWN' },
  UP: { roku: 'Up', androidTv: 'KEYCODE_DPAD_UP', tizen: 'KEY_UP' },
  DOWN: { roku: 'Down', androidTv: 'KEYCODE_DPAD_DOWN', tizen: 'KEY_DOWN' },
  LEFT: { roku: 'Left', androidTv: 'KEYCODE_DPAD_LEFT', tizen: 'KEY_LEFT' },
  RIGHT: { roku: 'Right', androidTv: 'KEYCODE_DPAD_RIGHT', tizen: 'KEY_RIGHT' },
  OK: { roku: 'Select', androidTv: 'KEYCODE_DPAD_CENTER', tizen: 'KEY_ENTER' },
  BACK: { roku: 'Back', androidTv: 'KEYCODE_BACK', tizen: 'KEY_RETURN' },
  HOME: { roku: 'Home', androidTv: 'KEYCODE_HOME', tizen: 'KEY_HOME' },
  MENU: { roku: 'Info', androidTv: 'KEYCODE_MENU', tizen: 'KEY_MENU' },
  INPUT: { roku: 'InputHDMI1', androidTv: 'KEYCODE_TV_INPUT', tizen: 'KEY_SOURCE' },
  YOUTUBE: { roku: 'Home', androidTv: 'KEYCODE_MEDIA_TOP_MENU', tizen: 'KEY_APPS' },
  NETFLIX: { roku: 'Home', androidTv: 'KEYCODE_BUTTON_1', tizen: 'KEY_APPS' },
};

function formatDurationSeconds(seconds, isLive = false) {
  if (isLive || seconds === -1) return 'بث مباشر';
  const totalSeconds = Math.floor(Number(seconds) || 0);
  if (totalSeconds <= 0) return '';
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function extractYoutubeVideoId(urlOrId) {
  const raw = String(urlOrId || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  const vMatch = raw.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (vMatch && vMatch[1]) return vMatch[1];
  const shortMatch = raw.match(/(?:\/shorts\/|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (shortMatch && shortMatch[1]) return shortMatch[1];
  return '';
}

function resolveYoutubeThumbnailUrl(videoId, rawUrl) {
  const candidate = String(rawUrl || '').trim();
  if (/^https:\/\/i\d*\.ytimg\.com\//i.test(candidate)) {
    return candidate;
  }
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function raceFirstNonEmpty(tasks) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      reject(new Error('No providers configured'));
      return;
    }
    let pending = tasks.length;
    let settled = false;
    let lastError = null;

    tasks.forEach((task) => {
      Promise.resolve()
        .then(task)
        .then((items) => {
          if (!settled && Array.isArray(items) && items.length > 0) {
            settled = true;
            resolve(items);
            return;
          }
          pending -= 1;
          if (!settled && pending === 0) {
            reject(lastError || new Error('Empty search results'));
          }
        })
        .catch((err) => {
          lastError = err;
          pending -= 1;
          if (!settled && pending === 0) {
            reject(lastError || new Error('All search providers failed'));
          }
        });
    });
  });
}

function extractSubnetPrefix(ip) {
  const parts = String(ip || '')
    .trim()
    .split('.');
  if (parts.length >= 3 && parts.slice(0, 3).every((p) => /^\d{1,3}$/.test(p))) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return '192.168.1';
}

function extractXmlTagValue(xmlText, tagName) {
  if (!xmlText) return '';
  const regex = new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, 'i');
  const match = xmlText.match(regex);
  return match && match[1] ? match[1].trim() : '';
}

class WifiControlService {
  constructor() {
    this.protocol = 'samsung_tizen'; // 'samsung_tizen' | 'android_tv' | 'roku'
    this.ipAddress = '192.168.1.50';
    this.port = 8002;
    this.dialPort = 8080;
    this.ws = null;
    this.isConnected = false;
    this.isChannelReady = false;
    this._connectPromise = null;
    this.pairingState = 'idle'; // 'idle' | 'connecting' | 'awaiting_approval' | 'paired' | 'unauthorized'
    this.authToken = null;
    this.deviceName = '';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.commandQueue = [];
    this.listeners = new Set();
    this.isScanning = false;
    this.scanAborted = false;
    this.manualDisconnect = false;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      isChannelReady: this.isChannelReady,
      protocol: this.protocol,
      ipAddress: this.ipAddress,
      port: this.port,
      dialPort: this.dialPort,
      pairingState: this.pairingState,
      hasSavedToken: Boolean(this.authToken),
      deviceName: this.deviceName,
      isScanning: this.isScanning,
    };
  }

  _notify() {
    const status = this.getStatus();
    this.listeners.forEach((cb) => cb(status));
  }

  _defaultPortForProtocol(protocol) {
    if (protocol === 'roku') return 8060;
    if (protocol === 'samsung_tizen') return 8002;
    return 8080;
  }

  _defaultDialPortForProtocol(protocol) {
    if (protocol === 'roku') return 8060;
    if (protocol === 'samsung_tizen') return 8080;
    return 8008;
  }

  _tokenStorageKey(ip) {
    return `${STORAGE_TOKEN_PREFIX}${String(ip || this.ipAddress).trim()}`;
  }

  async _storageGet(key) {
    if (IS_WEB) {
      try {
        return typeof window !== 'undefined' && window.localStorage
          ? window.localStorage.getItem(key)
          : null;
      } catch (_) {
        return null;
      }
    }
    return AsyncStorage.getItem(key);
  }

  async _storageSet(key, value) {
    if (IS_WEB) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
        }
      } catch (_) {
        // ignore
      }
      return;
    }
    return AsyncStorage.setItem(key, value);
  }

  async _storageRemove(key) {
    if (IS_WEB) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
      } catch (_) {
        // ignore
      }
      return;
    }
    return AsyncStorage.removeItem(key);
  }

  async getSavedToken(ip = this.ipAddress) {
    try {
      const token = await this._storageGet(this._tokenStorageKey(ip));
      const cleanToken = token ? token.trim() : null;
      if (ip === this.ipAddress) {
        this.authToken = cleanToken;
        if (cleanToken && this.pairingState === 'idle') {
          this.pairingState = 'paired';
        }
        this._notify();
      }
      return cleanToken;
    } catch (_) {
      return null;
    }
  }

  async saveToken(ip, token) {
    if (!token) return;
    const cleanToken = String(token).trim();
    if (!cleanToken) return;
    try {
      await this._storageSet(this._tokenStorageKey(ip), cleanToken);
    } catch (_) {
      // الاحتفاظ بالـ Token في الذاكرة في حال تعذر التخزين المؤقت
    }
    if (ip === this.ipAddress) {
      this.authToken = cleanToken;
      this.pairingState = 'paired';
      this._notify();
    }
  }

  async clearToken(ip = this.ipAddress) {
    try {
      await this._storageRemove(this._tokenStorageKey(ip));
    } catch (_) {
      // ignore
    }
    if (ip === this.ipAddress) {
      this.authToken = null;
      this.pairingState = 'idle';
      this._notify();
    }
  }

  async saveLastTvConfig(config) {
    try {
      await this._storageSet(STORAGE_LAST_TV_KEY, JSON.stringify(config));
    } catch (_) {
      // ignore
    }
  }

  async loadSavedConfig() {
    try {
      const raw = await this._storageGet(STORAGE_LAST_TV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ipAddress) {
          this.protocol = parsed.protocol || 'samsung_tizen';
          this.ipAddress = parsed.ipAddress;
          this.port = Number(parsed.port) || this._defaultPortForProtocol(this.protocol);
          this.dialPort =
            Number(parsed.dialPort) || this._defaultDialPortForProtocol(this.protocol);
          this.deviceName = parsed.deviceName || '';
        }
      }
      if (this.protocol === 'samsung_tizen') {
        await this.getSavedToken(this.ipAddress);
      }
      this._notify();
      return this.getStatus();
    } catch (_) {
      return this.getStatus();
    }
  }

  configure({ protocol, ipAddress, port, dialPort, deviceName }) {
    const nextProtocol = protocol || this.protocol;
    const nextIp = (ipAddress || this.ipAddress).trim();
    const nextPort = Number(port) || this._defaultPortForProtocol(nextProtocol);
    const nextDialPort = Number(dialPort) || this._defaultDialPortForProtocol(nextProtocol);
    const nextDeviceName =
      deviceName !== undefined ? deviceName : nextIp !== this.ipAddress ? '' : this.deviceName;

    const changed =
      nextProtocol !== this.protocol ||
      nextIp !== this.ipAddress ||
      nextPort !== this.port ||
      nextDialPort !== this.dialPort;

    this.protocol = nextProtocol;
    this.ipAddress = nextIp;
    this.port = nextPort;
    this.dialPort = nextDialPort;
    this.deviceName = nextDeviceName;

    if (changed) {
      this.authToken = null;
      this.pairingState = 'idle';
      this.disconnect();
      this.saveLastTvConfig({
        protocol: this.protocol,
        ipAddress: this.ipAddress,
        port: this.port,
        dialPort: this.dialPort,
        deviceName: this.deviceName,
      });
      if (this.protocol === 'samsung_tizen') {
        this.getSavedToken(this.ipAddress).catch(() => {});
      }
    }
    this._notify();
  }

  async connect() {
    this.manualDisconnect = false;

    if (IS_WEB) {
      const mockToken = (await this.getSavedToken(this.ipAddress)) || 'web-preview-token';
      if (this.protocol === 'samsung_tizen') {
        await this.saveToken(this.ipAddress, mockToken);
      }
      this.isConnected = true;
      this.isChannelReady = true;
      this.pairingState = 'paired';
      this._notify();
      return { connected: true, protocol: this.protocol, token: mockToken, mocked: true };
    }

    if (this.protocol === 'roku') {
      return this._verifyRokuRest();
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isChannelReady) {
      return {
        connected: true,
        protocol: this.protocol,
        token: this.authToken,
      };
    }

    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = (async () => {
      if (this.protocol === 'samsung_tizen') {
        const savedToken = await this.getSavedToken(this.ipAddress);
        // الاتصال عبر القناة الموثقة wss:// (منفذ 8002) مع احتياطي 8001 للشاشات القديمة فقط
        const primaryPort = Number(this.port) === 8001 ? 8002 : Number(this.port) || 8002;
        const fallbackPort = primaryPort === 8002 ? 8001 : 8002;

        try {
          const res = await this._connectTvSocket(primaryPort, savedToken);
          if (this.port !== primaryPort) {
            this.port = primaryPort;
            this.saveLastTvConfig({
              protocol: this.protocol,
              ipAddress: this.ipAddress,
              port: this.port,
              dialPort: this.dialPort,
              deviceName: this.deviceName,
            });
            this._notify();
          }
          return res;
        } catch (primaryErr) {
          if (this.pairingState !== 'unauthorized' && !this.manualDisconnect) {
            try {
              const fallbackRes = await this._connectTvSocket(fallbackPort, savedToken);
              this.port = fallbackPort;
              this.saveLastTvConfig({
                protocol: this.protocol,
                ipAddress: this.ipAddress,
                port: this.port,
                dialPort: this.dialPort,
                deviceName: this.deviceName,
              });
              this._notify();
              return fallbackRes;
            } catch (_) {
              throw primaryErr;
            }
          }
          throw primaryErr;
        }
      }

      return this._connectTvSocket(this.port, null);
    })().finally(() => {
      this._connectPromise = null;
    });

    return this._connectPromise;
  }

  async _verifyRokuRest() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(
        `http://${this.ipAddress}:${this.port}/query/device-info`,
        {
          method: 'GET',
          signal: controller.signal,
        }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.isConnected = true;
      this.isChannelReady = true;
      this.pairingState = 'paired';
      this._notify();
      return { connected: true, protocol: 'roku' };
    } catch (error) {
      this.isConnected = false;
      this.isChannelReady = false;
      this.pairingState = 'idle';
      this._notify();
      throw new Error(`تعذر الاتصال بشاشة Roku على ${this.ipAddress}:${this.port}`);
    } finally {
      clearTimeout(timer);
    }
  }

  _buildWebSocketUrl(portOverride, tokenOverride) {
    const targetPort = Number(portOverride || this.port);
    if (this.protocol === 'samsung_tizen') {
      const encodedName = encodeBase64(SAMSUNG_REMOTE_APP_NAME);
      const scheme = targetPort === 8002 ? 'wss' : 'ws';
      const tokenPart = tokenOverride
        ? `&token=${encodeURIComponent(tokenOverride)}`
        : '';
      return `${scheme}://${this.ipAddress}:${targetPort}/api/v2/channels/samsung.remote.control?name=${encodedName}${tokenPart}`;
    }
    return `ws://${this.ipAddress}:${targetPort}/remote`;
  }

  _connectTvSocket(portOverride = this.port, tokenOverride = this.authToken) {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isChannelReady) {
        this.isConnected = true;
        this._notify();
        resolve({ connected: true, protocol: this.protocol, token: this.authToken });
        return;
      }

      if (this.ws) {
        try {
          this.ws.onopen = null;
          this.ws.onmessage = null;
          this.ws.onclose = null;
          this.ws.onerror = null;
          this.ws.close();
        } catch (_) {
          // ignore
        }
        this.ws = null;
      }

      this.isChannelReady = false;
      this.pairingState = tokenOverride ? 'connecting' : 'awaiting_approval';
      this._notify();

      const wsUrl = this._buildWebSocketUrl(portOverride, tokenOverride);
      const socket = new WebSocket(wsUrl);
      this.ws = socket;
      let settled = false;
      let handshakeTimer = null;

      const finishResolve = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeoutId);
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        resolve(payload);
      };

      const finishReject = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeoutId);
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        reject(err);
      };

      const connectTimeoutId = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          try {
            socket.close();
          } catch (_) {
            // ignore
          }
          this.isConnected = false;
          this.isChannelReady = false;
          this.pairingState = 'idle';
          this._notify();
          finishReject(
            new Error(`انتهت مهلة اتصال WebSocket على ${this.ipAddress}:${portOverride}`)
          );
        }
      }, 6000);

      socket.onopen = () => {
        clearTimeout(connectTimeoutId);
        this.isConnected = true;
        this.reconnectAttempts = 0;

        if (this.protocol !== 'samsung_tizen') {
          this.isChannelReady = true;
          this.pairingState = 'paired';
          this._notify();
          this._flushQueue();
          finishResolve({ connected: true, protocol: this.protocol });
          return;
        }

        // إبقاء isChannelReady = false حتى يصل حدث المصادقة ms.channel.connect
        this._notify();

        handshakeTimer = setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN && !settled) {
            this.isChannelReady = true;
            if (tokenOverride) {
              this.pairingState = 'paired';
            }
            this._notify();
            this._flushQueue();
            finishResolve({
              connected: true,
              protocol: this.protocol,
              token: this.authToken,
            });
          }
        }, 1600);
      };

      socket.onmessage = async (event) => {
        if (this.protocol !== 'samsung_tizen') return;
        let data = null;
        try {
          data = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (!data || !data.event) return;

        if (data.event === 'ms.channel.connect') {
          if (handshakeTimer) {
            clearTimeout(handshakeTimer);
            handshakeTimer = null;
          }
          const receivedToken =
            (data.data && data.data.token) ||
            data.token ||
            null;

          if (receivedToken) {
            await this.saveToken(this.ipAddress, String(receivedToken));
          } else {
            this.pairingState = 'paired';
          }
          this.isConnected = true;
          this.isChannelReady = true;
          this._notify();
          this._flushQueue();
          finishResolve({
            connected: true,
            protocol: this.protocol,
            token: receivedToken ? String(receivedToken) : this.authToken,
          });
        } else if (data.event === 'ms.channel.unauthorized') {
          this.isConnected = false;
          this.isChannelReady = false;
          this.pairingState = 'unauthorized';
          if (tokenOverride) {
            await this.clearToken(this.ipAddress);
            this.pairingState = 'unauthorized';
          }
          this._notify();
          finishReject(
            new Error(
              'الشاشة تطلب الموافقة على الاقتران — يرجى الضغط على "سماح" (Allow) في شاشة التلفاز.'
            )
          );
        } else if (data.event === 'ms.channel.timeOut') {
          this.isConnected = false;
          this.isChannelReady = false;
          this.pairingState = 'idle';
          this._notify();
          finishReject(
            new Error('انتهت مهلة الموافقة على شاشة التلفاز. أعد المحاولة واضغط "سماح".')
          );
        }
      };

      socket.onclose = () => {
        clearTimeout(connectTimeoutId);
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        this.isConnected = false;
        this.isChannelReady = false;
        this._notify();
        if (!settled) {
          finishReject(
            new Error(`تم إغلاق الاتصال مع الشاشة (${this.ipAddress}:${portOverride})`)
          );
        }
        if (!this.manualDisconnect && this.pairingState !== 'unauthorized') {
          this._scheduleReconnect();
        }
      };

      socket.onerror = () => {
        clearTimeout(connectTimeoutId);
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        this.isConnected = false;
        this.isChannelReady = false;
        this._notify();
        finishReject(
          new Error(`فشل اتصال WebSocket مع الشاشة (${this.ipAddress}:${portOverride})`)
        );
      };
    });
  }

  _scheduleReconnect() {
    if (this.protocol === 'roku' || this.manualDisconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts += 1;
    const delayMs = Math.min(8000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    setTimeout(() => {
      if (!this.isConnected && !this.manualDisconnect && this.protocol !== 'roku') {
        this.connect().catch(() => {});
      }
    }, delayMs);
  }

  _flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isChannelReady) return;
    while (this.commandQueue.length > 0) {
      const payload = this.commandQueue.shift();
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    this._connectPromise = null;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch (_) {
        // ignore
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.isChannelReady = false;
    this.commandQueue = [];
    this._notify();
  }

  /**
   * فحص الشبكة المحلية لاكتشاف الشاشات الذكية (Samsung Tizen / Android TV / Roku)
   */
  async _probeHostForTv(ip) {
    // 1. فحص خدمة Samsung Tizen REST API على المنفذ 8001
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 520);
      try {
        const res = await fetch(`http://${ip}:8001/api/v2/`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          const device = data && data.device ? data.device : {};
          const tokenSupport =
            device.TokenAuthSupport === 'true' ||
            device.tokenAuthSupport === true ||
            device.TokenAuthSupport === true;
          return {
            ip,
            protocol: 'samsung_tizen',
            port: 8002,
            fallbackPort: 8001,
            dialPort: 8080,
            name: device.name || data.name || 'Samsung Smart TV',
            modelName: device.modelName || 'Tizen TV',
            tokenAuthSupport: Boolean(tokenSupport),
          };
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (_) {
      // ليست شاشة سامسونج على المنفذ 8001
    }

    // 2. فحص Roku ECP على المنفذ 8060
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 450);
      try {
        const res = await fetch(`http://${ip}:8060/query/device-info`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (res.ok) {
          const xml = await res.text();
          return {
            ip,
            protocol: 'roku',
            port: 8060,
            dialPort: 8060,
            name:
              extractXmlTagValue(xml, 'friendly-device-name') ||
              extractXmlTagValue(xml, 'user-device-name') ||
              'Roku TV',
            modelName: extractXmlTagValue(xml, 'model-name') || 'Roku ECP',
            tokenAuthSupport: false,
          };
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (_) {
      // ليست شاشة Roku
    }

    // 3. فحص Android TV / Chromecast DIAL على المنفذ 8008
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 450);
      try {
        const res = await fetch(`http://${ip}:8008/setup/eureka_info`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          return {
            ip,
            protocol: 'android_tv',
            port: 8080,
            dialPort: 8008,
            name: (data && data.name) || 'Android TV',
            modelName: (data && data.model_name) || 'Chromecast / Android TV',
            tokenAuthSupport: false,
          };
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (_) {
      // ليست شاشة Android TV على 8008
    }

    return null;
  }

  abortDiscovery() {
    this.scanAborted = true;
    this.isScanning = false;
    this._notify();
  }

  async discoverSmartTvs({ subnetPrefix, onProgress, onDeviceFound } = {}) {
    const cleanSubnet = extractSubnetPrefix(subnetPrefix || this.ipAddress);
    this.isScanning = true;
    this.scanAborted = false;
    this._notify();

    if (IS_WEB) {
      const mockDevices = [
        {
          ip: `${cleanSubnet}.50`,
          protocol: 'samsung_tizen',
          port: 8002,
          fallbackPort: 8001,
          dialPort: 8080,
          name: 'Samsung QLED 65" (معاينة)',
          modelName: 'QE65Q80C Tizen',
          tokenAuthSupport: true,
        },
        {
          ip: `${cleanSubnet}.62`,
          protocol: 'android_tv',
          port: 8080,
          dialPort: 8008,
          name: 'Android TV (معاينة)',
          modelName: 'Google TV 4K',
          tokenAuthSupport: false,
        },
      ];
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (!this.scanAborted) {
        if (onDeviceFound) {
          mockDevices.forEach((d) => onDeviceFound(d));
        }
        if (onProgress) {
          onProgress({ scanned: 254, total: 254, foundDevices: mockDevices });
        }
      }
      this.isScanning = false;
      this._notify();
      return this.scanAborted ? [] : mockDevices;
    }

    const candidateIps = [];
    if (this.ipAddress && this.ipAddress.startsWith(`${cleanSubnet}.`)) {
      candidateIps.push(this.ipAddress);
    }
    for (let host = 1; host <= 254; host += 1) {
      const ip = `${cleanSubnet}.${host}`;
      if (ip !== this.ipAddress) {
        candidateIps.push(ip);
      }
    }

    const foundMap = new Map();
    const total = candidateIps.length;
    const batchSize = 24;
    let scanned = 0;

    try {
      for (let i = 0; i < candidateIps.length; i += batchSize) {
        if (this.scanAborted) break;
        const batch = candidateIps.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((ip) => this._probeHostForTv(ip)));

        for (const device of results) {
          if (device && !foundMap.has(device.ip)) {
            foundMap.set(device.ip, device);
            if (onDeviceFound) {
              onDeviceFound(device);
            }
          }
        }

        scanned += batch.length;
        if (onProgress) {
          onProgress({
            scanned: Math.min(scanned, total),
            total,
            foundDevices: Array.from(foundMap.values()),
          });
        }
      }

      const finalList = Array.from(foundMap.values()).sort((a, b) => {
        if (a.protocol === 'samsung_tizen' && b.protocol !== 'samsung_tizen') return -1;
        if (a.protocol !== 'samsung_tizen' && b.protocol === 'samsung_tizen') return 1;
        return a.ip.localeCompare(b.ip);
      });

      return finalList;
    } finally {
      this.isScanning = false;
      this._notify();
    }
  }

  _buildWsPayload(mapped) {
    if (this.protocol === 'samsung_tizen') {
      return {
        method: 'ms.remote.control',
        params: {
          Cmd: 'Click',
          DataOfCmd: mapped.tizen,
          Option: 'false',
          TypeOfRemote: 'SendRemoteKey',
        },
      };
    }
    return {
      type: 'KEY_EVENT',
      keyCode: mapped.androidTv,
      action: 'CLICK',
      timestamp: Date.now(),
    };
  }

  async sendCommand(commandKey) {
    const mapped = WIFI_KEY_MAP[commandKey];
    if (!mapped) {
      throw new Error(`الأمر ${commandKey} غير مدعوم عبر الواي فاي.`);
    }

    if (IS_WEB) {
      this.isConnected = true;
      this.pairingState = 'paired';
      this._notify();
      return { sent: true, mocked: true, protocol: this.protocol, key: commandKey };
    }

    if (this.protocol === 'roku') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const endpoint = `http://${this.ipAddress}:${this.port}/keypress/${mapped.roku}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`فشل أمر Roku ECP (${response.status})`);
        }
        this.isConnected = true;
        this._notify();
        return { sent: true, protocol: 'roku', key: mapped.roku };
      } finally {
        clearTimeout(timer);
      }
    }

    const payload = this._buildWsPayload(mapped);
    await this._sendWsJson(payload);

    return { sent: true, protocol: this.protocol, payload };
  }

  async _sendWsJson(payload) {
    if (IS_WEB) {
      this.isConnected = true;
      this.isChannelReady = true;
      this.pairingState = 'paired';
      this._notify();
      return { sent: true, mocked: true, payload };
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isChannelReady) {
      this.ws.send(JSON.stringify(payload));
      return { sent: true, payload };
    }

    this.commandQueue.push(payload);
    try {
      await this.connect();
    } catch (error) {
      const idx = this.commandQueue.indexOf(payload);
      if (idx !== -1) {
        this.commandQueue.splice(idx, 1);
      }
      throw error;
    }

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.isChannelReady &&
      this.commandQueue.includes(payload)
    ) {
      this._flushQueue();
    }

    return { sent: true, payload };
  }

  async _postWithTimeout(url, options = {}, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async _fetchJsonWithTimeout(url, timeoutMs = 5000) {
    const res = await this._postWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      },
      timeoutMs
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    if (!text) {
      throw new Error('Empty JSON response');
    }
    return JSON.parse(text);
  }

  /**
   * فتح تطبيق يوتيوب مباشرة على الشاشة الذكية
   * - Samsung Tizen (مثل AU7000): يعتمد حصرياً على قناة WebSocket الموثقة (Port 8002)
   *   عبر حدث ed.apps.launch (NATIVE_LAUNCH) بعد جاهزية ms.channel.connect
   */
  async launchYouTube() {
    if (IS_WEB) {
      return {
        launched: true,
        mocked: true,
        method: this.protocol === 'samsung_tizen' ? 'websocket_8002' : 'dial',
        endpoint:
          this.protocol === 'samsung_tizen'
            ? `wss://${this.ipAddress}:${this.port}`
            : `http://${this.ipAddress}:${this.dialPort}/apps/YouTube`,
      };
    }

    if (this.protocol === 'roku') {
      const url = `http://${this.ipAddress}:${this.port}/launch/837`;
      const res = await this._postWithTimeout(url, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`تعذر فتح يوتيوب على Roku (${res.status})`);
      }
      return { launched: true, method: 'roku_ecp', endpoint: url };
    }

    if (this.protocol === 'samsung_tizen') {
      const tizenLaunchPayload = {
        method: 'ms.channel.emit',
        params: {
          event: 'ed.apps.launch',
          to: 'host',
          data: {
            appId: SAMSUNG_YOUTUBE_APP_ID,
            action_type: 'NATIVE_LAUNCH',
          },
        },
      };

      await this._sendWsJson(tizenLaunchPayload);
      return {
        launched: true,
        method: 'websocket_8002',
        appId: SAMSUNG_YOUTUBE_APP_ID,
        endpoint: `${Number(this.port) === 8002 ? 'wss' : 'ws'}://${this.ipAddress}:${this.port}`,
      };
    }

    const candidateUrls = Array.from(
      new Set([
        `http://${this.ipAddress}:${this.dialPort}/apps/YouTube`,
        `http://${this.ipAddress}:8008/apps/YouTube`,
        `http://${this.ipAddress}:8080/ws/apps/YouTube`,
      ])
    );

    for (const url of candidateUrls) {
      try {
        const res = await this._postWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
        if (res.ok || res.status === 201 || res.status === 204) {
          return { launched: true, method: 'dial', endpoint: url };
        }
      } catch (_) {
        // تجربة المسار التالي
      }
    }

    throw new Error(
      `تعذر فتح تطبيق يوتيوب على ${this.ipAddress}. تأكد من اتصال الهاتف والشاشة بنفس شبكة الواي فاي.`
    );
  }

  async _tryDialCast(cleanVideoId) {
    const dialBody = `v=${encodeURIComponent(cleanVideoId)}`;
    const candidateUrls = Array.from(
      new Set([
        `http://${this.ipAddress}:${this.dialPort}/apps/YouTube`,
        `http://${this.ipAddress}:8008/apps/YouTube`,
        `http://${this.ipAddress}:8080/ws/apps/YouTube`,
      ])
    );

    for (const url of candidateUrls) {
      try {
        const res = await this._postWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: dialBody,
          },
          3500
        );
        if (res.ok || res.status === 201 || res.status === 204) {
          return { casted: true, stage: 'dial', videoId: cleanVideoId, endpoint: url };
        }
      } catch (_) {
        // تجربة المسار التالي
      }
    }

    return null;
  }

  /**
   * إرسال فيديو محدد (Cast) وتشغيله فوراً على الشاشة:
   * - Samsung Tizen (مثل AU7000): يرسل حصرياً عبر قناة WebSocket الموثقة (8002)
   *   باستخدام DEEP_LINK و metaTag بعد جاهزية ms.channel.connect (بدون DIAL المحظور)
   * - Android TV / Chromecast: يستخدم DIAL ثم التشغيل البارد عند الحاجة
   */
  async castYouTubeVideo(videoId) {
    const cleanVideoId = extractYoutubeVideoId(videoId) || String(videoId || '').trim();
    if (!cleanVideoId) {
      throw new Error('معرف الفيديو غير صالح.');
    }

    if (IS_WEB) {
      return { casted: true, stage: 'mock', videoId: cleanVideoId, mocked: true };
    }

    if (this.protocol === 'roku') {
      const url = `http://${this.ipAddress}:${this.port}/launch/837?contentId=${encodeURIComponent(
        cleanVideoId
      )}&mediaType=live`;
      const res = await this._postWithTimeout(url, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`فشل بث الفيديو على Roku (${res.status})`);
      }
      return { casted: true, stage: 'roku_ecp', videoId: cleanVideoId, endpoint: url };
    }

    if (this.protocol === 'samsung_tizen') {
      const deepLinkPayload = {
        method: 'ms.channel.emit',
        params: {
          event: 'ed.apps.launch',
          to: 'host',
          data: {
            appId: SAMSUNG_YOUTUBE_APP_ID,
            action_type: 'DEEP_LINK',
            metaTag: `https://www.youtube.com/watch?v=${encodeURIComponent(cleanVideoId)}`,
          },
        },
      };

      await this._sendWsJson(deepLinkPayload);
      return {
        casted: true,
        stage: 'websocket_8002_deep_link',
        videoId: cleanVideoId,
        endpoint: `${Number(this.port) === 8002 ? 'wss' : 'ws'}://${this.ipAddress}:${this.port}`,
      };
    }

    // Android TV / Chromecast: محاولة DIAL ثم التشغيل البارد عند الحاجة
    const stage1Result = await this._tryDialCast(cleanVideoId);
    if (stage1Result) {
      return stage1Result;
    }

    await this.launchYouTube();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const stage2Result = await this._tryDialCast(cleanVideoId);
    if (stage2Result) {
      return {
        ...stage2Result,
        stage: 'cold_start_dial_retry',
      };
    }

    throw new Error(
      `تعذر تشغيل الفيديو (${cleanVideoId}) عبر DIAL على ${this.ipAddress}.`
    );
  }

  async _searchPipedInstance(baseUrl, cleanQuery, timeoutMs = 4500) {
    const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(cleanQuery)}&filter=videos`;
    const data = await this._fetchJsonWithTimeout(searchUrl, timeoutMs);
    const items = data && Array.isArray(data.items) ? data.items : [];
    const seenIds = new Set();
    const results = [];

    for (const item of items) {
      if (!item || (item.type && item.type !== 'stream')) continue;
      const videoId = extractYoutubeVideoId(item.url || item.videoId);
      if (!videoId || seenIds.has(videoId)) continue;
      seenIds.add(videoId);

      results.push({
        videoId,
        title: item.title || 'فيديو يوتيوب',
        channelTitle: item.uploaderName || item.uploader || 'YouTube',
        thumbnailUrl: resolveYoutubeThumbnailUrl(videoId, item.thumbnail),
        durationText: formatDurationSeconds(item.duration, item.duration === -1),
      });

      if (results.length >= 12) break;
    }

    return results;
  }

  async _searchInvidiousInstance(baseUrl, cleanQuery, timeoutMs = 4500) {
    const searchUrl = `${baseUrl}/api/v1/search?q=${encodeURIComponent(cleanQuery)}&type=video`;
    const items = await this._fetchJsonWithTimeout(searchUrl, timeoutMs);
    if (!Array.isArray(items)) return [];
    const seenIds = new Set();
    const results = [];

    for (const item of items) {
      if (!item || (item.type && item.type !== 'video')) continue;
      const videoId = extractYoutubeVideoId(item.videoId);
      if (!videoId || seenIds.has(videoId)) continue;
      seenIds.add(videoId);

      const thumbs = Array.isArray(item.videoThumbnails) ? item.videoThumbnails : [];
      const preferredThumb = thumbs.find((t) => t.quality === 'medium') || thumbs[0] || null;

      results.push({
        videoId,
        title: item.title || 'فيديو يوتيوب',
        channelTitle: item.author || 'YouTube',
        thumbnailUrl: resolveYoutubeThumbnailUrl(videoId, preferredThumb && preferredThumb.url),
        durationText: formatDurationSeconds(item.lengthSeconds, Boolean(item.liveNow)),
      });

      if (results.length >= 12) break;
    }

    return results;
  }

  /**
   * البحث في يوتيوب مجاناً وبدون أي مفتاح API عبر سباق متوازٍ بين خوادم Piped و Invidious
   */
  async searchYouTubeVideos(query) {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      throw new Error('أدخل عبارة للبحث في يوتيوب.');
    }

    const wave1Tasks = [
      ...PIPED_INSTANCES.slice(0, 3).map((url) => () => this._searchPipedInstance(url, cleanQuery, 4500)),
      ...INVIDIOUS_INSTANCES.slice(0, 3).map(
        (url) => () => this._searchInvidiousInstance(url, cleanQuery, 4500)
      ),
    ];

    try {
      return await raceFirstNonEmpty(wave1Tasks);
    } catch (_) {
      // المتابعة إلى موجة الخوادم الاحتياطية
    }

    const wave2Tasks = [
      ...PIPED_INSTANCES.slice(3).map((url) => () => this._searchPipedInstance(url, cleanQuery, 5500)),
      ...INVIDIOUS_INSTANCES.slice(3).map(
        (url) => () => this._searchInvidiousInstance(url, cleanQuery, 5500)
      ),
    ];

    if (wave2Tasks.length > 0) {
      try {
        return await raceFirstNonEmpty(wave2Tasks);
      } catch (_) {
        // تعذرت كافة الخوادم البديلة في الموجة الثانية
      }
    }

    if (IS_WEB) {
      return [
        {
          videoId: 'dQw4w9WgXcQ',
          title: `معاينة نتيجة بحث: ${cleanQuery}`,
          channelTitle: 'YouTube Preview',
          thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
          durationText: '3:32',
        },
        {
          videoId: 'aqz-KE-bpKQ',
          title: `فيديو تجريبي للبث المباشر (${cleanQuery})`,
          channelTitle: 'Smart TV Cast',
          thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg',
          durationText: '10:34',
        },
      ];
    }

    throw new Error('تعذر جلب نتائج البحث حالياً من خوادم Piped و Invidious. تحقق من الإنترنت وأعد المحاولة.');
  }
}

export const WifiControl = new WifiControlService();
export default WifiControl;
