const WIFI_KEY_MAP = {
  POWER: { roku: 'Power', androidTv: 'KEYCODE_POWER' },
  VOL_UP: { roku: 'VolumeUp', androidTv: 'KEYCODE_VOLUME_UP' },
  VOL_DOWN: { roku: 'VolumeDown', androidTv: 'KEYCODE_VOLUME_DOWN' },
  MUTE: { roku: 'VolumeMute', androidTv: 'KEYCODE_VOLUME_MUTE' },
  CH_UP: { roku: 'ChannelUp', androidTv: 'KEYCODE_CHANNEL_UP' },
  CH_DOWN: { roku: 'ChannelDown', androidTv: 'KEYCODE_CHANNEL_DOWN' },
  UP: { roku: 'Up', androidTv: 'KEYCODE_DPAD_UP' },
  DOWN: { roku: 'Down', androidTv: 'KEYCODE_DPAD_DOWN' },
  LEFT: { roku: 'Left', androidTv: 'KEYCODE_DPAD_LEFT' },
  RIGHT: { roku: 'Right', androidTv: 'KEYCODE_DPAD_RIGHT' },
  OK: { roku: 'Select', androidTv: 'KEYCODE_DPAD_CENTER' },
  BACK: { roku: 'Back', androidTv: 'KEYCODE_BACK' },
  HOME: { roku: 'Home', androidTv: 'KEYCODE_HOME' },
  MENU: { roku: 'Info', androidTv: 'KEYCODE_MENU' },
  INPUT: { roku: 'InputHDMI1', androidTv: 'KEYCODE_TV_INPUT' },
};

class WifiControlService {
  constructor() {
    this.protocol = 'android_tv';
    this.ipAddress = '192.168.1.50';
    this.port = 8080;
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
    };
  }

  _notify() {
    const status = this.getStatus();
    this.listeners.forEach((cb) => cb(status));
  }

  configure({ protocol, ipAddress, port }) {
    const nextProtocol = protocol || this.protocol;
    const nextIp = (ipAddress || this.ipAddress).trim();
    const nextPort = Number(port) || (nextProtocol === 'roku' ? 8060 : 8080);

    const changed =
      nextProtocol !== this.protocol ||
      nextIp !== this.ipAddress ||
      nextPort !== this.port;

    this.protocol = nextProtocol;
    this.ipAddress = nextIp;
    this.port = nextPort;

    if (changed) {
      this.disconnect();
    }
    this._notify();
  }

  async connect() {
    if (this.protocol === 'roku') {
      return this._verifyRokuRest();
    }
    return this._connectAndroidTvSocket();
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
      throw new Error(
        `تعذر الاتصال بشاشة Roku على ${this.ipAddress}:${this.port}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  _connectAndroidTvSocket() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.isConnected = true;
        this._notify();
        resolve({ connected: true, protocol: 'android_tv' });
        return;
      }

      const wsUrl = `ws://${this.ipAddress}:${this.port}/remote`;
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
        resolve({ connected: true, protocol: 'android_tv' });
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
        reject(new Error(`فشل اتصال WebSocket مع الشاشة (${this.ipAddress})`));
      };
    });
  }

  _scheduleReconnect() {
    if (this.protocol !== 'android_tv') return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts += 1;
    const delayMs = Math.min(8000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    setTimeout(() => {
      if (!this.isConnected && this.protocol === 'android_tv') {
        this._connectAndroidTvSocket().catch(() => {});
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

    const payload = {
      type: 'KEY_EVENT',
      keyCode: mapped.androidTv,
      action: 'CLICK',
      timestamp: Date.now(),
    };

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.commandQueue.push(payload);
      await this._connectAndroidTvSocket();
    } else {
      this.ws.send(JSON.stringify(payload));
    }

    return { sent: true, protocol: 'android_tv', payload };
  }
}

export const WifiControl = new WifiControlService();
export default WifiControl;
