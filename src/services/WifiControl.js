import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY';

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
];

const STORAGE_TOKEN_PREFIX = '@universal_remote_tizen_token_';
const STORAGE_LAST_TV_KEY = '@universal_remote_last_tv_config';
const SAMSUNG_REMOTE_APP_NAME = 'UniversalRemote'; // 15 حرفاً -> Base64 بدون '=' padding
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

function formatDurationSeconds(seconds) {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
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

  async getSavedToken(ip = this.ipAddress) {
    try {
      const token = await AsyncStorage.getItem(this._tokenStorageKey(ip));
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
      await AsyncStorage.setItem(this._tokenStorageKey(ip), cleanToken);
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
      await AsyncStorage.removeItem(this._tokenStorageKey(ip));
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
      await AsyncStorage.setItem(STORAGE_LAST_TV_KEY, JSON.stringify(config));
    } catch (_) {
      // ignore
    }
  }

  async loadSavedConfig() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_LAST_TV_KEY);
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
    if (Platform.OS === 'web') {
      this.isConnected = true;
      this.pairingState = 'paired';
      if (this.protocol === 'samsung_tizen' && !this.authToken) {
        await this.saveToken(this.ipAddress, 'mock-web-preview-token');
      }
      this._notify();
      return {
        connected: true,
        mocked: true,
        protocol: this.protocol,
        token: this.authToken,
      };
    }
    if (this.protocol === 'roku') {
      return this._verifyRokuRest();
    }

    if (this.protocol === 'samsung_tizen') {
      const savedToken = await this.getSavedToken(this.ipAddress);
      // محاولة الاتصال أولاً عبر wss:// (منفذ 8002) ثم الرجوع احتياطياً إلى ws:// (منفذ 8001) عند الفشل
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
      this.pairingState = 'paired';
      this._notify();
      return { connected: true, protocol: 'roku' };
    } catch (error) {
      this.isConnected = false;
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
      const encodedName = encodeURIComponent(encodeBase64(SAMSUNG_REMOTE_APP_NAME));
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
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
        if (handshakeTimer) clearTimeout(handshakeTimer);
        resolve(payload);
      };

      const finishReject = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeoutId);
        if (handshakeTimer) clearTimeout(handshakeTimer);
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
        this._notify();

        if (this.protocol !== 'samsung_tizen') {
          this.pairingState = 'paired';
          this._notify();
          this._flushQueue();
          finishResolve({ connected: true, protocol: this.protocol });
          return;
        }

        // انتظار حدث استجابة الشاشة ms.channel.connect لاستخراج data.data.token
        handshakeTimer = setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN) {
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
          const receivedToken =
            (data.data && data.data.token) ||
            data.token ||
            null;

          if (receivedToken) {
            await this.saveToken(this.ipAddress, String(receivedToken));
          } else {
            this.pairingState = 'paired';
            this._notify();
          }
          this.isConnected = true;
          this._flushQueue();
          finishResolve({
            connected: true,
            protocol: this.protocol,
            token: receivedToken ? String(receivedToken) : this.authToken,
          });
        } else if (data.event === 'ms.channel.unauthorized') {
          this.isConnected = false;
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
          this.pairingState = 'idle';
          this._notify();
          finishReject(
            new Error('انتهت مهلة الموافقة على شاشة التلفاز. أعد المحاولة واضغط "سماح".')
          );
        }
      };

      socket.onclose = () => {
        clearTimeout(connectTimeoutId);
        if (handshakeTimer) clearTimeout(handshakeTimer);
        this.isConnected = false;
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
        if (handshakeTimer) clearTimeout(handshakeTimer);
        this.isConnected = false;
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.commandQueue.length > 0) {
      const payload = this.commandQueue.shift();
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect() {
    this.manualDisconnect = true;
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

    if (Platform.OS === 'web') {
      const mockDevices = [
        {
          ip: `${cleanSubnet}.50`,
          protocol: 'samsung_tizen',
          port: 8002,
          fallbackPort: 8001,
          dialPort: 8080,
          name: 'Samsung QLED 65 (معاينة)',
          modelName: 'QE65Q80C · Tizen TV',
          tokenAuthSupport: true,
        },
        {
          ip: `${cleanSubnet}.64`,
          protocol: 'android_tv',
          port: 8080,
          dialPort: 8008,
          name: 'Living Room Android TV',
          modelName: 'Google TV / Chromecast',
          tokenAuthSupport: false,
        },
      ];
      await new Promise((r) => setTimeout(r, 250));
      if (!this.scanAborted) {
        mockDevices.forEach((d) => onDeviceFound && onDeviceFound(d));
        if (onProgress) {
          onProgress({ scanned: 254, total: 254, foundDevices: mockDevices });
        }
      }
      this.isScanning = false;
      this._notify();
      return mockDevices;
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

    if (Platform.OS === 'web') {
      this.isConnected = true;
      this.pairingState = 'paired';
      this._notify();
      return {
        sent: true,
        mocked: true,
        protocol: this.protocol,
        payload: this._buildWsPayload(mapped),
      };
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

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.commandQueue.push(payload);
      await this.connect();
    } else {
      this.ws.send(JSON.stringify(payload));
    }

    return { sent: true, protocol: this.protocol, payload };
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

  /**
   * فتح تطبيق يوتيوب مباشرة على الشاشة الذكية عبر DIAL / REST
   */
  async launchYouTube() {
    if (Platform.OS === 'web') {
      return { launched: true, mocked: true, endpoint: `http://${this.ipAddress}:${this.dialPort}/ws/apps/YouTube` };
    }
    if (this.protocol === 'roku') {
      const url = `http://${this.ipAddress}:${this.port}/launch/837`;
      const res = await this._postWithTimeout(url, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`تعذر فتح يوتيوب على Roku (${res.status})`);
      }
      return { launched: true, endpoint: url };
    }

    const candidateUrls =
      this.protocol === 'samsung_tizen'
        ? [
            `http://${this.ipAddress}:${this.dialPort}/ws/apps/YouTube`,
            `http://${this.ipAddress}:8001/api/v2/applications/111299001912`,
            `http://${this.ipAddress}:8008/apps/YouTube`,
          ]
        : [
            `http://${this.ipAddress}:${this.dialPort}/apps/YouTube`,
            `http://${this.ipAddress}:8080/ws/apps/YouTube`,
          ];

    for (const url of candidateUrls) {
      try {
        const res = await this._postWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
        if (res.ok || res.status === 201 || res.status === 204) {
          return { launched: true, endpoint: url };
        }
      } catch (_) {
        // تجربة المسار التالي
      }
    }

    throw new Error(
      `تعذر فتح تطبيق يوتيوب على ${this.ipAddress}. تأكد من اتصال الهاتف والشاشة بنفس شبكة الواي فاي.`
    );
  }

  /**
   * إرسال فيديو محدد (Cast) وتشغيله فوراً على الشاشة عبر بروتوكول DIAL
   */
  async castYouTubeVideo(videoId) {
    if (!videoId) {
      throw new Error('معرف الفيديو غير صالح.');
    }

    if (Platform.OS === 'web') {
      return { casted: true, mocked: true, videoId };
    }

    if (this.protocol === 'roku') {
      const url = `http://${this.ipAddress}:${this.port}/launch/837?contentId=${encodeURIComponent(
        videoId
      )}&mediaType=live`;
      const res = await this._postWithTimeout(url, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`فشل بث الفيديو على Roku (${res.status})`);
      }
      return { casted: true, videoId, endpoint: url };
    }

    const dialBody = `v=${encodeURIComponent(videoId)}`;
    const candidateUrls =
      this.protocol === 'samsung_tizen'
        ? [
            `http://${this.ipAddress}:${this.dialPort}/ws/apps/YouTube`,
            `http://${this.ipAddress}:8008/apps/YouTube`,
          ]
        : [
            `http://${this.ipAddress}:${this.dialPort}/apps/YouTube`,
            `http://${this.ipAddress}:8080/ws/apps/YouTube`,
          ];

    for (const url of candidateUrls) {
      try {
        const res = await this._postWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: dialBody,
        });
        if (res.ok || res.status === 201 || res.status === 204) {
          return { casted: true, videoId, endpoint: url };
        }
      } catch (_) {
        // تجربة المسار التالي
      }
    }

    throw new Error(
      `تعذر تشغيل الفيديو (${videoId}) عبر DIAL على ${this.ipAddress}.`
    );
  }

  /**
   * البحث في يوتيوب عبر YouTube Data API v3 (عند توفر المفتاح)
   * أو عبر واجهة Invidious مفتوحة المصدر تلقائياً دون الحاجة لمفتاح
   */
  async searchYouTubeVideos(query) {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      throw new Error('أدخل عبارة للبحث في يوتيوب.');
    }

    if (YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY') {
      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(
        cleanQuery
      )}&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;

      const res = await this._postWithTimeout(apiUrl, { method: 'GET' }, 7000);
      if (!res.ok) {
        throw new Error(`فشل البحث عبر YouTube Data API (${res.status})`);
      }
      const data = await res.json();
      return (data.items || [])
        .filter((item) => item && item.id && item.id.videoId)
        .map((item) => ({
          videoId: item.id.videoId,
          title: item.snippet.title || 'فيديو يوتيوب',
          channelTitle: item.snippet.channelTitle || 'YouTube',
          thumbnailUrl:
            (item.snippet.thumbnails &&
              ((item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url) ||
                (item.snippet.thumbnails.default && item.snippet.thumbnails.default.url))) ||
            `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
          durationText: '',
        }));
    }

    for (const baseUrl of INVIDIOUS_INSTANCES) {
      try {
        const searchUrl = `${baseUrl}/api/v1/search?q=${encodeURIComponent(
          cleanQuery
        )}&type=video`;
        const res = await this._postWithTimeout(searchUrl, { method: 'GET' }, 6500);
        if (!res.ok) continue;

        const items = await res.json();
        if (!Array.isArray(items)) continue;

        const normalized = items
          .filter((item) => item && item.videoId)
          .slice(0, 12)
          .map((item) => {
            const thumbs = Array.isArray(item.videoThumbnails) ? item.videoThumbnails : [];
            const preferredThumb =
              thumbs.find((t) => t.quality === 'medium') || thumbs[0] || null;
            return {
              videoId: item.videoId,
              title: item.title || 'فيديو يوتيوب',
              channelTitle: item.author || 'YouTube',
              thumbnailUrl:
                (preferredThumb && preferredThumb.url) ||
                `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
              durationText: formatDurationSeconds(item.lengthSeconds),
            };
          });

        if (normalized.length > 0) {
          return normalized;
        }
      } catch (_) {
        // الانتقال تلقائياً إلى الخادم البديل
      }
    }

    if (Platform.OS === 'web') {
      return [
        {
          videoId: 'dQw4w9WgXcQ',
          title: `${cleanQuery} — عرض تجريبي للمعاينة (YouTube Cast)`,
          channelTitle: 'معاينة الريموت الشامل',
          thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
          durationText: '3:33',
        },
        {
          videoId: 'aqz-KE-bpKQ',
          title: `Big Buck Bunny 4K · ${cleanQuery}`,
          channelTitle: 'Blender Foundation',
          thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg',
          durationText: '9:56',
        },
      ];
    }

    throw new Error('تعذر جلب نتائج البحث حالياً. تحقق من اتصال الإنترنت وأعد المحاولة.');
  }
}

export const WifiControl = new WifiControlService();
export default WifiControl;
