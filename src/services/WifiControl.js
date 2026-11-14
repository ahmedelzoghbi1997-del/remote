const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY';

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
];

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

class WifiControlService {
  constructor() {
    this.protocol = 'samsung_tizen'; // 'samsung_tizen' | 'android_tv' | 'roku'
    this.ipAddress = '192.168.1.50';
    this.port = 8001;
    this.dialPort = 8080;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.commandQueue = [];
    this.listeners = new Set();
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
    };
  }

  _notify() {
    const status = this.getStatus();
    this.listeners.forEach((cb) => cb(status));
  }

  _defaultPortForProtocol(protocol) {
    if (protocol === 'roku') return 8060;
    if (protocol === 'samsung_tizen') return 8001;
    return 8080;
  }

  _defaultDialPortForProtocol(protocol) {
    if (protocol === 'roku') return 8060;
    if (protocol === 'samsung_tizen') return 8080;
    return 8008;
  }

  configure({ protocol, ipAddress, port, dialPort }) {
    const nextProtocol = protocol || this.protocol;
    const nextIp = (ipAddress || this.ipAddress).trim();
    const nextPort = Number(port) || this._defaultPortForProtocol(nextProtocol);
    const nextDialPort = Number(dialPort) || this._defaultDialPortForProtocol(nextProtocol);

    const changed =
      nextProtocol !== this.protocol ||
      nextIp !== this.ipAddress ||
      nextPort !== this.port ||
      nextDialPort !== this.dialPort;

    this.protocol = nextProtocol;
    this.ipAddress = nextIp;
    this.port = nextPort;
    this.dialPort = nextDialPort;

    if (changed) {
      this.disconnect();
    }
    this._notify();
  }

  async connect() {
    if (this.protocol === 'roku') {
      return this._verifyRokuRest();
    }
    return this._connectTvSocket();
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
      this._notify();
      return { connected: true, protocol: 'roku' };
    } catch (error) {
      this.isConnected = false;
      this._notify();
      throw new Error(`تعذر الاتصال بشاشة Roku على ${this.ipAddress}:${this.port}`);
    } finally {
      clearTimeout(timer);
    }
  }

  _buildWebSocketUrl() {
    if (this.protocol === 'samsung_tizen') {
      return `ws://${this.ipAddress}:${this.port}/api/v2/channels/samsung.remote.control?name=VW5pdmVyc2FsUmVtb3Rl`;
    }
    return `ws://${this.ipAddress}:${this.port}/remote`;
  }

  _connectTvSocket() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.isConnected = true;
        this._notify();
        resolve({ connected: true, protocol: this.protocol });
        return;
      }

      const wsUrl = this._buildWebSocketUrl();
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      const timeoutId = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          socket.close();
          reject(new Error(`انتهت مهلة اتصال WebSocket على ${wsUrl}`));
        }
      }, 4500);

      socket.onopen = () => {
        clearTimeout(timeoutId);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this._notify();
        this._flushQueue();
        resolve({ connected: true, protocol: this.protocol });
      };

      socket.onclose = () => {
        clearTimeout(timeoutId);
        this.isConnected = false;
        this._notify();
        this._scheduleReconnect();
      };

      socket.onerror = () => {
        clearTimeout(timeoutId);
        this.isConnected = false;
        this._notify();
        reject(new Error(`فشل اتصال WebSocket مع الشاشة (${this.ipAddress}:${this.port})`));
      };
    });
  }

  _scheduleReconnect() {
    if (this.protocol === 'roku') return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts += 1;
    const delayMs = Math.min(8000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    setTimeout(() => {
      if (!this.isConnected && this.protocol !== 'roku') {
        this._connectTvSocket().catch(() => {});
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
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.commandQueue = [];
    this._notify();
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
      await this._connectTvSocket();
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

    let lastError = null;
    for (const url of candidateUrls) {
      try {
        const res = await this._postWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
        if (res.ok || res.status === 201 || res.status === 204) {
          return { launched: true, endpoint: url };
        }
        lastError = new Error(`استجابة الشاشة: HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
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

    throw new Error('تعذر جلب نتائج البحث حالياً. تحقق من اتصال الإنترنت وأعد المحاولة.');
  }
}

export const WifiControl = new WifiControlService();
export default WifiControl;
