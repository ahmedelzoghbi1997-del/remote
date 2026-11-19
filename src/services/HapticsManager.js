import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_HAPTICS_KEY = '@universal_remote_haptics_settings';
const MIN_REPEAT_COOLDOWN_MS = 55;
const DEFAULT_HOLD_INITIAL_DELAY_MS = 280;
const DEFAULT_HOLD_INTERVAL_MS = 65;

const HapticsNative =
  NativeModules && NativeModules.HapticsModule ? NativeModules.HapticsModule : null;

export const HAPTIC_PATTERNS = {
  NAV_TAP: 'NAV_TAP',
  NAV_REPEAT: 'NAV_REPEAT',
  OK_CONFIRM: 'OK_CONFIRM',
  POWER_ALERT: 'POWER_ALERT',
  POWER_TV: 'POWER_TV',
  AC_TEMP_UP: 'AC_TEMP_UP',
  AC_TEMP_DOWN: 'AC_TEMP_DOWN',
  AC_LIMIT_HIT: 'AC_LIMIT_HIT',
  AC_MODE_STEP: 'AC_MODE_STEP',
  AC_POWER_ON: 'AC_POWER_ON',
  AC_POWER_OFF: 'AC_POWER_OFF',
};

export const HAPTIC_INTENSITY_LEVELS = ['light', 'medium', 'strong'];

function getStorageAdapter() {
  if (Platform.OS === 'web') {
    return {
      getItem: async (key) => {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage.getItem(key);
          }
        } catch (_) {
          // ignore
        }
        return null;
      },
      setItem: async (key, value) => {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(key, value);
          }
        } catch (_) {
          // ignore
        }
      },
    };
  }
  return AsyncStorage;
}

class HapticsManager {
  constructor() {
    this.enabled = true;
    this.intensity = 'medium';
    this.lastRepeatTickAt = 0;
    this.holdDelayTimer = null;
    this.repeatTimer = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return this.getConfig();
    }
    this.initialized = true;
    try {
      const storage = getStorageAdapter();
      const raw = await storage.getItem(STORAGE_HAPTICS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.enabled === 'boolean') {
          this.enabled = parsed.enabled;
        }
        if (HAPTIC_INTENSITY_LEVELS.includes(parsed.intensity)) {
          this.intensity = parsed.intensity;
        }
      }
    } catch (_) {
      // keep defaults
    }

    if (
      Platform.OS === 'android' &&
      HapticsNative &&
      typeof HapticsNative.setIntensity === 'function'
    ) {
      try {
        HapticsNative.setIntensity(this.intensity);
      } catch (_) {
        // ignore
      }
    }

    return this.getConfig();
  }

  getConfig() {
    return {
      enabled: this.enabled,
      intensity: this.intensity,
    };
  }

  async setConfig({ enabled, intensity }) {
    if (typeof enabled === 'boolean') {
      this.enabled = enabled;
    }
    if (intensity && HAPTIC_INTENSITY_LEVELS.includes(intensity)) {
      this.intensity = intensity;
      if (
        Platform.OS === 'android' &&
        HapticsNative &&
        typeof HapticsNative.setIntensity === 'function'
      ) {
        try {
          HapticsNative.setIntensity(this.intensity);
        } catch (_) {
          // ignore
        }
      }
    }

    if (!this.enabled) {
      this.stopHoldFeedback();
    }

    try {
      const storage = getStorageAdapter();
      await storage.setItem(
        STORAGE_HAPTICS_KEY,
        JSON.stringify({
          enabled: this.enabled,
          intensity: this.intensity,
        })
      );
    } catch (_) {
      // ignore persistence failures
    }

    return this.getConfig();
  }

  trigger(patternKey) {
    if (!this.enabled || !patternKey) {
      return;
    }
    if (patternKey === HAPTIC_PATTERNS.NAV_REPEAT) {
      const now = Date.now();
      if (now - this.lastRepeatTickAt < MIN_REPEAT_COOLDOWN_MS) {
        return;
      }
      this.lastRepeatTickAt = now;
    }
    if (
      Platform.OS !== 'android' ||
      !HapticsNative ||
      typeof HapticsNative.trigger !== 'function'
    ) {
      return;
    }
    try {
      HapticsNative.trigger(patternKey);
    } catch (_) {
      // ignore native vibrator failures
    }
  }

  startHoldFeedback(
    initialDelayMs = DEFAULT_HOLD_INITIAL_DELAY_MS,
    intervalMs = DEFAULT_HOLD_INTERVAL_MS
  ) {
    this.stopHoldFeedback();
    if (!this.enabled || Platform.OS !== 'android' || !HapticsNative) {
      return;
    }
    const safeInitialDelay = Math.max(0, Number(initialDelayMs) || 0);
    const safeInterval = Math.max(MIN_REPEAT_COOLDOWN_MS, Number(intervalMs) || 65);

    const startLoop = () => {
      this.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
      this.repeatTimer = setInterval(() => {
        this.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
      }, safeInterval);
    };

    if (safeInitialDelay === 0) {
      startLoop();
      return;
    }

    this.holdDelayTimer = setTimeout(() => {
      this.holdDelayTimer = null;
      startLoop();
    }, safeInitialDelay);
  }

  stopHoldFeedback() {
    if (this.holdDelayTimer) {
      clearTimeout(this.holdDelayTimer);
      this.holdDelayTimer = null;
    }
    if (this.repeatTimer) {
      clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
    if (
      Platform.OS === 'android' &&
      HapticsNative &&
      typeof HapticsNative.cancel === 'function'
    ) {
      try {
        HapticsNative.cancel();
      } catch (_) {
        // ignore
      }
    }
  }
}

export default new HapticsManager();
