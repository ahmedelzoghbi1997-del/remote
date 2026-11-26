import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  I18nManager,
  Image,
  Modal,
  NativeModules,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import WifiControl, { parseSmartSearchInput } from './src/services/WifiControl';
import HapticsManager, { HAPTIC_PATTERNS } from './src/services/HapticsManager';
import VoiceControl from './src/services/VoiceControl';
import { parseEgyptianVoiceCommand } from './src/services/VoiceCommandParser';
import {
  encodeMideaAcPattern,
  MIDEA_MAX_TEMP,
  MIDEA_MIN_TEMP,
} from './src/protocols/mideaAc';
import CastProxyService, {
  guessMimeTypeFromUrl,
  inferMovieTitleFromUrl,
  isLikelyDirectVideoUrl,
} from './src/services/CastProxyService';
import CinemaStorageService, {
  DEFAULT_SUBTITLE_STYLE,
  formatSecondsHms,
} from './src/services/CinemaStorageService';
import CinemaControlModal from './src/components/CinemaControlModal';

const IrManagerModule = NativeModules ? NativeModules.IrManagerModule : null;

if (Platform.OS !== 'web' && I18nManager && !I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

const CARRIER_38KHZ = 38000;

function pushByteLsbFirst(pattern, byteValue) {
  const b = byteValue & 0xff;
  for (let bit = 0; bit < 8; bit++) {
    const isOne = ((b >>> bit) & 1) === 1;
    pattern.push(560);
    pattern.push(isOne ? 1690 : 560);
  }
}

function encodeSamsungDual0707(
  commandHex,
  addressHigh = 0x07,
  addressLow = 0x07,
  repeatCount = 3
) {
  const cmd = commandHex & 0xff;
  const cmdInv = ~cmd & 0xff;
  const totalFrames = Math.max(1, Math.min(4, Number(repeatCount) || 3));
  const pattern = [];
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx += 1) {
    if (frameIdx > 0) {
      // فاصل زمني قياسي (46ms) لمعايرة AGC وضمان التقاط الإطار التالي عند الزوايا المائلة
      pattern.push(46000);
    }
    pattern.push(4500, 4500);
    pushByteLsbFirst(pattern, addressHigh);
    pushByteLsbFirst(pattern, addressLow);
    pushByteLsbFirst(pattern, cmd);
    pushByteLsbFirst(pattern, cmdInv);
    pattern.push(560);
  }
  return pattern;
}

function encodeNecToMicroseconds(addressHex, commandHex) {
  const addr = addressHex & 0xff;
  const addrInv = ~addr & 0xff;
  const cmd = commandHex & 0xff;
  const cmdInv = ~cmd & 0xff;

  const pattern = [9000, 4500];
  pushByteLsbFirst(pattern, addr);
  pushByteLsbFirst(pattern, addrInv);
  pushByteLsbFirst(pattern, cmd);
  pushByteLsbFirst(pattern, cmdInv);
  pattern.push(560);
  return pattern;
}

const TV_IR_BRANDS = {
  samsung: {
    label: 'Samsung (0x0707)',
    protocol: 'samsung_dual',
    addressHigh: 0x07,
    addressLow: 0x07,
    commands: {
      POWER: 0x02,
      VOL_UP: 0x07,
      VOL_DOWN: 0x0b,
      MUTE: 0x0f,
      CH_UP: 0x12,
      CH_DOWN: 0x10,
      UP: 0x60,
      DOWN: 0x61,
      LEFT: 0x65,
      RIGHT: 0x62,
      OK: 0x68,
      BACK: 0x58,
      HOME: 0x79,
      MENU: 0x1a,
      INPUT: 0x01,
      PLAY: 0x47,
      PAUSE: 0x4a,
      YOUTUBE: 0x7c,
      NETFLIX: 0x34,
    },
  },
  lg: {
    label: 'LG TV (NEC)',
    protocol: 'nec',
    address: 0x04,
    commands: {
      POWER: 0x08,
      VOL_UP: 0x02,
      VOL_DOWN: 0x03,
      MUTE: 0x09,
      CH_UP: 0x00,
      CH_DOWN: 0x01,
      UP: 0x40,
      DOWN: 0x41,
      LEFT: 0x07,
      RIGHT: 0x06,
      OK: 0x44,
      BACK: 0x28,
      HOME: 0x7c,
      MENU: 0x43,
      INPUT: 0x0b,
      PLAY: 0xb0,
      PAUSE: 0xba,
    },
  },
};

function buildAcIrPattern(brandKey, acState, options = {}) {
  if (brandKey === 'midea') {
    return encodeMideaAcPattern(acState, options);
  }

  const brandAddress = brandKey === 'carrier' ? 0x4d : 0x58;
  const modeMap = { cool: 1, dry: 2, fan: 3, heat: 4, auto: 0 };
  const fanMap = { auto: 0, low: 1, medium: 2, high: 3 };
  const clampedTemp = Math.max(16, Math.min(30, acState.temperature));
  const tempOffset = clampedTemp - 16;

  const modeCode = modeMap[acState.mode] !== undefined ? modeMap[acState.mode] : 1;
  const fanCode = fanMap[acState.fanSpeed] !== undefined ? fanMap[acState.fanSpeed] : 0;

  const stateByte =
    ((acState.power ? 1 : 0) << 7) |
    (modeCode << 4) |
    (fanCode << 2) |
    (acState.swing ? 0x02 : 0x00);

  return [
    ...encodeNecToMicroseconds(brandAddress, stateByte),
    20000,
    ...encodeNecToMicroseconds(brandAddress ^ 0x0f, tempOffset),
  ];
}

const AC_MODES = [
  { key: 'cool', label: 'تبريد' },
  { key: 'heat', label: 'تدفئة' },
  { key: 'dry', label: 'تجفيف' },
  { key: 'fan', label: 'مروحة' },
  { key: 'auto', label: 'تلقائي' },
];

const FAN_SPEEDS = [
  { key: 'auto', label: 'تلقائي' },
  { key: 'low', label: 'منخفض' },
  { key: 'medium', label: 'متوسط' },
  { key: 'high', label: 'عالي' },
];

const SEARCH_FILTER_OPTIONS = [
  { key: 'all', label: 'الكل' },
  { key: 'no_shorts', label: 'بدون Shorts' },
  { key: 'long', label: 'طويلة (+20 د)' },
  { key: 'live', label: 'بث مباشر (Live)' },
  { key: 'latest', label: 'الأحدث' },
];

const DEFAULT_PAGINATION_STATE = {
  nextPageToken: null,
  nextPage: 2,
  hasMore: false,
  providerType: null,
  instanceUrl: null,
};

function filterSearchResults(items, filterKey) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (filterKey === 'no_shorts') {
    return items.filter((item) => {
      if (!item) return false;
      const isShortByFlag = Boolean(item.isShort);
      const isShortByDuration =
        !item.isLive && Number(item.durationSeconds) > 0 && Number(item.durationSeconds) <= 60;
      const isShortByText =
        /#shorts?\b/i.test(String(item.title || '')) ||
        /\/shorts\//i.test(String(item.url || ''));
      return !isShortByFlag && !isShortByDuration && !isShortByText;
    });
  }
  if (filterKey === 'long') {
    return items.filter(
      (item) => item && !item.isLive && Number(item.durationSeconds) > 1200
    );
  }
  if (filterKey === 'live') {
    return items.filter(
      (item) => item && (Boolean(item.isLive) || item.durationText === 'بث مباشر')
    );
  }
  return items;
}

function mergeUniqueVideos(existingList, incomingList) {
  const seen = new Set(
    (Array.isArray(existingList) ? existingList : [])
      .map((item) => item && item.videoId)
      .filter(Boolean)
  );
  const merged = Array.isArray(existingList) ? [...existingList] : [];
  for (const item of Array.isArray(incomingList) ? incomingList : []) {
    if (!item || !item.videoId || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    merged.push(item);
  }
  return merged;
}

function getSubnetFromIp(ip) {
  const parts = String(ip || '')
    .trim()
    .split('.');
  if (parts.length >= 3 && parts.slice(0, 3).every((p) => /^\d{1,3}$/.test(p))) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return '192.168.1';
}

function RepeatableButton({
  onAction,
  onActiveChange,
  onHoldStart,
  onHoldEnd,
  minRepeatCycleMs = 90,
  initialDelayMs = 150,
  style,
  activeOpacity = 0.7,
  hitSlop,
  children,
}) {
  const holdTimerRef = useRef(null);
  const waitResolveRef = useRef(null);
  const holdingRef = useRef(false);
  const nativeHoldActiveRef = useRef(false);
  const sessionRef = useRef(0);
  const firstActionPromiseRef = useRef(null);
  const latestActionRef = useRef(onAction);
  const latestActiveChangeRef = useRef(onActiveChange);
  const latestHoldStartRef = useRef(onHoldStart);
  const latestHoldEndRef = useRef(onHoldEnd);

  latestActionRef.current = onAction;
  latestActiveChangeRef.current = onActiveChange;
  latestHoldStartRef.current = onHoldStart;
  latestHoldEndRef.current = onHoldEnd;

  const stopRepeating = () => {
    holdingRef.current = false;
    sessionRef.current += 1;
    HapticsManager.stopHoldFeedback();
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (waitResolveRef.current) {
      const resolveWait = waitResolveRef.current;
      waitResolveRef.current = null;
      resolveWait();
    }
    if (nativeHoldActiveRef.current) {
      nativeHoldActiveRef.current = false;
      if (latestHoldEndRef.current) {
        latestHoldEndRef.current();
      }
    }
    if (latestActiveChangeRef.current) {
      latestActiveChangeRef.current(false);
    }
  };

  useEffect(() => {
    return () => stopRepeating();
  }, []);

  const handlePressIn = () => {
    stopRepeating();
    holdingRef.current = true;
    const sessionId = sessionRef.current;

    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);

    if (latestActiveChangeRef.current) {
      latestActiveChangeRef.current(true);
    }
    if (latestActionRef.current) {
      firstActionPromiseRef.current = Promise.resolve(
        latestActionRef.current({ isRepeat: false })
      ).catch(() => {});
    }

    holdTimerRef.current = setTimeout(async () => {
      if (firstActionPromiseRef.current) {
        await firstActionPromiseRef.current;
      }
      if (!holdingRef.current || sessionRef.current !== sessionId) {
        return;
      }
      if (latestHoldStartRef.current && latestHoldStartRef.current() === true) {
        nativeHoldActiveRef.current = true;
        HapticsManager.startHoldFeedback(Math.max(0, 280 - initialDelayMs), 65);
        return;
      }
      while (holdingRef.current && sessionRef.current === sessionId) {
        const startedAt = Date.now();
        HapticsManager.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
        if (latestActionRef.current) {
          await Promise.resolve(
            latestActionRef.current({ isRepeat: true })
          ).catch(() => {});
        }
        if (!holdingRef.current || sessionRef.current !== sessionId) {
          break;
        }
        const elapsed = Date.now() - startedAt;
        const waitMs = Math.max(15, minRepeatCycleMs - elapsed);
        await new Promise((resolve) => {
          waitResolveRef.current = resolve;
          holdTimerRef.current = setTimeout(() => {
            waitResolveRef.current = null;
            resolve();
          }, waitMs);
        });
      }
    }, initialDelayMs);
  };

  return (
    <TouchableOpacity
      style={style}
      activeOpacity={activeOpacity}
      hitSlop={hitSlop}
      onPressIn={handlePressIn}
      onPressOut={stopRepeating}
    >
      {children}
    </TouchableOpacity>
  );
}

function SearchIcon({ color = '#F1F5F9', size = 20 }) {
  const scale = size / 20;
  const ringSize = Math.round(12 * scale);
  const stroke = Math.max(2, Math.round(2 * scale));
  const handleLength = Math.round(7 * scale);
  const ringOffset = -2 * scale;
  const handleOffset = 4.2 * scale;

  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: stroke,
          borderColor: color,
          transform: [{ translateX: ringOffset }, { translateY: ringOffset }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: handleLength,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
          transform: [
            { translateX: handleOffset },
            { translateY: handleOffset },
            { rotate: '45deg' },
          ],
        }}
      />
    </View>
  );
}

function HapticsIcon({ color = '#F1F5F9', size = 18 }) {
  const barW = Math.max(2, Math.round(size * 0.14));
  const barGap = Math.max(2, Math.round(size * 0.14));
  return (
    <View
      style={{
        width: size,
        height: size,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: barGap,
      }}
    >
      <View
        style={{
          width: barW,
          height: Math.round(size * 0.44),
          borderRadius: barW / 2,
          backgroundColor: color,
          opacity: 0.72,
        }}
      />
      <View
        style={{
          width: barW,
          height: Math.round(size * 0.84),
          borderRadius: barW / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: barW,
          height: Math.round(size * 0.56),
          borderRadius: barW / 2,
          backgroundColor: color,
          opacity: 0.85,
        }}
      />
    </View>
  );
}

function MicIcon({ color = '#F1F5F9', size = 18 }) {
  const s = size / 18;
  const capsuleW = Math.max(6, Math.round(7 * s));
  const capsuleH = Math.max(9, Math.round(10 * s));
  const cupW = Math.max(10, Math.round(12 * s));
  const cupH = Math.max(6, Math.round(7 * s));
  const stroke = Math.max(1.5, Math.round(1.8 * s));

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: capsuleW,
          height: capsuleH,
          borderRadius: capsuleW / 2,
          backgroundColor: color,
          marginBottom: -Math.round(4 * s),
        }}
      />
      <View
        style={{
          width: cupW,
          height: cupH,
          borderBottomLeftRadius: cupW / 2,
          borderBottomRightRadius: cupW / 2,
          borderLeftWidth: stroke,
          borderRightWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
        }}
      />
      <View
        style={{
          width: stroke,
          height: Math.max(2, Math.round(2.5 * s)),
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: Math.max(6, Math.round(7 * s)),
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function CinemaIcon({ color = '#F1F5F9', size = 18 }) {
  const s = size / 18;
  const frameW = Math.round(16 * s);
  const frameH = Math.round(13 * s);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: frameW,
          height: frameH,
          borderRadius: Math.round(3 * s),
          borderWidth: Math.max(1.5, Math.round(1.6 * s)),
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: Math.round(3.2 * s),
            borderBottomWidth: Math.round(3.2 * s),
            borderLeftWidth: Math.round(5.2 * s),
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: color,
            marginLeft: Math.round(1 * s),
          }}
        />
      </View>
    </View>
  );
}

const DPAD_WEDGE_ROTATION = {
  UP: '0deg',
  RIGHT: '90deg',
  DOWN: '180deg',
  LEFT: '270deg',
};

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeTvLayoutMetrics(areaWidth, areaHeight) {
  const w = Math.max(300, Number(areaWidth) || 390);
  const h = Math.max(340, Number(areaHeight) || 580);
  const t = clampValue((h - 420) / (680 - 420), 0, 1);
  const wt = clampValue((w - 340) / (420 - 340), 0, 1);

  const hPad = Math.round(12 + wt * 6);
  const vPad = Math.round(5 + t * 8);
  const stackGap = Math.round(5 + t * 8);
  const rowGap = Math.round(8 + wt * 4);

  const segmentBtnH = Math.round(34 + t * 10);
  const segmentBoxH = segmentBtnH + 6;
  const powerBtnH = Math.round(42 + t * 12);
  const navBtnH = Math.round(40 + t * 12);
  const rockerKeyH = Math.round(36 + t * 22);
  const rockerPad = Math.round(5 + t * 3);
  const rockerGap = Math.round(4 + t * 3);
  const rockerCardH = rockerKeyH * 2 + 18 + rockerPad * 2 + rockerGap * 2;
  const streamingBtnH = Math.round(46 + t * 6);

  const usedWithoutDpad =
    segmentBoxH +
    powerBtnH +
    navBtnH +
    rockerCardH +
    stackGap * 4 +
    vPad * 2;

  const maxDpadByHeight = h - usedWithoutDpad;
  const maxDpadByWidth = w - hPad * 2 - 42;
  const maxDpadCap = Math.round(280 + wt * 14);
  const needsScroll = maxDpadByHeight < 168;
  const rawDpad = needsScroll
    ? Math.min(204, maxDpadByWidth)
    : Math.max(168, Math.min(maxDpadByHeight, maxDpadByWidth, maxDpadCap));
  const dpadSize = Math.max(168, Math.floor(rawDpad) - (Math.floor(rawDpad) % 2));
  const dpadCenterOffset = (dpadSize - 2) / 2;
  const dpadWedgeBorder = Math.floor((dpadSize - 2) / 2);
  const dpadOkSize = Math.round(dpadSize * 0.37);
  const ringThickness = (dpadSize - dpadOkSize) / 2;
  const dpadDotPad = Math.max(18, Math.round(ringThickness * 0.42));
  const dpadDotSize = dpadSize >= 250 ? 9 : 8;

  const btnFontSize = Math.round(13 + t * 1.5);
  const btnBoldFontSize = Math.round(14 + t * 1.5);
  const segmentFontSize = Math.round(12 + wt * 2);
  const dpadOkFontSize = Math.round(15 + t * 2);
  const rockerSymbolSize = Math.round(20 + t * 4);
  const rockerLabelSize = Math.round(12 + t * 1.5);

  return {
    hPad,
    vPad,
    stackGap,
    rowGap,
    segmentBtnH,
    powerBtnH,
    navBtnH,
    rockerKeyH,
    rockerPad,
    rockerGap,
    streamingBtnH,
    dpadSize,
    dpadCenterOffset,
    dpadWedgeBorder,
    dpadOkSize,
    dpadDotPad,
    dpadDotSize,
    needsScroll,
    btnFontSize,
    btnBoldFontSize,
    segmentFontSize,
    dpadOkFontSize,
    rockerSymbolSize,
    rockerLabelSize,
  };
}

function computeAcLayoutMetrics(areaWidth, areaHeight) {
  const w = Math.max(300, Number(areaWidth) || 390);
  const h = Math.max(360, Number(areaHeight) || 580);
  const t = clampValue((h - 460) / (710 - 460), 0, 1);
  const wt = clampValue((w - 340) / (420 - 340), 0, 1);

  return {
    hPad: Math.round(12 + wt * 6),
    vPad: Math.round(8 + t * 8),
    gap: Math.round(8 + t * 6),
    rowGap: Math.round(8 + wt * 4),
    brandH: Math.round(38 + t * 6),
    lcdPadV: Math.round(10 + t * 8),
    tempFontSize: Math.round(40 + t * 10),
    stepBtnH: Math.round(48 + t * 8),
    modeH: Math.round(42 + t * 6),
    extraH: Math.round(52 + t * 8),
    featureH: Math.round(52 + t * 8),
    timerH: Math.round(52 + t * 8),
    needsScroll: h < 535,
  };
}

function resolveDpadDirectionFromPoint(locationX, locationY, centerOffset = 113) {
  const dx = (Number(locationX) || 0) - centerOffset;
  const dy = (Number(locationY) || 0) - centerOffset;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy < 0 ? 'UP' : 'DOWN';
  }
  return dx < 0 ? 'LEFT' : 'RIGHT';
}

function DpadRingControl({
  style,
  centerOffset = 113,
  minRepeatCycleMs = 95,
  initialDelayMs = 150,
  onActiveChange,
  onDirectionAction,
  onHoldStart,
  onHoldEnd,
}) {
  const holdTimerRef = useRef(null);
  const waitResolveRef = useRef(null);
  const holdingRef = useRef(false);
  const nativeHoldDirRef = useRef(null);
  const sessionRef = useRef(0);
  const firstActionPromiseRef = useRef(null);
  const latestActionRef = useRef(onDirectionAction);
  const latestActiveChangeRef = useRef(onActiveChange);
  const latestHoldStartRef = useRef(onHoldStart);
  const latestHoldEndRef = useRef(onHoldEnd);
  const latestCenterOffsetRef = useRef(centerOffset);

  latestActionRef.current = onDirectionAction;
  latestActiveChangeRef.current = onActiveChange;
  latestHoldStartRef.current = onHoldStart;
  latestHoldEndRef.current = onHoldEnd;
  latestCenterOffsetRef.current = centerOffset;

  const stopRepeating = () => {
    holdingRef.current = false;
    sessionRef.current += 1;
    HapticsManager.stopHoldFeedback();
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (waitResolveRef.current) {
      const resolveWait = waitResolveRef.current;
      waitResolveRef.current = null;
      resolveWait();
    }
    if (nativeHoldDirRef.current) {
      const heldDir = nativeHoldDirRef.current;
      nativeHoldDirRef.current = null;
      if (latestHoldEndRef.current) {
        latestHoldEndRef.current(heldDir);
      }
    }
    if (latestActiveChangeRef.current) {
      latestActiveChangeRef.current(null);
    }
  };

  useEffect(() => {
    return () => stopRepeating();
  }, []);

  const handleGrant = (event) => {
    stopRepeating();
    const nativeEvt = event && event.nativeEvent ? event.nativeEvent : {};
    const dir = resolveDpadDirectionFromPoint(
      nativeEvt.locationX,
      nativeEvt.locationY,
      latestCenterOffsetRef.current
    );
    holdingRef.current = true;
    const sessionId = sessionRef.current;

    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);

    if (latestActiveChangeRef.current) {
      latestActiveChangeRef.current(dir);
    }
    if (latestActionRef.current) {
      firstActionPromiseRef.current = Promise.resolve(
        latestActionRef.current(dir, { isRepeat: false })
      ).catch(() => {});
    }

    holdTimerRef.current = setTimeout(async () => {
      if (firstActionPromiseRef.current) {
        await firstActionPromiseRef.current;
      }
      if (!holdingRef.current || sessionRef.current !== sessionId) {
        return;
      }
      if (latestHoldStartRef.current && latestHoldStartRef.current(dir) === true) {
        nativeHoldDirRef.current = dir;
        HapticsManager.startHoldFeedback(Math.max(0, 280 - initialDelayMs), 65);
        return;
      }
      while (holdingRef.current && sessionRef.current === sessionId) {
        const startedAt = Date.now();
        HapticsManager.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
        if (latestActionRef.current) {
          await Promise.resolve(
            latestActionRef.current(dir, { isRepeat: true })
          ).catch(() => {});
        }
        if (!holdingRef.current || sessionRef.current !== sessionId) {
          break;
        }
        const elapsed = Date.now() - startedAt;
        const waitMs = Math.max(15, minRepeatCycleMs - elapsed);
        await new Promise((resolve) => {
          waitResolveRef.current = resolve;
          holdTimerRef.current = setTimeout(() => {
            waitResolveRef.current = null;
            resolve();
          }, waitMs);
        });
      }
    }, initialDelayMs);
  };

  return (
    <View
      style={style}
      pointerEvents="box-only"
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={handleGrant}
      onResponderRelease={stopRepeating}
      onResponderTerminate={stopRepeating}
    />
  );
}

function App() {
  const windowDims = useWindowDimensions();
  const fallbackScreenW =
    Platform.OS === 'web' ? Math.min(windowDims.width || 394, 400) : windowDims.width || 390;
  const fallbackScreenH =
    Platform.OS === 'web' ? Math.min(windowDims.height || 780, 780) : windowDims.height || 780;

  const [activeTab, setActiveTab] = useState('tv');
  const [hasIrHardware, setHasIrHardware] = useState(null);
  const [feedback, setFeedback] = useState({
    text: '',
    tone: 'neutral',
  });

  // حالة ريموت الشاشة والواي فاي والاقتران التلقائي
  const [tvTransport, setTvTransport] = useState('ir');
  const tvBrand = 'samsung';
  const [tvAreaSize, setTvAreaSize] = useState(() => ({
    width: fallbackScreenW,
    height: Math.max(400, fallbackScreenH - 180),
  }));
  const [acAreaSize, setAcAreaSize] = useState(() => ({
    width: fallbackScreenW,
    height: Math.max(420, fallbackScreenH - 130),
  }));
  const [wifiProtocol, setWifiProtocol] = useState('samsung_tizen');
  const [tvIp, setTvIp] = useState('192.168.1.50');
  const [tvPort, setTvPort] = useState('8002');
  const [dialPort, setDialPort] = useState('8080');
  const [subnetPrefix, setSubnetPrefix] = useState('192.168.1');
  const [showWifiModal, setShowWifiModal] = useState(false);

  const [wifiStatus, setWifiStatus] = useState(WifiControl.getStatus());
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [scanProgress, setScanProgress] = useState({ scanned: 0, total: 254 });
  const [discoveredTvs, setDiscoveredTvs] = useState([]);
  const [hasScannedOnce, setHasScannedOnce] = useState(false);
  const [isConnectingWifi, setIsConnectingWifi] = useState(false);

  // حالة البحث والتشغيل المباشر ليوتيوب من أيقونة الهيدر
  const [isSearchInputOpen, setIsSearchInputOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState('all');
  const [searchResults, setSearchResults] = useState([]);
  const [searchPagination, setSearchPagination] = useState(DEFAULT_PAGINATION_STATE);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLaunchingYouTube, setIsLaunchingYouTube] = useState(false);
  const [isOpeningBrowserUrl, setIsOpeningBrowserUrl] = useState(false);
  const [castingVideoId, setCastingVideoId] = useState(null);
  const [lastCastedVideoId, setLastCastedVideoId] = useState(null);
  const [hasSearchedOnce, setHasSearchedOnce] = useState(false);
  const [searchHistory, setSearchHistory] = useState([]);
  const [favoriteVideos, setFavoriteVideos] = useState([]);
  const [networkNotice, setNetworkNotice] = useState(null);

  // حالة ريموت التكييف
  const [acBrand, setAcBrand] = useState('midea');
  const [acState, setAcState] = useState({
    power: true,
    temperature: 22,
    mode: 'cool',
    fanSpeed: 'auto',
    swing: true,
    turbo: false,
    led: true,
    clean: false,
    sleep: false,
  });
  const [acTimerConfig, setAcTimerConfig] = useState(null);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [draftTimerMinutes, setDraftTimerMinutes] = useState(60);
  const [draftTimerAction, setDraftTimerAction] = useState('off');

  const [activeDpadDir, setActiveDpadDir] = useState(null);
  const [hapticsConfig, setHapticsConfig] = useState(() => HapticsManager.getConfig());
  const [showHapticsModal, setShowHapticsModal] = useState(false);
  const [isPowerHolding, setIsPowerHolding] = useState(false);
  const [powerHintText, setPowerHintText] = useState('');

  // حالة الريموت الصوتي بالعامية المصرية ومؤقت نوم الشاشة
  const [voiceSession, setVoiceSession] = useState({
    phase: 'idle',
    transcript: '',
    partialTranscript: '',
    rmsLevel: 0,
    parsedCommand: null,
    videoCandidate: null,
    alternateResults: [],
    countdownRemainingMs: 0,
    countdownTotalMs: 0,
    statusMessage: '',
    errorMessage: '',
  });
  const [tvSleepTimer, setTvSleepTimer] = useState(null);

  // حالة البث الفوري بالبروكسي المحلي والترجمة العربية (المرحلة أ + ب)
  const [quickCastModalVisible, setQuickCastModalVisible] = useState(false);
  const [quickCastSourceUrl, setQuickCastSourceUrl] = useState('');
  const [quickCastTitle, setQuickCastTitle] = useState('');
  const [quickCastHeaders, setQuickCastHeaders] = useState({});
  const [quickCastMimeType, setQuickCastMimeType] = useState('video/mp4');
  const [quickCastSubtitleUri, setQuickCastSubtitleUri] = useState('');
  const [quickCastSubtitleName, setQuickCastSubtitleName] = useState('');
  const [quickCastSubtitleOffsetMs, setQuickCastSubtitleOffsetMs] = useState(0);
  const [quickCastTargetIp, setQuickCastTargetIp] = useState('');
  const [quickCastSession, setQuickCastSession] = useState(null);
  const [quickCastBusy, setQuickCastBusy] = useState(false);
  const [quickCastStatusText, setQuickCastStatusText] = useState('');
  const [quickCastErrorText, setQuickCastErrorText] = useState('');
  const [quickCastResumeMatch, setQuickCastResumeMatch] = useState(null);
  const [quickCastUseResume, setQuickCastUseResume] = useState(true);

  // حالة مشغّل السينما الذكي (Web Receiver /tv) وقائمة الحلقات ومتابعة المشاهدة
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);
  const [cinemaTab, setCinemaTab] = useState('control');
  const [cinemaSession, setCinemaSession] = useState(null);
  const [receiverState, setReceiverState] = useState(null);
  const [serverUrl, setServerUrl] = useState('');
  const [cinemaBusyAction, setCinemaBusyAction] = useState(false);
  const [cinemaNotice, setCinemaNotice] = useState('');
  const [subtitleStyle, setSubtitleStyle] = useState(DEFAULT_SUBTITLE_STYLE);
  const [cinemaQueue, setCinemaQueue] = useState([]);
  const [resumeList, setResumeList] = useState([]);
  const [autoNextCountdown, setAutoNextCountdown] = useState(null);

  const isSendingRef = useRef(false);
  const hasIrHardwareRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const historySettleTimerRef = useRef(null);
  const powerHoldTimerRef = useRef(null);
  const powerHintTimerRef = useRef(null);
  const powerTriggeredRef = useRef(false);
  const voiceCountdownTimerRef = useRef(null);
  const voiceDoneTimerRef = useRef(null);
  const voiceAbortRef = useRef(false);
  const voiceRequestIdRef = useRef(0);
  const voiceSessionRef = useRef(voiceSession);
  voiceSessionRef.current = voiceSession;
  const tvIpRef = useRef(tvIp);
  tvIpRef.current = tvIp;
  const handleTvCommandRef = useRef(null);
  const searchRequestIdRef = useRef(0);
  const searchFilterRef = useRef('all');
  const searchPaginationRef = useRef(DEFAULT_PAGINATION_STATE);
  const isLoadingMoreRef = useRef(false);
  const autoFilterPagesRef = useRef(0);
  const searchListRef = useRef(null);
  const bottomSentinelRef = useRef(null);
  const loadMoreHandlerRef = useRef(null);

  const cinemaSessionRef = useRef(cinemaSession);
  cinemaSessionRef.current = cinemaSession;
  const subtitleStyleRef = useRef(subtitleStyle);
  subtitleStyleRef.current = subtitleStyle;
  const cinemaQueueRef = useRef(cinemaQueue);
  cinemaQueueRef.current = cinemaQueue;
  const receiverStateRef = useRef(receiverState);
  receiverStateRef.current = receiverState;
  const lastResumeSaveMsRef = useRef(0);
  const lastEndedSessionRef = useRef('');
  const autoNextTimerRef = useRef(null);
  const startWebReceiverCastRef = useRef(null);
  const updateSubtitleStyleRef = useRef(null);
  const playNextEpisodeRef = useRef(null);

  const openQuickCastSheet = (payload) => {
    const rawUrl = String((payload && payload.url) || '').trim();
    if (!rawUrl) return;
    const incomingHeaders =
      payload && payload.headers && typeof payload.headers === 'object'
        ? payload.headers
        : {};
    const inferredTitle =
      String((payload && payload.title) || '').trim() ||
      inferMovieTitleFromUrl(rawUrl, 'فيلم مباشر');
    const inferredMime = guessMimeTypeFromUrl(
      rawUrl,
      payload && payload.mimeType ? payload.mimeType : ''
    );
    const incomingSub = String((payload && payload.subtitleUrl) || '').trim();

    setQuickCastSourceUrl(rawUrl);
    setQuickCastTitle(inferredTitle);
    setQuickCastHeaders(incomingHeaders);
    setQuickCastMimeType(inferredMime);
    setQuickCastSubtitleUri(incomingSub);
    setQuickCastSubtitleName(
      incomingSub
        ? String((payload && payload.subtitleName) || '').trim() ||
            inferMovieTitleFromUrl(incomingSub, 'ملف ترجمة خارجي')
        : ''
    );
    setQuickCastSubtitleOffsetMs(0);
    setQuickCastTargetIp((prev) => prev || tvIpRef.current || '192.168.1.50');
    setQuickCastErrorText('');
    setQuickCastStatusText('');
    setQuickCastResumeMatch(null);
    setQuickCastUseResume(true);
    setQuickCastModalVisible(true);

    CinemaStorageService.findResumeForUrl(rawUrl)
      .then((match) => {
        if (match && match.positionSec >= 10) {
          setQuickCastResumeMatch(match);
          setQuickCastUseResume(true);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    let mounted = true;

    const unsubscribe = WifiControl.subscribe((status) => {
      if (mounted) {
        setWifiStatus(status);
      }
    });

    HapticsManager.init()
      .then((cfg) => {
        if (mounted && cfg) {
          setHapticsConfig(cfg);
        }
      })
      .catch(() => {});

    WifiControl.getSearchHistory()
      .then((historyItems) => {
        if (mounted && Array.isArray(historyItems)) {
          setSearchHistory(historyItems);
        }
      })
      .catch(() => {});

    WifiControl.getFavoriteVideos()
      .then((favItems) => {
        if (mounted && Array.isArray(favItems)) {
          setFavoriteVideos(favItems);
        }
      })
      .catch(() => {});

    WifiControl.loadSavedConfig().then((saved) => {
      if (!mounted || !saved) return;
      if (saved.ipAddress) {
        setTvIp(saved.ipAddress);
        setSubnetPrefix(getSubnetFromIp(saved.ipAddress));
      }
      if (saved.protocol) setWifiProtocol(saved.protocol);
      if (saved.port) setTvPort(String(saved.port));
      if (saved.dialPort) setDialPort(String(saved.dialPort));
    });

    CastProxyService.getPendingExternalIntent()
      .then((payload) => {
        if (mounted && payload && payload.url) {
          openQuickCastSheet(payload);
        }
      })
      .catch(() => {});

    const unsubExternalMedia = CastProxyService.subscribeExternalMedia((payload) => {
      if (mounted && payload && payload.url) {
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CLICK);
        openQuickCastSheet(payload);
      }
    });

    const unsubProxyStopped = CastProxyService.subscribeProxyStopped(() => {
      if (mounted) {
        setQuickCastSession(null);
        setCinemaSession(null);
        setQuickCastStatusText('تم إيقاف البث من شريط الإشعارات.');
      }
    });

    CinemaStorageService.getSubtitleStyle()
      .then((st) => {
        if (mounted && st) setSubtitleStyle(st);
      })
      .catch(() => {});

    CinemaStorageService.getQueue()
      .then((q) => {
        if (mounted && Array.isArray(q)) setCinemaQueue(q);
      })
      .catch(() => {});

    CinemaStorageService.getResumeList()
      .then((list) => {
        if (mounted && Array.isArray(list)) setResumeList(list);
      })
      .catch(() => {});

    CastProxyService.getServerInfo()
      .then((info) => {
        if (mounted && info && info.receiverUrl) {
          setServerUrl(info.receiverUrl);
        }
      })
      .catch(() => {});

    const unsubReceiverState = CastProxyService.subscribeReceiverState((nextState) => {
      if (!mounted || !nextState) return;
      setReceiverState(nextState);

      const activeSess = cinemaSessionRef.current;
      if (activeSess && activeSess.sourceUrl) {
        const pos = Number(nextState.positionSec) || 0;
        const dur = Number(nextState.durationSec) || 0;
        const sid = nextState.sessionId || activeSess.sessionId || '';

        if (nextState.status === 'playing' && pos >= 5) {
          const now = Date.now();
          if (now - lastResumeSaveMsRef.current >= 5000) {
            lastResumeSaveMsRef.current = now;
            CinemaStorageService.savePlaybackProgress({
              url: activeSess.sourceUrl,
              title: activeSess.title,
              mimeType: activeSess.mimeType,
              headers: activeSess.headers,
              subtitleUrl: activeSess.subtitleUri,
              subtitleName: activeSess.subtitleName,
              positionSec: pos,
              durationSec: dur,
            })
              .then((updatedList) => {
                if (mounted) setResumeList(updatedList);
              })
              .catch(() => {});
          }
        }

        if (nextState.status === 'ended' && sid && lastEndedSessionRef.current !== sid) {
          lastEndedSessionRef.current = sid;
          CinemaStorageService.savePlaybackProgress({
            url: activeSess.sourceUrl,
            title: activeSess.title,
            positionSec: dur || pos,
            durationSec: dur,
          })
            .then((updatedList) => {
              if (mounted) setResumeList(updatedList);
            })
            .catch(() => {});

          const qNow = cinemaQueueRef.current;
          if (Array.isArray(qNow) && qNow.length > 0) {
            const upcoming = qNow[0];
            if (autoNextTimerRef.current) {
              clearInterval(autoNextTimerRef.current);
              autoNextTimerRef.current = null;
            }
            let secs = 5;
            setAutoNextCountdown({ seconds: secs, nextItem: upcoming });
            CastProxyService.sendReceiverCommand('showCountdown', {
              seconds: secs,
              nextTitle: upcoming.title || 'الحلقة التالية',
            }).catch(() => {});

            autoNextTimerRef.current = setInterval(() => {
              secs -= 1;
              if (secs <= 0) {
                if (autoNextTimerRef.current) {
                  clearInterval(autoNextTimerRef.current);
                  autoNextTimerRef.current = null;
                }
                if (mounted) {
                  setAutoNextCountdown(null);
                  if (playNextEpisodeRef.current) {
                    playNextEpisodeRef.current();
                  }
                }
              } else if (mounted) {
                setAutoNextCountdown({ seconds: secs, nextItem: upcoming });
              }
            }, 1000);
          }
        }
      }
    });

    if (Platform.OS === 'web') {
      hasIrHardwareRef.current = true;
      setHasIrHardware(true);
    } else if (Platform.OS === 'android' && IrManagerModule) {
      IrManagerModule.hasIrEmitter()
        .then((supported) => {
          if (mounted) {
            const available = Boolean(supported);
            hasIrHardwareRef.current = available;
            setHasIrHardware(available);
          }
        })
        .catch(() => {
          if (mounted) {
            hasIrHardwareRef.current = false;
            setHasIrHardware(false);
          }
        });
    } else {
      hasIrHardwareRef.current = false;
      setHasIrHardware(false);
    }

    return () => {
      mounted = false;
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      if (historySettleTimerRef.current) {
        clearTimeout(historySettleTimerRef.current);
        historySettleTimerRef.current = null;
      }
      if (powerHoldTimerRef.current) {
        clearTimeout(powerHoldTimerRef.current);
        powerHoldTimerRef.current = null;
      }
      if (powerHintTimerRef.current) {
        clearTimeout(powerHintTimerRef.current);
        powerHintTimerRef.current = null;
      }
      if (voiceCountdownTimerRef.current) {
        clearInterval(voiceCountdownTimerRef.current);
        voiceCountdownTimerRef.current = null;
      }
      if (voiceDoneTimerRef.current) {
        clearTimeout(voiceDoneTimerRef.current);
        voiceDoneTimerRef.current = null;
      }
      if (autoNextTimerRef.current) {
        clearInterval(autoNextTimerRef.current);
        autoNextTimerRef.current = null;
      }
      voiceAbortRef.current = true;
      VoiceControl.cancelSession().catch(() => {});
      HapticsManager.stopHoldFeedback();
      unsubExternalMedia();
      unsubProxyStopped();
      unsubReceiverState();
      unsubscribe();
      WifiControl.abortDiscovery();
      WifiControl.disconnect();
    };
  }, []);

  const clearErrorBanner = () => {
    setFeedback((prev) =>
      prev.tone === 'neutral' && prev.text === '' ? prev : { text: '', tone: 'neutral' }
    );
  };

  const transmitIrPattern = async (pattern) => {
    if (Platform.OS === 'web') {
      clearErrorBanner();
      return {
        simulated: true,
        carrierFrequency: CARRIER_38KHZ,
        pulseCount: Array.isArray(pattern) ? pattern.length : 0,
      };
    }
    if (Platform.OS !== 'android' || !IrManagerModule) {
      throw new Error('وحدة IrManagerModule متاحة فقط على أجهزة أندرويد.');
    }
    if (hasIrHardwareRef.current !== true) {
      const available = Boolean(await IrManagerModule.hasIrEmitter());
      hasIrHardwareRef.current = available;
      setHasIrHardware(available);
      if (!available) {
        throw new Error('هذا الهاتف لا يحتوي على مستشعر IR Blaster.');
      }
    }
    await IrManagerModule.transmitIR(pattern, CARRIER_38KHZ);
    clearErrorBanner();
  };

  const cancelPowerHold = () => {
    if (powerHoldTimerRef.current) {
      clearTimeout(powerHoldTimerRef.current);
      powerHoldTimerRef.current = null;
    }
    setIsPowerHolding(false);
  };

  useEffect(() => {
    if (activeTab !== 'tv' || tvTransport !== 'wifi') {
      WifiControl.releaseActiveHold();
    }
    if (activeTab !== 'tv') {
      cancelPowerHold();
    }
  }, [activeTab, tvTransport]);

  const refreshNetworkStatus = async ({ verifyLanReachability = true } = {}) => {
    try {
      WifiControl.configure({
        protocol: wifiProtocol,
        ipAddress: tvIp,
        port: Number(tvPort) || undefined,
        dialPort: Number(dialPort) || undefined,
      });
      const res = await WifiControl.checkSameWifiNetwork({ verifyLanReachability });
      if (res && !res.sameNetwork) {
        setNetworkNotice({ message: res.message, reason: res.reason });
      } else {
        setNetworkNotice(null);
      }
      return res;
    } catch (_) {
      return { sameNetwork: true, reason: 'ok', message: '' };
    }
  };

  useEffect(() => {
    if (!AppState || typeof AppState.addEventListener !== 'function') {
      return undefined;
    }
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        WifiControl.releaseActiveHold();
        HapticsManager.stopHoldFeedback();
        cancelPowerHold();
        if (voiceSessionRef.current && voiceSessionRef.current.phase === 'listening') {
          VoiceControl.cancelSession().catch(() => {});
          setVoiceSession((prev) =>
            prev.phase === 'listening' ? { ...prev, phase: 'idle' } : prev
          );
        }
      } else if (isSearchInputOpen) {
        refreshNetworkStatus({ verifyLanReachability: true });
      }
    });
    return () => {
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      }
    };
  }, [isSearchInputOpen, tvIp, tvPort, dialPort, wifiProtocol]);

  const handleStartWifiHold = (commandKey) => {
    if (tvTransport !== 'wifi') {
      return false;
    }
    return WifiControl.startKeyHold(commandKey);
  };

  const handleEndWifiHold = (commandKey) => {
    if (tvTransport !== 'wifi') {
      WifiControl.releaseActiveHold();
      return;
    }
    WifiControl.endKeyHold(commandKey);
  };

  const handlePowerPressIn = () => {
    cancelPowerHold();
    powerTriggeredRef.current = false;
    if (powerHintTimerRef.current) {
      clearTimeout(powerHintTimerRef.current);
      powerHintTimerRef.current = null;
    }
    setPowerHintText('');
    setIsPowerHolding(true);
    HapticsManager.trigger(HAPTIC_PATTERNS.POWER_ALERT);

    powerHoldTimerRef.current = setTimeout(() => {
      powerHoldTimerRef.current = null;
      powerTriggeredRef.current = true;
      setIsPowerHolding(false);
      HapticsManager.trigger(HAPTIC_PATTERNS.POWER_TV);
      handleTvCommand('POWER');
    }, 350);
  };

  const handlePowerPressOut = () => {
    const releasedEarly = Boolean(powerHoldTimerRef.current) && !powerTriggeredRef.current;
    cancelPowerHold();
    if (releasedEarly) {
      setPowerHintText('اضغط مطولاً');
      if (powerHintTimerRef.current) {
        clearTimeout(powerHintTimerRef.current);
      }
      powerHintTimerRef.current = setTimeout(() => {
        powerHintTimerRef.current = null;
        setPowerHintText('');
      }, 1100);
    }
  };

  const handleUpdateHaptics = async (nextPartial) => {
    const updated = await HapticsManager.setConfig(nextPartial);
    setHapticsConfig(updated);
    if (updated.enabled && nextPartial.intensity) {
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    } else if (updated.enabled && nextPartial.enabled === true) {
      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    }
  };

  const handleTvCommand = async (commandKey, options = {}) => {
    if (tvTransport === 'wifi' && WifiControl.supportsNativeHold()) {
      try {
        await WifiControl.sendCommand(commandKey);
        clearErrorBanner();
        return true;
      } catch (error) {
        if (options.throwOnError) {
          throw error;
        }
        setFeedback({
          text: error && error.message ? error.message : 'تعذر تنفيذ الأمر',
          tone: 'error',
        });
        return false;
      }
    }

    if (isSendingRef.current) {
      return false;
    }
    isSendingRef.current = true;
    try {
      if (tvTransport === 'ir') {
        const brand = TV_IR_BRANDS[tvBrand];
        const cmdHex = brand.commands[commandKey];
        if (cmdHex === undefined) {
          throw new Error(`الأمر ${commandKey} غير معرف لجهاز ${brand.label}`);
        }
        const repeatCount = options.burstFrames || 3;
        const pattern =
          brand.protocol === 'samsung_dual'
            ? encodeSamsungDual0707(
                cmdHex,
                brand.addressHigh,
                brand.addressLow,
                repeatCount
              )
            : encodeNecToMicroseconds(brand.address, cmdHex);
        await transmitIrPattern(pattern);
      } else {
        await WifiControl.sendCommand(commandKey);
        clearErrorBanner();
      }
      return true;
    } catch (error) {
      if (options.throwOnError) {
        throw error;
      }
      setFeedback({
        text: error && error.message ? error.message : 'تعذر تنفيذ الأمر',
        tone: 'error',
      });
      return false;
    } finally {
      isSendingRef.current = false;
    }
  };

  handleTvCommandRef.current = handleTvCommand;

  useEffect(() => {
    if (!tvSleepTimer || !tvSleepTimer.endTime) {
      return undefined;
    }
    const tickTimer = () => {
      const remainingMs = tvSleepTimer.endTime - Date.now();
      if (remainingMs <= 0) {
        setTvSleepTimer(null);
        HapticsManager.trigger(HAPTIC_PATTERNS.POWER_TV);
        if (handleTvCommandRef.current) {
          handleTvCommandRef.current('POWER');
        }
        return false;
      }
      const nextSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setTvSleepTimer((prev) => {
        if (!prev || prev.endTime !== tvSleepTimer.endTime) return prev;
        if (prev.remainingSeconds === nextSeconds) return prev;
        return { ...prev, remainingSeconds: nextSeconds };
      });
      return true;
    };

    const stillActive = tickTimer();
    if (!stillActive) return undefined;

    const intervalId = setInterval(() => {
      const keepGoing = tickTimer();
      if (!keepGoing) {
        clearInterval(intervalId);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [tvSleepTimer ? tvSleepTimer.endTime : null]);

  const clearVoiceTimers = () => {
    if (voiceCountdownTimerRef.current) {
      clearInterval(voiceCountdownTimerRef.current);
      voiceCountdownTimerRef.current = null;
    }
    if (voiceDoneTimerRef.current) {
      clearTimeout(voiceDoneTimerRef.current);
      voiceDoneTimerRef.current = null;
    }
  };

  const resetVoiceSession = () => {
    clearVoiceTimers();
    voiceAbortRef.current = true;
    voiceRequestIdRef.current += 1;
    setVoiceSession({
      phase: 'idle',
      transcript: '',
      partialTranscript: '',
      rmsLevel: 0,
      parsedCommand: null,
      videoCandidate: null,
      alternateResults: [],
      countdownRemainingMs: 0,
      countdownTotalMs: 0,
      statusMessage: '',
      errorMessage: '',
    });
  };

  const handleCancelVoiceSession = async () => {
    voiceAbortRef.current = true;
    clearVoiceTimers();
    voiceRequestIdRef.current += 1;
    await VoiceControl.cancelSession().catch(() => {});
    resetVoiceSession();
  };

  const formatSleepRemainingClock = (totalSecs) => {
    const secs = Math.max(0, Math.floor(Number(totalSecs) || 0));
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const rem = secs % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const sendRepeatedTvCommand = async (commandKey, count = 1) => {
    const steps = Math.max(1, Math.min(25, Math.round(Number(count) || 1)));
    if (tvTransport === 'wifi') {
      const netCheck = await refreshNetworkStatus({ verifyLanReachability: false });
      if (netCheck && !netCheck.sameNetwork) {
        throw new Error(netCheck.message);
      }
      await WifiControl.sendRepeatedCommand(
        commandKey,
        steps,
        140,
        () => voiceAbortRef.current
      );
      return;
    }

    for (let i = 0; i < steps; i += 1) {
      if (voiceAbortRef.current) {
        break;
      }
      await handleTvCommandRef.current(commandKey, {
        throwOnError: true,
        burstFrames: steps > 1 ? 2 : 3,
      });
      if (i < steps - 1) {
        if (voiceAbortRef.current) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    }
  };

  const executeVoiceCommand = async (parsedCmd, videoCandidate, requestId) => {
    if (!parsedCmd || voiceRequestIdRef.current !== requestId) {
      return;
    }

    clearVoiceTimers();
    voiceAbortRef.current = false;

    setVoiceSession((prev) => ({
      ...prev,
      phase: 'executing',
      countdownRemainingMs: 0,
      statusMessage: parsedCmd.label || 'جاري تنفيذ الأمر الصوتي...',
      errorMessage: '',
    }));

    try {
      if (parsedCmd.type === 'YOUTUBE_DIRECT_PLAY') {
        if (!videoCandidate || !videoCandidate.videoId) {
          throw new Error('لم يتم العثور على فيديو مناسب لتشغيله.');
        }
        const netCheck = await refreshNetworkStatus({ verifyLanReachability: true });
        if (netCheck && !netCheck.sameNetwork) {
          throw new Error(netCheck.message);
        }
        await WifiControl.castYouTubeVideo(videoCandidate.videoId);
        recordSearchHistory(parsedCmd.query);
        setLastCastedVideoId(videoCandidate.videoId);
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'TV_SLEEP_TIMER') {
        const totalMinutes = Math.max(1, Number(parsedCmd.minutes) || 1);
        const endTime = Date.now() + totalMinutes * 60 * 1000;
        setTvSleepTimer({
          endTime,
          totalMinutes,
          remainingSeconds: totalMinutes * 60,
        });
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'CANCEL_TV_SLEEP_TIMER') {
        setTvSleepTimer(null);
        HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
      } else if (parsedCmd.type === 'LAUNCH_YOUTUBE') {
        const netCheck = await refreshNetworkStatus({ verifyLanReachability: false });
        if (netCheck && !netCheck.sameNetwork) {
          throw new Error(netCheck.message);
        }
        await WifiControl.launchYouTube();
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'OPEN_BROWSER') {
        const netCheck = await refreshNetworkStatus({ verifyLanReachability: true });
        if (netCheck && !netCheck.sameNetwork) {
          throw new Error(netCheck.message);
        }
        await WifiControl.openUrlInTvBrowser(parsedCmd.url || 'https://www.google.com');
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'CINEMA_SKIP_INTRO') {
        if (cinemaSessionRef.current) {
          await CastProxyService.sendReceiverCommand('seekDelta', {
            deltaSec: Number(parsedCmd.deltaSec) || 85,
          });
        } else {
          await sendRepeatedTvCommand('RIGHT', 8);
        }
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'CINEMA_SUBTITLE_SIZE') {
        const curSize = Number((subtitleStyleRef.current || {}).fontSize) || 34;
        const nextSize = Math.max(18, Math.min(56, curSize + (Number(parsedCmd.deltaPx) || 0)));
        if (updateSubtitleStyleRef.current) {
          await updateSubtitleStyleRef.current({ fontSize: nextSize });
        }
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'CINEMA_SUBTITLE_OFFSET') {
        const curOff = Number((subtitleStyleRef.current || {}).offsetSec) || 0;
        const nextOff = Number((curOff + (Number(parsedCmd.deltaSec) || 0)).toFixed(1));
        if (updateSubtitleStyleRef.current) {
          await updateSubtitleStyleRef.current({ offsetSec: nextOff });
        }
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'CINEMA_NEXT_EPISODE') {
        if (!cinemaQueueRef.current || cinemaQueueRef.current.length === 0) {
          throw new Error('قائمة الحلقات فارغة حالياً.');
        }
        if (playNextEpisodeRef.current) {
          await playNextEpisodeRef.current();
        }
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else if (parsedCmd.type === 'TV_REPEATED_COMMAND') {
        if (
          (parsedCmd.commandKey === 'RIGHT' || parsedCmd.commandKey === 'LEFT') &&
          typeof parsedCmd.deltaSec === 'number' &&
          cinemaSessionRef.current
        ) {
          await CastProxyService.sendReceiverCommand('seekDelta', {
            deltaSec: parsedCmd.deltaSec,
          });
          HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
        } else {
          await sendRepeatedTvCommand(parsedCmd.commandKey, parsedCmd.count);
          if (!voiceAbortRef.current) {
            HapticsManager.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
          }
        }
      } else if (parsedCmd.type === 'TV_COMMAND') {
        if (
          cinemaSessionRef.current &&
          (parsedCmd.commandKey === 'PAUSE' ||
            parsedCmd.commandKey === 'PLAY' ||
            parsedCmd.commandKey === 'MUTE')
        ) {
          if (parsedCmd.commandKey === 'PAUSE') {
            await CastProxyService.sendReceiverCommand('pause', {});
          } else if (parsedCmd.commandKey === 'PLAY') {
            await CastProxyService.sendReceiverCommand('play', {});
          } else {
            const currentlyMuted = Boolean(
              receiverStateRef.current && receiverStateRef.current.muted
            );
            await CastProxyService.sendReceiverCommand('setMute', {
              muted: !currentlyMuted,
            });
          }
          HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
        } else {
          if (tvTransport === 'wifi') {
            const netCheck = await refreshNetworkStatus({ verifyLanReachability: false });
            if (netCheck && !netCheck.sameNetwork) {
              throw new Error(netCheck.message);
            }
          }
          await handleTvCommandRef.current(parsedCmd.commandKey, { throwOnError: true });
          HapticsManager.trigger(
            parsedCmd.commandKey === 'POWER'
              ? HAPTIC_PATTERNS.POWER_TV
              : HAPTIC_PATTERNS.OK_CONFIRM
          );
        }
      } else {
        throw new Error('لم يتم فهم الأمر الصوتي المطلوب.');
      }

      if (voiceRequestIdRef.current !== requestId) {
        return;
      }

      clearErrorBanner();
      setVoiceSession((prev) => ({
        ...prev,
        phase: 'done',
        statusMessage:
          parsedCmd.type === 'YOUTUBE_DIRECT_PLAY' && videoCandidate
            ? `تم التشغيل على الشاشة: ${videoCandidate.title}`
            : parsedCmd.label || 'تم التنفيذ بنجاح',
      }));

      voiceDoneTimerRef.current = setTimeout(() => {
        if (voiceRequestIdRef.current === requestId) {
          resetVoiceSession();
        }
      }, 950);
    } catch (error) {
      if (voiceRequestIdRef.current !== requestId) {
        return;
      }
      HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
      setVoiceSession((prev) => ({
        ...prev,
        phase: 'error',
        errorMessage:
          error && error.message ? error.message : 'تعذر تنفيذ الأمر الصوتي حالياً.',
      }));
    }
  };

  const beginVoiceConfirmationCountdown = (
    parsedCmd,
    videoCandidate,
    alternateResults,
    requestId
  ) => {
    clearVoiceTimers();
    const totalMs = Math.max(800, Number(parsedCmd.confirmDelayMs) || 1200);
    const deadline = Date.now() + totalMs;

    setVoiceSession((prev) => ({
      ...prev,
      phase: 'confirming',
      parsedCommand: parsedCmd,
      videoCandidate: videoCandidate || null,
      alternateResults: Array.isArray(alternateResults) ? alternateResults : [],
      countdownRemainingMs: totalMs,
      countdownTotalMs: totalMs,
      statusMessage: parsedCmd.label || '',
      errorMessage: '',
    }));

    voiceCountdownTimerRef.current = setInterval(() => {
      if (voiceRequestIdRef.current !== requestId) {
        clearVoiceTimers();
        return;
      }
      const leftMs = deadline - Date.now();
      if (leftMs <= 0) {
        clearVoiceTimers();
        executeVoiceCommand(parsedCmd, videoCandidate, requestId);
      } else {
        setVoiceSession((prev) =>
          prev.phase === 'confirming'
            ? { ...prev, countdownRemainingMs: leftMs }
            : prev
        );
      }
    }, 90);
  };

  const handleExecuteVoiceCommandNow = () => {
    const cur = voiceSessionRef.current;
    if (!cur || !cur.parsedCommand) return;
    HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    executeVoiceCommand(
      cur.parsedCommand,
      cur.videoCandidate,
      voiceRequestIdRef.current
    );
  };

  const handleOpenVoiceSearchResults = () => {
    const cur = voiceSessionRef.current;
    if (!cur || !cur.parsedCommand || !cur.parsedCommand.query) return;
    const targetQuery = cur.parsedCommand.query;
    const prefetched = Array.isArray(cur.alternateResults)
      ? cur.alternateResults
      : [];
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    resetVoiceSession();
    clearErrorBanner();
    searchFilterRef.current = 'no_shorts';
    setSearchFilter('no_shorts');
    setSearchQuery(targetQuery);
    setIsSearchInputOpen(true);
    refreshNetworkStatus({ verifyLanReachability: true });
    if (prefetched.length > 0) {
      setSearchResults(prefetched);
      setHasSearchedOnce(true);
      setIsSearching(false);
    } else {
      handleSearchYouTube(targetQuery, { filter: 'no_shorts', saveHistory: true });
    }
  };

  const handleVoiceTranscriptResolved = async (finalTranscript, requestId) => {
    if (voiceRequestIdRef.current !== requestId) {
      return;
    }
    const cleanText = String(finalTranscript || '').trim();
    const parsedCmd = parseEgyptianVoiceCommand(cleanText);

    if (!parsedCmd || parsedCmd.type === 'UNKNOWN') {
      HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
      setVoiceSession((prev) => ({
        ...prev,
        phase: 'error',
        transcript: cleanText,
        parsedCommand: parsedCmd,
        errorMessage: 'لم أفهم الأمر. جرّب: «شغّل سورة البقرة» أو «علّي الصوت 5 درجات».',
      }));
      return;
    }

    if (parsedCmd.type === 'UNSUPPORTED_ABSOLUTE_VOLUME') {
      HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
      const levelNote = parsedCmd.targetLevel ? ` (${parsedCmd.targetLevel})` : '';
      setVoiceSession((prev) => ({
        ...prev,
        phase: 'error',
        transcript: cleanText,
        parsedCommand: parsedCmd,
        errorMessage: `الريموت لا يمكنه معرفة مستوى الصوت الحالي للشاشة لضبطه على رقم ثابت${levelNote}. قل مثلاً: «علّي الصوت 5 درجات» أو «وطّي الصوت 5 درجات».`,
      }));
      return;
    }

    if (parsedCmd.type === 'YOUTUBE_DIRECT_PLAY') {
      setVoiceSession((prev) => ({
        ...prev,
        phase: 'searching',
        transcript: cleanText,
        parsedCommand: parsedCmd,
        videoCandidate: null,
        alternateResults: [],
        statusMessage: `جاري البحث عن: ${parsedCmd.query}`,
        errorMessage: '',
      }));

      try {
        const res = await WifiControl.searchYouTubeVideos(parsedCmd.query, {
          filter: 'no_shorts',
          page: 1,
        });
        if (voiceRequestIdRef.current !== requestId) {
          return;
        }
        const items = Array.isArray(res)
          ? res
          : res && Array.isArray(res.items)
          ? res.items
          : [];
        const uniqueItems = mergeUniqueVideos([], items);
        if (uniqueItems.length === 0) {
          HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
          setVoiceSession((prev) => ({
            ...prev,
            phase: 'error',
            transcript: cleanText,
            parsedCommand: parsedCmd,
            errorMessage: `لم يتم العثور على نتائج لـ "${parsedCmd.query}".`,
          }));
          return;
        }

        const firstResult = uniqueItems[0];
        HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
        beginVoiceConfirmationCountdown(parsedCmd, firstResult, uniqueItems, requestId);
      } catch (err) {
        if (voiceRequestIdRef.current !== requestId) {
          return;
        }
        HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
        setVoiceSession((prev) => ({
          ...prev,
          phase: 'error',
          transcript: cleanText,
          parsedCommand: parsedCmd,
          errorMessage:
            err && err.message ? err.message : 'تعذر البحث في يوتيوب حالياً.',
        }));
      }
      return;
    }

    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    beginVoiceConfirmationCountdown(parsedCmd, null, [], requestId);
  };

  const handleVoiceMicPress = async () => {
    if (voiceSessionRef.current.phase === 'listening') {
      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
      await VoiceControl.stopSession();
      return;
    }

    HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    clearVoiceTimers();
    voiceAbortRef.current = false;
    const requestId = voiceRequestIdRef.current + 1;
    voiceRequestIdRef.current = requestId;

    setVoiceSession({
      phase: 'listening',
      transcript: '',
      partialTranscript: '',
      rmsLevel: 0,
      parsedCommand: null,
      videoCandidate: null,
      alternateResults: [],
      countdownRemainingMs: 0,
      countdownTotalMs: 0,
      statusMessage: 'تحدث الآن بالعامية المصرية...',
      errorMessage: '',
    });

    await VoiceControl.startSession({
      language: 'ar-EG',
      onReady: () => {
        if (voiceRequestIdRef.current !== requestId) return;
        setVoiceSession((prev) =>
          prev.phase === 'listening'
            ? { ...prev, statusMessage: 'أسمعك الآن...' }
            : prev
        );
      },
      onRms: (rmsVal) => {
        if (voiceRequestIdRef.current !== requestId) return;
        setVoiceSession((prev) =>
          prev.phase === 'listening'
            ? { ...prev, rmsLevel: Math.max(0, Math.min(10, Number(rmsVal) || 0)) }
            : prev
        );
      },
      onPartial: (partialText) => {
        if (voiceRequestIdRef.current !== requestId) return;
        setVoiceSession((prev) =>
          prev.phase === 'listening'
            ? { ...prev, partialTranscript: partialText }
            : prev
        );
      },
      onResult: (finalTranscript) => {
        if (voiceRequestIdRef.current !== requestId) return;
        handleVoiceTranscriptResolved(finalTranscript, requestId);
      },
      onError: (err) => {
        if (voiceRequestIdRef.current !== requestId) return;
        HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
        setVoiceSession((prev) => ({
          ...prev,
          phase: 'error',
          errorMessage:
            (err && err.message) || 'تعذر التقاط الأمر الصوتي. حاول مجدداً.',
        }));
      },
      onEnd: () => {
        if (voiceRequestIdRef.current !== requestId) return;
        setVoiceSession((prev) => {
          if (prev.phase !== 'listening') return prev;
          if (prev.partialTranscript && prev.partialTranscript.trim()) {
            setTimeout(() => {
              handleVoiceTranscriptResolved(prev.partialTranscript, requestId);
            }, 0);
            return prev;
          }
          return {
            ...prev,
            phase: 'error',
            errorMessage: 'لم يتم سماع أي أمر واضح. اضغط المايكروفون وجرّب مجدداً.',
          };
        });
      },
    });
  };

  const handleScanSmartTvs = async (overrideSubnet) => {
    if (isDiscovering) {
      WifiControl.abortDiscovery();
      setIsDiscovering(false);
      return;
    }

    const activeSubnet = getSubnetFromIp(
      overrideSubnet || `${subnetPrefix}.1` || tvIp
    );
    setSubnetPrefix(activeSubnet);
    setIsDiscovering(true);
    setHasScannedOnce(true);
    setDiscoveredTvs([]);
    setScanProgress({ scanned: 0, total: 254 });
    clearErrorBanner();

    try {
      const devices = await WifiControl.discoverSmartTvs({
        subnetPrefix: activeSubnet,
        onProgress: ({ scanned, total, foundDevices }) => {
          setScanProgress({ scanned, total });
          setDiscoveredTvs(foundDevices);
        },
      });
      setDiscoveredTvs(devices);
    } catch (error) {
      setFeedback({
        text:
          error && error.message
            ? error.message
            : 'تعذر إتمام البحث عن الشاشات في الشبكة المحلية.',
        tone: 'error',
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleSelectDiscoveredTv = async (device) => {
    WifiControl.abortDiscovery();
    setIsDiscovering(false);

    const nextPort = String(
      device.port || (device.protocol === 'roku' ? 8060 : device.protocol === 'samsung_tizen' ? 8002 : 8080)
    );
    const nextDial = String(device.dialPort || (device.protocol === 'roku' ? 8060 : 8080));

    setWifiProtocol(device.protocol);
    setTvIp(device.ip);
    setTvPort(nextPort);
    setDialPort(nextDial);
    setSubnetPrefix(getSubnetFromIp(device.ip));

    WifiControl.configure({
      protocol: device.protocol,
      ipAddress: device.ip,
      port: Number(nextPort),
      dialPort: Number(nextDial),
      deviceName: device.name,
    });

    setShowWifiModal(false);
    setIsConnectingWifi(true);
    try {
      await WifiControl.connect();
      clearErrorBanner();
    } catch (error) {
      setFeedback({
        text:
          error && error.message
            ? error.message
            : `تم اختيار ${device.name} (${device.ip}) ولكن تعذر الاتصال الفوري.`,
        tone: 'error',
      });
    } finally {
      setIsConnectingWifi(false);
    }
  };

  const handleSaveWifi = async () => {
    const defaultPort =
      wifiProtocol === 'roku' ? 8060 : wifiProtocol === 'samsung_tizen' ? 8002 : 8080;
    const defaultDial =
      wifiProtocol === 'roku' ? 8060 : wifiProtocol === 'samsung_tizen' ? 8080 : 8008;

    const parsedPort = Number(tvPort) || defaultPort;
    const parsedDialPort = Number(dialPort) || defaultDial;

    WifiControl.configure({
      protocol: wifiProtocol,
      ipAddress: tvIp,
      port: parsedPort,
      dialPort: parsedDialPort,
    });
    setSubnetPrefix(getSubnetFromIp(tvIp));
    setShowWifiModal(false);
    setIsConnectingWifi(true);
    try {
      await WifiControl.connect();
      clearErrorBanner();
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر الاتصال بالواي فاي',
        tone: 'error',
      });
    } finally {
      setIsConnectingWifi(false);
    }
  };

  const handleClearSavedToken = async () => {
    await WifiControl.clearToken(tvIp);
    clearErrorBanner();
  };

  const handleLaunchYouTube = async () => {
    setIsLaunchingYouTube(true);
    try {
      const netCheck = await refreshNetworkStatus({ verifyLanReachability: false });
      if (netCheck && !netCheck.sameNetwork) {
        setFeedback({ text: netCheck.message, tone: 'error' });
        return;
      }
      await WifiControl.launchYouTube();
      clearErrorBanner();
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر فتح تطبيق يوتيوب على الشاشة',
        tone: 'error',
      });
    } finally {
      setIsLaunchingYouTube(false);
    }
  };

  const recordSearchHistory = (queryText) => {
    const clean = String(queryText || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 2) return;
    WifiControl.saveSearchHistoryItem(clean)
      .then((updated) => {
        if (Array.isArray(updated)) {
          setSearchHistory(updated);
        }
      })
      .catch(() => {});
  };

  const handleSearchYouTube = async (overrideQuery, options = {}) => {
    const targetQuery =
      typeof overrideQuery === 'string' ? overrideQuery : searchQuery;
    const cleanTarget = targetQuery.trim();
    const targetFilter = options.filter || searchFilterRef.current || 'all';
    const smart = parseSmartSearchInput(cleanTarget);

    if (!cleanTarget || smart.type !== 'query') {
      searchPaginationRef.current = DEFAULT_PAGINATION_STATE;
      setSearchPagination(DEFAULT_PAGINATION_STATE);
      setSearchResults([]);
      setIsSearching(false);
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
      setHasSearchedOnce(false);
      return;
    }

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (historySettleTimerRef.current) {
      clearTimeout(historySettleTimerRef.current);
      historySettleTimerRef.current = null;
    }

    if (options.saveHistory) {
      recordSearchHistory(cleanTarget);
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    autoFilterPagesRef.current = 0;
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
    searchPaginationRef.current = DEFAULT_PAGINATION_STATE;
    setSearchPagination(DEFAULT_PAGINATION_STATE);
    setIsSearching(true);
    setHasSearchedOnce(true);

    try {
      const response = await WifiControl.searchYouTubeVideos(smart.query, {
        filter: targetFilter,
        page: 1,
      });
      if (searchRequestIdRef.current !== requestId) return;

      const items = Array.isArray(response)
        ? response
        : response && Array.isArray(response.items)
        ? response.items
        : [];
      const uniqueItems = mergeUniqueVideos([], items);
      const nextPag = {
        nextPageToken: response && response.nextPageToken ? response.nextPageToken : null,
        nextPage: response && response.nextPage ? response.nextPage : 2,
        hasMore: Boolean(response && response.hasMore),
        providerType: response && response.providerType ? response.providerType : null,
        instanceUrl: response && response.instanceUrl ? response.instanceUrl : null,
      };

      searchPaginationRef.current = nextPag;
      setSearchPagination(nextPag);
      setSearchResults(uniqueItems);
      clearErrorBanner();

      if (!options.saveHistory && uniqueItems.length > 0) {
        historySettleTimerRef.current = setTimeout(() => {
          if (searchRequestIdRef.current === requestId) {
            recordSearchHistory(cleanTarget);
          }
        }, 1200);
      }
    } catch (error) {
      if (searchRequestIdRef.current !== requestId) return;
      searchPaginationRef.current = DEFAULT_PAGINATION_STATE;
      setSearchPagination(DEFAULT_PAGINATION_STATE);
      setSearchResults([]);
      setFeedback({
        text: error && error.message ? error.message : 'فشل البحث في يوتيوب',
        tone: 'error',
      });
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setIsSearching(false);
      }
    }
  };

  const handleLoadMoreResults = async () => {
    const cleanTarget = searchQuery.trim();
    const smart = parseSmartSearchInput(cleanTarget);
    const currentPag = searchPaginationRef.current;

    if (
      !cleanTarget ||
      smart.type !== 'query' ||
      isSearching ||
      isLoadingMoreRef.current ||
      !currentPag.hasMore
    ) {
      return;
    }

    const requestId = searchRequestIdRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const response = await WifiControl.searchYouTubeVideos(smart.query, {
        filter: searchFilterRef.current || 'all',
        pageToken: currentPag.nextPageToken,
        page: currentPag.nextPage || 2,
        providerType: currentPag.providerType,
        instanceUrl: currentPag.instanceUrl,
      });
      if (searchRequestIdRef.current !== requestId) return;

      const items = Array.isArray(response)
        ? response
        : response && Array.isArray(response.items)
        ? response.items
        : [];

      const nextPag = {
        nextPageToken: response && response.nextPageToken ? response.nextPageToken : null,
        nextPage:
          response && response.nextPage
            ? response.nextPage
            : (currentPag.nextPage || 2) + 1,
        hasMore: Boolean(response && response.hasMore) && items.length > 0,
        providerType:
          (response && response.providerType) || currentPag.providerType || null,
        instanceUrl:
          (response && response.instanceUrl) || currentPag.instanceUrl || null,
      };

      searchPaginationRef.current = nextPag;
      setSearchPagination(nextPag);
      setSearchResults((prev) => mergeUniqueVideos(prev, items));
    } catch (_) {
      if (searchRequestIdRef.current === requestId) {
        const stoppedPag = { ...searchPaginationRef.current, hasMore: false };
        searchPaginationRef.current = stoppedPag;
        setSearchPagination(stoppedPag);
      }
    } finally {
      if (searchRequestIdRef.current === requestId) {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  };

  loadMoreHandlerRef.current = handleLoadMoreResults;

  const isWifiMode = activeTab === 'tv' && tvTransport === 'wifi';
  const isTvSearchAvailable = activeTab === 'tv';

  const handleOpenSearch = () => {
    if (!isTvSearchAvailable) return;
    clearErrorBanner();
    setIsSearchInputOpen(true);
    refreshNetworkStatus({ verifyLanReachability: true });
    WifiControl.getSearchHistory()
      .then((historyItems) => {
        if (Array.isArray(historyItems)) {
          setSearchHistory(historyItems);
        }
      })
      .catch(() => {});
    WifiControl.getFavoriteVideos()
      .then((favItems) => {
        if (Array.isArray(favItems)) {
          setFavoriteVideos(favItems);
        }
      })
      .catch(() => {});
  };

  const handleCloseSearch = () => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (historySettleTimerRef.current) {
      clearTimeout(historySettleTimerRef.current);
      historySettleTimerRef.current = null;
    }
    if (hasSearchedOnce && searchResults.length > 0 && searchQuery.trim().length >= 2) {
      recordSearchHistory(searchQuery);
    }
    searchRequestIdRef.current += 1;
    autoFilterPagesRef.current = 0;
    isLoadingMoreRef.current = false;
    searchPaginationRef.current = DEFAULT_PAGINATION_STATE;
    setIsSearchInputOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchPagination(DEFAULT_PAGINATION_STATE);
    setIsSearching(false);
    setIsLoadingMore(false);
    setHasSearchedOnce(false);
    setLastCastedVideoId(null);
    setNetworkNotice(null);
    clearErrorBanner();
  };

  useEffect(() => {
    if (!isTvSearchAvailable && isSearchInputOpen) {
      handleCloseSearch();
    }
  }, [isTvSearchAvailable, isSearchInputOpen]);

  useEffect(() => {
    if (isTvSearchAvailable && isSearchInputOpen) {
      refreshNetworkStatus({ verifyLanReachability: true });
    }
  }, [tvIp, wifiProtocol]);

  const handleClearSearchText = () => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (historySettleTimerRef.current) {
      clearTimeout(historySettleTimerRef.current);
      historySettleTimerRef.current = null;
    }
    if (hasSearchedOnce && searchResults.length > 0 && searchQuery.trim().length >= 2) {
      recordSearchHistory(searchQuery);
    }
    searchRequestIdRef.current += 1;
    autoFilterPagesRef.current = 0;
    isLoadingMoreRef.current = false;
    searchPaginationRef.current = DEFAULT_PAGINATION_STATE;
    setSearchQuery('');
    setSearchResults([]);
    setSearchPagination(DEFAULT_PAGINATION_STATE);
    setIsSearching(false);
    setIsLoadingMore(false);
    setHasSearchedOnce(false);
    setLastCastedVideoId(null);
    clearErrorBanner();
  };

  const handleSelectSuggestion = (term) => {
    const clean = String(term || '').trim();
    if (!clean) return;
    setSearchQuery(clean);
    setLastCastedVideoId(null);
    handleSearchYouTube(clean, { saveHistory: true });
  };

  const handleSelectSearchFilter = (nextFilterKey) => {
    if (!nextFilterKey || nextFilterKey === searchFilterRef.current) return;
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    searchFilterRef.current = nextFilterKey;
    setSearchFilter(nextFilterKey);
    autoFilterPagesRef.current = 0;

    const trimmed = searchQuery.trim();
    const smart = parseSmartSearchInput(trimmed);
    if (trimmed && smart.type === 'query') {
      handleSearchYouTube(trimmed, { filter: nextFilterKey });
    }
  };

  const handleRemoveSearchHistoryItem = async (term) => {
    try {
      const updated = await WifiControl.removeSearchHistoryItem(term);
      setSearchHistory(updated);
    } catch (_) {
      // ignore
    }
  };

  const handleClearAllSearchHistory = async () => {
    try {
      const updated = await WifiControl.clearSearchHistory();
      setSearchHistory(updated);
    } catch (_) {
      // ignore
    }
  };

  const handleToggleFavoriteVideo = async (videoItem, event) => {
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    try {
      const result = await WifiControl.toggleFavoriteVideo(videoItem);
      if (result && Array.isArray(result.favorites)) {
        setFavoriteVideos(result.favorites);
      }
    } catch (_) {
      // ignore
    }
  };

  const handleSearchQueryChange = (text) => {
    setSearchQuery(text);
    setLastCastedVideoId(null);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (historySettleTimerRef.current) {
      clearTimeout(historySettleTimerRef.current);
      historySettleTimerRef.current = null;
    }

    const trimmed = text.trim();
    const smart = parseSmartSearchInput(trimmed);
    if (!trimmed || smart.type !== 'query') {
      searchRequestIdRef.current += 1;
      autoFilterPagesRef.current = 0;
      isLoadingMoreRef.current = false;
      searchPaginationRef.current = DEFAULT_PAGINATION_STATE;
      setSearchResults([]);
      setSearchPagination(DEFAULT_PAGINATION_STATE);
      setIsSearching(false);
      setIsLoadingMore(false);
      setHasSearchedOnce(false);
      clearErrorBanner();
      return;
    }

    clearErrorBanner();
    setIsSearching(true);
    searchDebounceRef.current = setTimeout(() => {
      handleSearchYouTube(text);
    }, 520);
  };

  const handleOpenUrlOnTv = async (rawUrl) => {
    setIsOpeningBrowserUrl(true);
    try {
      const netCheck = await refreshNetworkStatus({ verifyLanReachability: true });
      if (netCheck && !netCheck.sameNetwork) {
        setFeedback({ text: netCheck.message, tone: 'error' });
        return;
      }
      await WifiControl.openUrlInTvBrowser(rawUrl);
      clearErrorBanner();
    } catch (error) {
      setFeedback({
        text:
          error && error.message
            ? error.message
            : 'تعذر فتح الرابط في متصفح الشاشة.',
        tone: 'error',
      });
    } finally {
      setIsOpeningBrowserUrl(false);
    }
  };

  const handleCastVideo = async (item) => {
    const cleanQuery = searchQuery.trim();
    const smart = parseSmartSearchInput(cleanQuery);
    if (smart.type === 'query' && cleanQuery.length >= 2) {
      recordSearchHistory(cleanQuery);
    }
    setCastingVideoId(item.videoId);
    try {
      const netCheck = await refreshNetworkStatus({ verifyLanReachability: true });
      if (netCheck && !netCheck.sameNetwork) {
        setFeedback({
          text: netCheck.message,
          tone: 'error',
        });
        return;
      }
      await WifiControl.castYouTubeVideo(item.videoId);
      setLastCastedVideoId(item.videoId);
      clearErrorBanner();
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر تشغيل الفيديو على الشاشة',
        tone: 'error',
      });
    } finally {
      setCastingVideoId(null);
    }
  };

  const updateAcAndTransmit = async (nextAcState, options = {}) => {
    const normalizedAcState = !nextAcState.power
      ? { ...nextAcState, sleep: false, turbo: false }
      : nextAcState.mode === 'fan' || nextAcState.mode === 'dry'
      ? { ...nextAcState, sleep: false }
      : nextAcState;
    setAcState(normalizedAcState);

    let effectiveOptions = options;
    if (acBrand === 'midea' && acTimerConfig) {
      const shouldClearTimer =
        !normalizedAcState.power || (acTimerConfig.action === 'on' && normalizedAcState.power);
      if (shouldClearTimer) {
        setAcTimerConfig(null);
      } else if (
        acTimerConfig.action === 'off' &&
        normalizedAcState.power &&
        !options.specialCommand &&
        !options.isSwingToggle &&
        !options.timerMinutes
      ) {
        const remainingMs = Math.max(0, acTimerConfig.targetMs - Date.now());
        const remainingMinutes = Math.round(remainingMs / (30 * 60 * 1000)) * 30;
        if (remainingMinutes >= 30) {
          effectiveOptions = {
            ...options,
            timerMinutes: Math.min(1440, remainingMinutes),
            timerAction: acTimerConfig.action,
          };
        } else {
          setAcTimerConfig(null);
        }
      }
    }

    try {
      const pattern = buildAcIrPattern(acBrand, normalizedAcState, effectiveOptions);
      await transmitIrPattern(pattern);
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر إرسال أمر التكييف',
        tone: 'error',
      });
    }
  };

  const handleSleepToggle = async () => {
    const nextMode =
      acState.mode === 'fan' || acState.mode === 'dry' ? 'cool' : acState.mode;
    const nextState = {
      ...acState,
      power: true,
      mode: nextMode,
      sleep: !acState.sleep,
    };

    // يرسل مقدمة النوم 0xB2E003 متبوعة مباشرةً بإطار الحالة المتوافقة في نبضة IR واحدة
    await updateAcAndTransmit(nextState, { specialCommand: 'sleep' });
  };

  const formatTimerDuration = (totalMinutes) => {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hrs} ساعة ${mins} دقيقة`;
  };

  const formatTargetClockLabel = (offsetMinutes, baseTimestampMs = Date.now()) => {
    const now = new Date(baseTimestampMs);
    const target = new Date(baseTimestampMs + offsetMinutes * 60 * 1000);
    const sameDay =
      target.getFullYear() === now.getFullYear() &&
      target.getMonth() === now.getMonth() &&
      target.getDate() === now.getDate();
    const dayLabel = sameDay ? 'اليوم' : 'غداً';
    const hh = String(target.getHours()).padStart(2, '0');
    const mm = String(target.getMinutes()).padStart(2, '0');
    return `${dayLabel} ${hh}:${mm}`;
  };

  const handleOpenTimerModal = () => {
    const defaultAction = acState.power ? 'off' : 'on';
    setDraftTimerAction(acTimerConfig ? acTimerConfig.action : defaultAction);
    setDraftTimerMinutes(acTimerConfig ? acTimerConfig.minutes : 60);
    setShowTimerModal(true);
  };

  const handleStepDraftTimer = (direction) => {
    setDraftTimerMinutes((prev) => {
      if (direction > 0) {
        if (prev >= 1440) return 1440;
        // من 0 إلى 10 ساعات يزيد بمقدار 30 دقيقة، ومن 10 إلى 24 ساعة بمقدار ساعة
        const step = prev < 600 ? 30 : 60;
        return Math.min(1440, prev + step);
      }
      if (prev <= 30) return 30;
      const step = prev <= 600 ? 30 : 60;
      return Math.max(30, prev - step);
    });
  };

  const handleConfirmAcTimer = async () => {
    const nowMs = Date.now();
    const targetAcState =
      draftTimerAction === 'off' && !acState.power
        ? { ...acState, power: true }
        : acState;

    setShowTimerModal(false);
    try {
      const timerPattern = buildAcIrPattern(acBrand, targetAcState, {
        timerMinutes: draftTimerMinutes,
        timerAction: draftTimerAction,
      });
      await transmitIrPattern(timerPattern);
      if (targetAcState !== acState) {
        setAcState(targetAcState);
      }
      setAcTimerConfig({
        action: draftTimerAction,
        minutes: draftTimerMinutes,
        setAtMs: nowMs,
        targetMs: nowMs + draftTimerMinutes * 60 * 1000,
      });
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر إرسال أمر المؤقت للمكيف',
        tone: 'error',
      });
    }
  };

  const handleCancelAcTimer = async () => {
    setShowTimerModal(false);
    setAcTimerConfig(null);
    try {
      // إرسال إطار الحالة القياسي بدون بتات المؤقت يلغي المؤقت المبرمج داخل وحدة المكيف
      const resetPattern = buildAcIrPattern(acBrand, acState);
      await transmitIrPattern(resetPattern);
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر إلغاء مؤقت المكيف',
        tone: 'error',
      });
    }
  };

  const acMinTemp = acBrand === 'midea' ? MIDEA_MIN_TEMP : 16;
  const acMaxTemp = acBrand === 'midea' ? MIDEA_MAX_TEMP : 30;

  const currentModeObj = AC_MODES.find((m) => m.key === acState.mode);
  const currentModeLabel = currentModeObj ? currentModeObj.label : 'تبريد';

  const currentFanObj = FAN_SPEEDS.find((f) => f.key === acState.fanSpeed);
  const currentFanLabel = currentFanObj ? currentFanObj.label : 'تلقائي';

  const protocolDisplayLabel =
    wifiProtocol === 'samsung_tizen'
      ? 'Samsung Tizen'
      : wifiProtocol === 'roku'
      ? 'Roku ECP'
      : 'Android TV';

  const pairingBadgeText = wifiStatus.isConnected
    ? wifiStatus.hasSavedToken
      ? 'متصل · Token محفوظ'
      : 'متصل'
    : wifiStatus.hasSavedToken
    ? 'Token محفوظ (اتصال تلقائي)'
    : wifiStatus.pairingState === 'awaiting_approval'
    ? 'بانتظار موافقة الشاشة'
    : 'غير مقترن';

  const tvMetrics = computeTvLayoutMetrics(
    tvAreaSize.width || fallbackScreenW,
    tvAreaSize.height || Math.max(400, fallbackScreenH - 190)
  );
  const acMetrics = computeAcLayoutMetrics(
    acAreaSize.width || fallbackScreenW,
    acAreaSize.height || Math.max(420, fallbackScreenH - 126)
  );

  const handleTvAreaLayout = (event) => {
    const layout = event && event.nativeEvent && event.nativeEvent.layout;
    if (!layout || layout.width <= 0 || layout.height <= 0) return;
    setTvAreaSize((prev) =>
      Math.abs(prev.width - layout.width) < 2 && Math.abs(prev.height - layout.height) < 2
        ? prev
        : { width: layout.width, height: layout.height }
    );
  };

  const handleAcAreaLayout = (event) => {
    const layout = event && event.nativeEvent && event.nativeEvent.layout;
    if (!layout || layout.width <= 0 || layout.height <= 0) return;
    setAcAreaSize((prev) =>
      Math.abs(prev.width - layout.width) < 2 && Math.abs(prev.height - layout.height) < 2
        ? prev
        : { width: layout.width, height: layout.height }
    );
  };

  const tvHeaderElement = (
    <View
      style={[
        styles.sectionStack,
        {
          gap: tvMetrics.stackGap,
          flexGrow: tvMetrics.needsScroll ? 0 : 1,
          justifyContent: tvMetrics.needsScroll ? 'flex-start' : 'space-between',
        },
      ]}
    >
      <View style={styles.segmentBox}>
        <TouchableOpacity
          style={[
            styles.segmentBtn,
            { minHeight: tvMetrics.segmentBtnH },
            tvTransport === 'ir' && styles.segmentIrActive,
          ]}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
          onPress={() => setTvTransport('ir')}
        >
          <Text style={[styles.segmentText, { fontSize: tvMetrics.segmentFontSize }]}>
            أشعة IR (38kHz)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segmentBtn,
            { minHeight: tvMetrics.segmentBtnH },
            tvTransport === 'wifi' && styles.segmentWifiActive,
          ]}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
          onPress={() => setTvTransport('wifi')}
        >
          <Text style={[styles.segmentText, { fontSize: tvMetrics.segmentFontSize }]}>
            واي فاي (Smart TV)
          </Text>
        </TouchableOpacity>
      </View>

      {tvTransport === 'wifi' && isConnectingWifi ? (
        <View style={styles.connectingInlineRow}>
          <ActivityIndicator size="small" color="#0EA5E9" />
          <Text style={styles.connectingInlineText}>
            جاري الاتصال بـ {tvIp}:{tvPort}...
          </Text>
        </View>
      ) : null}

      <View style={[styles.rowGap, { gap: tvMetrics.rowGap }]}>
        <TouchableOpacity
          style={[
            styles.powerBtn,
            { minHeight: tvMetrics.powerBtnH },
            isPowerHolding && styles.powerBtnHolding,
          ]}
          activeOpacity={0.85}
          onPressIn={handlePowerPressIn}
          onPressOut={handlePowerPressOut}
          accessibilityLabel="طاقة التلفاز (اضغط مطولاً)"
        >
          <Text
            style={[
              styles.btnTextBold,
              { fontSize: powerHintText ? Math.max(11, tvMetrics.btnBoldFontSize - 2) : tvMetrics.btnBoldFontSize },
            ]}
            numberOfLines={1}
          >
            {isPowerHolding ? 'تأكيد...' : powerHintText || 'طاقة'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { minHeight: tvMetrics.powerBtnH }]}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
          onPress={() => handleTvCommand('INPUT')}
        >
          <Text style={[styles.btnText, { fontSize: tvMetrics.btnFontSize }]}>
            المصدر
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { minHeight: tvMetrics.powerBtnH }]}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
          onPress={() => handleTvCommand('MUTE')}
        >
          <Text style={[styles.btnText, { fontSize: tvMetrics.btnFontSize }]}>
            كتم
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.dpadCircle,
          {
            width: tvMetrics.dpadSize,
            height: tvMetrics.dpadSize,
            borderRadius: tvMetrics.dpadSize / 2,
          },
        ]}
      >
        {activeDpadDir && DPAD_WEDGE_ROTATION[activeDpadDir] ? (
          <View
            pointerEvents="none"
            style={[
              styles.dpadWedgeOverlay,
              {
                borderTopWidth: tvMetrics.dpadWedgeBorder,
                borderRightWidth: tvMetrics.dpadWedgeBorder,
                borderBottomWidth: tvMetrics.dpadWedgeBorder,
                borderLeftWidth: tvMetrics.dpadWedgeBorder,
                transform: [{ rotate: DPAD_WEDGE_ROTATION[activeDpadDir] }],
              },
            ]}
          />
        ) : null}

        <DpadRingControl
          style={styles.dpadTouchRing}
          centerOffset={tvMetrics.dpadCenterOffset}
          minRepeatCycleMs={tvTransport === 'wifi' ? 45 : 95}
          initialDelayMs={tvTransport === 'wifi' ? 180 : 150}
          onActiveChange={(dir) => setActiveDpadDir(dir)}
          onDirectionAction={(dir, { isRepeat }) =>
            handleTvCommand(dir, { burstFrames: isRepeat ? 1 : 2 })
          }
          onHoldStart={(dir) => handleStartWifiHold(dir)}
          onHoldEnd={(dir) => handleEndWifiHold(dir)}
        />

        <View
          style={[styles.dpadDotsLayer, { paddingVertical: tvMetrics.dpadDotPad }]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.dpadDot,
              {
                width: tvMetrics.dpadDotSize,
                height: tvMetrics.dpadDotSize,
                borderRadius: tvMetrics.dpadDotSize / 2,
              },
              activeDpadDir === 'UP' && styles.dpadDotActive,
            ]}
          />
          <View
            style={[
              styles.dpadDotsMiddleRow,
              { paddingHorizontal: tvMetrics.dpadDotPad },
            ]}
          >
            <View
              style={[
                styles.dpadDot,
                {
                  width: tvMetrics.dpadDotSize,
                  height: tvMetrics.dpadDotSize,
                  borderRadius: tvMetrics.dpadDotSize / 2,
                },
                activeDpadDir === 'LEFT' && styles.dpadDotActive,
              ]}
            />
            <View
              style={[
                styles.dpadDot,
                {
                  width: tvMetrics.dpadDotSize,
                  height: tvMetrics.dpadDotSize,
                  borderRadius: tvMetrics.dpadDotSize / 2,
                },
                activeDpadDir === 'RIGHT' && styles.dpadDotActive,
              ]}
            />
          </View>
          <View
            style={[
              styles.dpadDot,
              {
                width: tvMetrics.dpadDotSize,
                height: tvMetrics.dpadDotSize,
                borderRadius: tvMetrics.dpadDotSize / 2,
              },
              activeDpadDir === 'DOWN' && styles.dpadDotActive,
            ]}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.dpadOkBtn,
            {
              width: tvMetrics.dpadOkSize,
              height: tvMetrics.dpadOkSize,
              borderRadius: tvMetrics.dpadOkSize / 2,
            },
            activeDpadDir === 'OK' && styles.dpadOkBtnActive,
          ]}
          activeOpacity={0.85}
          onPressIn={() => {
            HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
            setActiveDpadDir('OK');
          }}
          onPressOut={() => setActiveDpadDir(null)}
          onPress={() => handleTvCommand('OK')}
        >
          <Text style={[styles.dpadOkText, { fontSize: tvMetrics.dpadOkFontSize }]}>
            موافق
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.rowGap, { gap: tvMetrics.rowGap }]}>
        <TouchableOpacity
          style={[styles.navBtn, { minHeight: tvMetrics.navBtnH }]}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
          onPress={() => handleTvCommand('BACK')}
        >
          <Text style={[styles.btnText, { fontSize: tvMetrics.btnFontSize }]}>رجوع</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, { minHeight: tvMetrics.navBtnH }]}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
          onPress={() => handleTvCommand('HOME')}
        >
          <Text style={[styles.btnText, { fontSize: tvMetrics.btnFontSize }]}>
            الرئيسية
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, { minHeight: tvMetrics.navBtnH }]}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
          onPress={() => handleTvCommand('MENU')}
        >
          <Text style={[styles.btnText, { fontSize: tvMetrics.btnFontSize }]}>
            القائمة
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.rowGap, { gap: tvMetrics.rowGap }]}>
        <View
          style={[
            styles.rockerCard,
            { padding: tvMetrics.rockerPad, gap: tvMetrics.rockerGap },
          ]}
        >
          <RepeatableButton
            style={[styles.rockerKey, { minHeight: tvMetrics.rockerKeyH }]}
            minRepeatCycleMs={tvTransport === 'wifi' ? 45 : 85}
            initialDelayMs={tvTransport === 'wifi' ? 180 : 150}
            onAction={({ isRepeat }) =>
              handleTvCommand('VOL_UP', { burstFrames: isRepeat ? 1 : 2 })
            }
            onHoldStart={() => handleStartWifiHold('VOL_UP')}
            onHoldEnd={() => handleEndWifiHold('VOL_UP')}
          >
            <Text style={[styles.rockerSymbol, { fontSize: tvMetrics.rockerSymbolSize }]}>
              +
            </Text>
          </RepeatableButton>
          <Text style={[styles.rockerLabel, { fontSize: tvMetrics.rockerLabelSize }]}>
            الصوت
          </Text>
          <RepeatableButton
            style={[styles.rockerKey, { minHeight: tvMetrics.rockerKeyH }]}
            minRepeatCycleMs={tvTransport === 'wifi' ? 45 : 85}
            initialDelayMs={tvTransport === 'wifi' ? 180 : 150}
            onAction={({ isRepeat }) =>
              handleTvCommand('VOL_DOWN', { burstFrames: isRepeat ? 1 : 2 })
            }
            onHoldStart={() => handleStartWifiHold('VOL_DOWN')}
            onHoldEnd={() => handleEndWifiHold('VOL_DOWN')}
          >
            <Text style={[styles.rockerSymbol, { fontSize: tvMetrics.rockerSymbolSize }]}>
              −
            </Text>
          </RepeatableButton>
        </View>

        <View
          style={[
            styles.rockerCard,
            { padding: tvMetrics.rockerPad, gap: tvMetrics.rockerGap },
          ]}
        >
          <RepeatableButton
            style={[styles.rockerKey, { minHeight: tvMetrics.rockerKeyH }]}
            minRepeatCycleMs={tvTransport === 'wifi' ? 45 : 85}
            initialDelayMs={tvTransport === 'wifi' ? 180 : 150}
            onAction={({ isRepeat }) =>
              handleTvCommand('CH_UP', { burstFrames: isRepeat ? 1 : 2 })
            }
            onHoldStart={() => handleStartWifiHold('CH_UP')}
            onHoldEnd={() => handleEndWifiHold('CH_UP')}
          >
            <Text style={[styles.rockerSymbol, { fontSize: tvMetrics.rockerSymbolSize }]}>
              ▲
            </Text>
          </RepeatableButton>
          <Text style={[styles.rockerLabel, { fontSize: tvMetrics.rockerLabelSize }]}>
            القناة
          </Text>
          <RepeatableButton
            style={[styles.rockerKey, { minHeight: tvMetrics.rockerKeyH }]}
            minRepeatCycleMs={tvTransport === 'wifi' ? 45 : 85}
            initialDelayMs={tvTransport === 'wifi' ? 180 : 150}
            onAction={({ isRepeat }) =>
              handleTvCommand('CH_DOWN', { burstFrames: isRepeat ? 1 : 2 })
            }
            onHoldStart={() => handleStartWifiHold('CH_DOWN')}
            onHoldEnd={() => handleEndWifiHold('CH_DOWN')}
          >
            <Text style={[styles.rockerSymbol, { fontSize: tvMetrics.rockerSymbolSize }]}>
              ▼
            </Text>
          </RepeatableButton>
        </View>
      </View>
    </View>
  );

  const isSearchPageOpen = isTvSearchAvailable && isSearchInputOpen;
  const trimmedSearchQuery = searchQuery.trim();
  const smartSearchInput = parseSmartSearchInput(trimmedSearchQuery);
  const matchingSearchHistory = trimmedSearchQuery
    ? searchHistory.filter((item) =>
        item.toLowerCase().includes(trimmedSearchQuery.toLowerCase())
      )
    : searchHistory;
  const visibleSearchResults = filterSearchResults(searchResults, searchFilter);
  const favoriteVideoIdsSet = new Set(favoriteVideos.map((v) => v.videoId));

  // جلب تلقائي لصفحات إضافية (بحد أقصى 3 صفحات) عند تصفية النتائج على الواجهة وظهور عدد قليل
  useEffect(() => {
    if (
      !isSearchPageOpen ||
      smartSearchInput.type !== 'query' ||
      !hasSearchedOnce ||
      isSearching ||
      isLoadingMore ||
      !searchPagination.hasMore ||
      searchFilter === 'all' ||
      visibleSearchResults.length >= 8 ||
      autoFilterPagesRef.current >= 3
    ) {
      return;
    }

    autoFilterPagesRef.current += 1;
    if (loadMoreHandlerRef.current) {
      loadMoreHandlerRef.current();
    }
  }, [
    isSearchPageOpen,
    smartSearchInput.type,
    hasSearchedOnce,
    isSearching,
    isLoadingMore,
    searchPagination.hasMore,
    searchFilter,
    visibleSearchResults.length,
  ]);

  // مراقبة التمرير اللانهائي عبر IntersectionObserver (rootMargin: 300px) على الويب
  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      typeof IntersectionObserver === 'undefined' ||
      !isSearchPageOpen ||
      smartSearchInput.type !== 'query' ||
      visibleSearchResults.length === 0 ||
      !searchPagination.hasMore
    ) {
      return undefined;
    }

    const sentinelEl = bottomSentinelRef.current;
    if (!sentinelEl) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          if (loadMoreHandlerRef.current) {
            loadMoreHandlerRef.current();
          }
        }
      },
      {
        root: searchListRef.current || null,
        rootMargin: '300px',
        threshold: 0,
      }
    );

    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [
    isSearchPageOpen,
    smartSearchInput.type,
    visibleSearchResults.length,
    searchPagination.hasMore,
  ]);

  const renderVideoItem = ({ item }) => {
    const isCasting = castingVideoId === item.videoId;
    const wasCasted = lastCastedVideoId === item.videoId && !isCasting;
    const isFavorite = favoriteVideoIdsSet.has(item.videoId);
    const statsLabel = [item.viewCountText, item.publishedText]
      .filter(Boolean)
      .join(' · ');

    return (
      <View style={[styles.videoCard, (isCasting || wasCasted) && styles.videoCardActive]}>
        <TouchableOpacity
          style={styles.videoCardMainTap}
          activeOpacity={0.78}
          onPress={() => handleCastVideo(item)}
          disabled={Boolean(castingVideoId)}
        >
          <View style={styles.videoThumbWrap}>
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.videoThumb}
              resizeMode="cover"
            />
            {item.isLive ? (
              <View style={styles.videoLiveBadge}>
                <Text style={styles.videoLiveBadgeText}>مباشر</Text>
              </View>
            ) : item.durationText ? (
              <View style={styles.videoDurationBadge}>
                <Text style={styles.videoDurationBadgeText}>{item.durationText}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.videoInfo}>
            <Text dir="auto" style={styles.videoTitle} numberOfLines={2}>
              {item.title}
            </Text>

            <Text dir="auto" style={styles.videoChannel} numberOfLines={1}>
              {item.channelTitle}
            </Text>

            <View style={styles.videoActionRow}>
              <Text style={styles.videoCastLabel}>
                {isCasting
                  ? 'جاري التشغيل...'
                  : wasCasted
                  ? 'تم التشغيل'
                  : '▶ تشغيل'}
              </Text>
              {statsLabel ? (
                <Text style={styles.videoStatsText} numberOfLines={1}>
                  {statsLabel}
                </Text>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.videoStarBtn}
          activeOpacity={0.7}
          onPress={(e) => handleToggleFavoriteVideo(item, e)}
          accessibilityLabel={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
        >
          <Text style={[styles.videoStarGlyph, isFavorite && styles.videoStarGlyphActive]}>
            {isFavorite ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const handlePickQuickCastSubtitle = async () => {
    setQuickCastErrorText('');
    try {
      const picked = await CastProxyService.pickLocalSubtitle();
      if (!picked || !picked.uri) return;
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CLICK);
      setQuickCastSubtitleUri(picked.uri);
      setQuickCastSubtitleName(picked.name || inferMovieTitleFromUrl(picked.uri, 'ترجمة.srt'));
      setQuickCastSubtitleOffsetMs(0);
      if (quickCastSession && quickCastSession.sessionId) {
        const updated = await CastProxyService.updateSessionSubtitle(
          quickCastSession.sessionId,
          picked.uri,
          0
        );
        setQuickCastSession(updated);
        setQuickCastStatusText('تم إرفاق الترجمة وحقنها في البروكسي المحلي.');
      }
    } catch (error) {
      setQuickCastErrorText(
        error && error.message ? error.message : 'تعذر اختيار ملف الترجمة.'
      );
    }
  };

  const handleRemoveQuickCastSubtitle = async () => {
    setQuickCastSubtitleUri('');
    setQuickCastSubtitleName('');
    setQuickCastSubtitleOffsetMs(0);
    if (quickCastSession && quickCastSession.sessionId) {
      try {
        const updated = await CastProxyService.updateSessionSubtitle(
          quickCastSession.sessionId,
          null,
          0
        );
        setQuickCastSession(updated);
        setQuickCastStatusText('تمت إزالة الترجمة من جلسة البث.');
      } catch (_) {}
    }
  };

  const handleShiftQuickCastSubtitleOffset = async (deltaMs) => {
    const nextOffset = Math.max(-60000, Math.min(60000, quickCastSubtitleOffsetMs + deltaMs));
    setQuickCastSubtitleOffsetMs(nextOffset);
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    if (quickCastSession && quickCastSession.sessionId && quickCastSubtitleUri) {
      try {
        const updated = await CastProxyService.updateSessionSubtitle(
          quickCastSession.sessionId,
          quickCastSubtitleUri,
          nextOffset
        );
        setQuickCastSession(updated);
      } catch (_) {}
    }
  };

  const handleStartQuickCastToDlna = async () => {
    if (!quickCastSourceUrl.trim()) {
      setQuickCastErrorText('أدخل رابط الفيديو أولاً.');
      return;
    }
    setQuickCastBusy(true);
    setQuickCastErrorText('');
    setQuickCastStatusText('جاري تشغيل خادم البروكسي المحلي وتجاوز حماية 403...');
    try {
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CLICK);
      let session = await CastProxyService.startProxySession(
        quickCastSourceUrl,
        quickCastHeaders,
        quickCastTitle,
        quickCastSubtitleUri || null
      );
      if (quickCastSubtitleUri && quickCastSubtitleOffsetMs !== 0 && session && session.sessionId) {
        session = await CastProxyService.updateSessionSubtitle(
          session.sessionId,
          quickCastSubtitleUri,
          quickCastSubtitleOffsetMs
        );
      }
      setQuickCastSession(session);
      setQuickCastStatusText('جاري إرسال الرابط المحلي إلى مشغّل سامسونج (DLNA)...');

      const targetIp = (quickCastTargetIp || tvIp || '').trim();
      const castResult = await CastProxyService.castSessionToDlna(
        targetIp || null,
        session.proxyStreamUrl,
        quickCastTitle || 'فيلم مباشر',
        session.proxySubtitleUrl || null,
        quickCastMimeType
      );
      const deviceLabel =
        (castResult && (castResult.deviceName || castResult.deviceIp)) ||
        targetIp ||
        'التلفاز';
      setQuickCastStatusText(`جاري البث الآن عبر البروكسي إلى ${deviceLabel}`);
      clearErrorBanner();
    } catch (error) {
      setQuickCastErrorText(
        error && error.message
          ? error.message
          : 'تعذر بدء البث عبر البروكسي المحلي.'
      );
      setQuickCastStatusText('');
    } finally {
      setQuickCastBusy(false);
    }
  };

  const handleStopQuickCast = async () => {
    setQuickCastBusy(true);
    setQuickCastErrorText('');
    if (autoNextTimerRef.current) {
      clearInterval(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNextCountdown(null);
    try {
      await CastProxyService.sendReceiverCommand('stop', {}).catch(() => {});
      await CastProxyService.stopProxySession();
      setQuickCastSession(null);
      setCinemaSession(null);
      setQuickCastStatusText('تم إيقاف البث والخادم المحلي.');
      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    } catch (error) {
      setQuickCastErrorText(
        error && error.message ? error.message : 'تعذر إيقاف البث.'
      );
    } finally {
      setQuickCastBusy(false);
    }
  };

  const handleUpdateSubtitleStyle = async (partial) => {
    try {
      const updated = await CinemaStorageService.saveSubtitleStyle(partial);
      setSubtitleStyle(updated);
      subtitleStyleRef.current = updated;
      await CastProxyService.sendReceiverCommand('setSubtitleStyle', updated).catch(() => {});
      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    } catch (_) {}
  };
  updateSubtitleStyleRef.current = handleUpdateSubtitleStyle;

  const startWebReceiverCast = async (
    mediaItem,
    { startPositionSec = 0, launchTv = true, openCinemaModal = true } = {}
  ) => {
    const rawUrl = String((mediaItem && mediaItem.url) || '').trim();
    if (!rawUrl) {
      throw new Error('أدخل رابط الفيديو أولاً.');
    }
    const cleanTitle =
      String((mediaItem && mediaItem.title) || '').trim() ||
      inferMovieTitleFromUrl(rawUrl, 'عرض سينمائي');
    const headers =
      mediaItem && mediaItem.headers && typeof mediaItem.headers === 'object'
        ? mediaItem.headers
        : {};
    const mimeType =
      (mediaItem && mediaItem.mimeType) || guessMimeTypeFromUrl(rawUrl);
    const subUri = String((mediaItem && mediaItem.subtitleUrl) || '').trim();
    const subName = String((mediaItem && mediaItem.subtitleName) || '').trim();

    if (autoNextTimerRef.current) {
      clearInterval(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNextCountdown(null);
    lastEndedSessionRef.current = '';
    lastResumeSaveMsRef.current = 0;

    let session = await CastProxyService.startProxySession(
      rawUrl,
      headers,
      cleanTitle,
      subUri || null
    );
    const offsetMs = Math.round((Number((subtitleStyleRef.current || {}).offsetSec) || 0) * 1000);
    if (subUri && offsetMs !== 0 && session && session.sessionId) {
      session = await CastProxyService.updateSessionSubtitle(
        session.sessionId,
        subUri,
        offsetMs
      );
    }
    const info = await CastProxyService.getServerInfo().catch(() => null);
    const receiverUrl =
      (info && info.receiverUrl) ||
      (session && session.lanIp ? `http://${session.lanIp}:${session.port}/tv` : '');
    if (receiverUrl) setServerUrl(receiverUrl);

    await CastProxyService.sendReceiverCommand('load', {
      sessionId: session.sessionId,
      streamUrl: session.proxyStreamUrl,
      subtitleUrl: session.proxySubtitleVttUrl || '',
      title: cleanTitle,
      mimeType,
      startPositionSec: Math.max(0, Number(startPositionSec) || 0),
    });
    await CastProxyService.sendReceiverCommand('setSubtitleStyle', subtitleStyleRef.current || DEFAULT_SUBTITLE_STYLE);

    const activeCinema = {
      sessionId: session.sessionId,
      title: cleanTitle,
      sourceUrl: rawUrl,
      mimeType,
      headers,
      subtitleUri: subUri,
      subtitleName: subName || (subUri ? inferMovieTitleFromUrl(subUri, 'ترجمة') : ''),
      proxyStreamUrl: session.proxyStreamUrl,
      proxySubtitleVttUrl: session.proxySubtitleVttUrl || '',
      receiverUrl,
    };
    setQuickCastSession(session);
    setCinemaSession(activeCinema);
    cinemaSessionRef.current = activeCinema;

    if (launchTv) {
      try {
        await WifiControl.launchWebReceiverOnTv(receiverUrl);
        setCinemaNotice('تم إرسال البث وفتح مشغّل السينما على متصفح الشاشة.');
      } catch (_) {
        setCinemaNotice(`افتح الرابط ${receiverUrl} على متصفح التلفاز أو اضغط "فتح على الشاشة".`);
      }
    } else {
      setCinemaNotice(`جاري عرض: ${cleanTitle}`);
    }

    if (openCinemaModal) {
      setQuickCastModalVisible(false);
      setCinemaTab('control');
      setCinemaModalVisible(true);
    }
    return activeCinema;
  };
  startWebReceiverCastRef.current = startWebReceiverCast;

  const handleStartQuickCastToWebReceiver = async () => {
    if (!quickCastSourceUrl.trim()) {
      setQuickCastErrorText('أدخل رابط الفيديو أولاً.');
      return;
    }
    setQuickCastBusy(true);
    setQuickCastErrorText('');
    setQuickCastStatusText('جاري تجهيز البروكسي ومشغّل السينما الذكي (/tv)...');
    try {
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      const startSec =
        quickCastResumeMatch && quickCastUseResume
          ? Number(quickCastResumeMatch.positionSec) || 0
          : 0;
      await startWebReceiverCast(
        {
          url: quickCastSourceUrl,
          title: quickCastTitle,
          headers: quickCastHeaders,
          mimeType: quickCastMimeType,
          subtitleUrl: quickCastSubtitleUri,
          subtitleName: quickCastSubtitleName,
        },
        { startPositionSec: startSec, launchTv: true, openCinemaModal: true }
      );
      clearErrorBanner();
    } catch (error) {
      setQuickCastErrorText(
        error && error.message ? error.message : 'تعذر بدء مشغّل السينما الذكي.'
      );
    } finally {
      setQuickCastBusy(false);
    }
  };

  const handleEnqueueFromQuickCast = async () => {
    if (!quickCastSourceUrl.trim()) {
      setQuickCastErrorText('أدخل رابط الفيديو أولاً.');
      return;
    }
    try {
      const nextQ = await CinemaStorageService.enqueueEpisode({
        url: quickCastSourceUrl,
        title: quickCastTitle || inferMovieTitleFromUrl(quickCastSourceUrl, 'حلقة'),
        mimeType: quickCastMimeType,
        headers: quickCastHeaders,
        subtitleUrl: quickCastSubtitleUri,
        subtitleName: quickCastSubtitleName,
      });
      setCinemaQueue(nextQ);
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      setQuickCastStatusText(`تمت الإضافة لقائمة الحلقات (${nextQ.length}).`);
    } catch (_) {}
  };

  const handlePlayNextFromQueue = async () => {
    try {
      const { nextItem, queue } = await CinemaStorageService.shiftQueueNext();
      setCinemaQueue(queue);
      cinemaQueueRef.current = queue;
      if (!nextItem) return;
      await startWebReceiverCast(nextItem, {
        startPositionSec: 0,
        launchTv: false,
        openCinemaModal: false,
      });
    } catch (err) {
      setCinemaNotice(
        err && err.message ? err.message : 'تعذر تشغيل الحلقة التالية من القائمة.'
      );
    }
  };
  playNextEpisodeRef.current = handlePlayNextFromQueue;

  const handleCancelAutoNext = () => {
    if (autoNextTimerRef.current) {
      clearInterval(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNextCountdown(null);
    CastProxyService.sendReceiverCommand('cancelCountdown', {}).catch(() => {});
  };

  const handleOpenSmartBrowser = async (initialUrl = '') => {
    try {
      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
      const res = await CastProxyService.openSmartBrowser(initialUrl);
      if (!res || !res.video || !res.video.url) return;
      const vid = res.video;
      const sub = res.subtitle && res.subtitle.url ? res.subtitle : null;
      if (res.mode === 'queue') {
        const nextQ = await CinemaStorageService.enqueueEpisode({
          url: vid.url,
          title: vid.title || inferMovieTitleFromUrl(vid.url, 'حلقة ملتقطة'),
          mimeType: vid.mimeType || guessMimeTypeFromUrl(vid.url),
          headers: vid.headers || {},
          subtitleUrl: sub ? sub.url : '',
          subtitleName: sub ? sub.title || 'ترجمة ملتقطة' : '',
        });
        setCinemaQueue(nextQ);
        setCinemaNotice(`تمت إضافة "${vid.title || 'الفيديو'}" إلى قائمة الانتظار (${nextQ.length}).`);
        setCinemaTab('queue');
        setCinemaModalVisible(true);
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      } else {
        openQuickCastSheet({
          url: vid.url,
          title: vid.title,
          mimeType: vid.mimeType,
          headers: vid.headers || {},
          subtitleUrl: sub ? sub.url : '',
          subtitleName: sub ? sub.title : '',
        });
      }
    } catch (error) {
      if (error && (error.code === 'BROWSER_CANCELLED' || error.code === 'SNIFFER_CANCELLED')) {
        return;
      }
      setFeedback({
        text:
          error && error.message
            ? error.message
            : 'تعذر فتح متصفح الصيد الذكي.',
        tone: 'error',
      });
    }
  };

  const handleCinemaCommand = async (type, payload = {}) => {
    try {
      await CastProxyService.sendReceiverCommand(type, payload);
    } catch (error) {
      setCinemaNotice(
        error && error.message ? error.message : 'تعذر إرسال الأمر لمشغّل السينما.'
      );
    }
  };

  const handlePickCinemaSubtitle = async () => {
    try {
      const picked = await CastProxyService.pickLocalSubtitle();
      if (!picked || !picked.uri) return;
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      const subName = picked.name || inferMovieTitleFromUrl(picked.uri, 'ترجمة.srt');
      if (cinemaSession && cinemaSession.sessionId) {
        const offsetMs = Math.round((Number(subtitleStyle.offsetSec) || 0) * 1000);
        const updated = await CastProxyService.updateSessionSubtitle(
          cinemaSession.sessionId,
          picked.uri,
          offsetMs
        );
        setCinemaSession((prev) =>
          prev
            ? {
                ...prev,
                subtitleUri: picked.uri,
                subtitleName: subName,
                proxySubtitleVttUrl: updated.proxySubtitleVttUrl || '',
              }
            : prev
        );
        setCinemaNotice(`تم بث الترجمة العربية فوراً: ${subName}`);
      } else {
        setQuickCastSubtitleUri(picked.uri);
        setQuickCastSubtitleName(subName);
        setCinemaNotice(`تم اختيار الترجمة: ${subName}`);
      }
    } catch (error) {
      setCinemaNotice(
        error && error.message ? error.message : 'تعذر اختيار ملف الترجمة.'
      );
    }
  };

  const handleRemoveCinemaSubtitle = async () => {
    if (!cinemaSession || !cinemaSession.sessionId) return;
    try {
      await CastProxyService.updateSessionSubtitle(cinemaSession.sessionId, null, 0);
      setCinemaSession((prev) =>
        prev ? { ...prev, subtitleUri: '', subtitleName: '', proxySubtitleVttUrl: '' } : prev
      );
      setCinemaNotice('تمت إزالة الترجمة من المشغّل.');
    } catch (_) {}
  };

  const handleLaunchReceiverOnTv = async () => {
    setCinemaBusyAction(true);
    try {
      let targetUrl = serverUrl || (cinemaSession && cinemaSession.receiverUrl) || '';
      if (!targetUrl) {
        const info = await CastProxyService.getServerInfo();
        targetUrl = info && info.receiverUrl ? info.receiverUrl : '';
        if (targetUrl) setServerUrl(targetUrl);
      }
      await WifiControl.launchWebReceiverOnTv(targetUrl);
      setCinemaNotice('تم فتح صفحة مشغّل السينما (/tv) على متصفح الشاشة.');
    } catch (error) {
      setCinemaNotice(
        error && error.message
          ? error.message
          : 'تعذر فتح متصفح الشاشة تلقائياً؛ يمكنك نسخ الرابط وفتحه يدوياً.'
      );
    } finally {
      setCinemaBusyAction(false);
    }
  };

  const handleCopyReceiverUrl = async () => {
    try {
      let targetUrl = serverUrl || (cinemaSession && cinemaSession.receiverUrl) || '';
      if (!targetUrl) {
        const info = await CastProxyService.getServerInfo();
        targetUrl = info && info.receiverUrl ? info.receiverUrl : '';
        if (targetUrl) setServerUrl(targetUrl);
      }
      if (!targetUrl) return;
      await CastProxyService.copyToClipboard(targetUrl);
      setCinemaNotice(`تم نسخ الرابط: ${targetUrl}`);
    } catch (_) {}
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0D11" />

      <View style={styles.header}>
        {isTvSearchAvailable && isSearchInputOpen ? (
          <View style={styles.headerSearchRow}>
            <TouchableOpacity
              style={styles.headerBackBtn}
              activeOpacity={0.75}
              onPress={handleCloseSearch}
              accessibilityLabel="إغلاق البحث"
            >
              <Text style={styles.headerBackGlyph}>✕</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.headerSearchInput}
              value={searchQuery}
              onChangeText={handleSearchQueryChange}
              placeholder="ابحث في يوتيوب أو الصق رابطاً..."
              placeholderTextColor="#64748B"
              returnKeyType="search"
              autoFocus
              onSubmitEditing={() => {
                if (smartSearchInput.type === 'youtube_url') {
                  handleCastVideo({
                    videoId: smartSearchInput.videoId,
                    title: 'تشغيل من رابط يوتيوب',
                    channelTitle: 'YouTube',
                    thumbnailUrl: `https://i.ytimg.com/vi/${smartSearchInput.videoId}/mqdefault.jpg`,
                  });
                } else if (smartSearchInput.type === 'web_url') {
                  handleOpenUrlOnTv(smartSearchInput.url);
                } else {
                  handleSearchYouTube(undefined, { saveHistory: true });
                }
              }}
            />

            {searchQuery.length > 0 ? (
              <TouchableOpacity
                style={styles.headerClearBtn}
                activeOpacity={0.75}
                onPress={handleClearSearchText}
                accessibilityLabel="مسح النص"
              >
                <Text style={styles.headerClearGlyph}>⌫</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <>
            <View style={[styles.headerBrandGroup, fallbackScreenW < 360 && styles.headerBrandGroupCompact]}>
              <Text
                style={[
                  styles.headerTitle,
                  fallbackScreenW < 360 ? { fontSize: 16 } : null,
                ]}
              >
                الريموت الشامل
              </Text>
              {isTvSearchAvailable ? (
                <>
                  <TouchableOpacity
                    style={[
                      styles.headerSearchIconBtn,
                      voiceSession.phase === 'listening' && styles.headerMicActiveBtn,
                    ]}
                    activeOpacity={0.75}
                    onPress={handleVoiceMicPress}
                    accessibilityLabel="الريموت الصوتي بالعامية المصرية"
                  >
                    <MicIcon
                      color={voiceSession.phase === 'listening' ? '#38BDF8' : '#F1F5F9'}
                      size={18}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.headerSearchIconBtn}
                    activeOpacity={0.75}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                    onPress={handleOpenSearch}
                    accessibilityLabel="بحث"
                  >
                    <SearchIcon color="#F1F5F9" size={20} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.headerSearchIconBtn,
                      (cinemaSession || cinemaQueue.length > 0) && styles.headerHapticsActiveBtn,
                    ]}
                    activeOpacity={0.75}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                    onPress={() => setCinemaModalVisible(true)}
                    accessibilityLabel="لوحة مشغّل السينما الذكي"
                  >
                    <CinemaIcon
                      color={cinemaSession || cinemaQueue.length > 0 ? '#38BDF8' : '#F1F5F9'}
                      size={18}
                    />
                  </TouchableOpacity>
                </>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.headerSearchIconBtn,
                  hapticsConfig.enabled && styles.headerHapticsActiveBtn,
                ]}
                activeOpacity={0.75}
                onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                onPress={() => setShowHapticsModal(true)}
                accessibilityLabel="إعدادات الاهتزاز"
              >
                <HapticsIcon
                  color={hapticsConfig.enabled ? '#38BDF8' : '#64748B'}
                  size={18}
                />
              </TouchableOpacity>
            </View>

            {isWifiMode ? (
              <TouchableOpacity
                style={[
                  styles.headerWifiBtn,
                  { maxWidth: Math.round(fallbackScreenW * 0.36) },
                ]}
                activeOpacity={0.75}
                onPress={() => setShowWifiModal(true)}
                accessibilityLabel="إعدادات والبحث عن الشاشات"
              >
                {isConnectingWifi ? (
                  <ActivityIndicator size="small" color="#0EA5E9" />
                ) : (
                  <View
                    style={[
                      styles.statusDot,
                      wifiStatus.isConnected ? styles.statusDotOn : styles.statusDotIdle,
                    ]}
                  />
                )}
                <Text style={styles.headerWifiLabel} numberOfLines={1}>
                  {wifiStatus.deviceName || protocolDisplayLabel}
                </Text>
                <Text style={styles.headerWifiGear}>⚙</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.headerStatus}>
                {Platform.OS === 'web'
                  ? 'معاينة الويب (وضع المحاكاة)'
                  : hasIrHardware === null
                  ? 'جاري فحص IR...'
                  : hasIrHardware
                  ? 'IR Blaster جاهز'
                  : 'وضع Wi-Fi (لا يوجد IR)'}
              </Text>
            )}
          </>
        )}
      </View>

      {feedback.tone === 'error' && feedback.text ? (
        <View style={[styles.feedbackBar, styles.feedbackError]}>
          <Text style={styles.feedbackText} numberOfLines={2}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      {activeTab === 'tv' && !isSearchPageOpen && tvSleepTimer ? (
        <View style={styles.tvSleepBanner}>
          <Text style={styles.tvSleepBannerText} numberOfLines={1}>
            إغلاق الشاشة تلقائياً بعد {formatSleepRemainingClock(tvSleepTimer.remainingSeconds)}
          </Text>
          <TouchableOpacity
            style={styles.tvSleepCancelBtn}
            activeOpacity={0.75}
            onPress={() => {
              HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
              setTvSleepTimer(null);
            }}
          >
            <Text style={styles.tvSleepCancelText}>إلغاء</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {activeTab === 'tv' && !isSearchPageOpen && (cinemaSession || quickCastSession) ? (
        <View style={styles.quickCastMiniBanner}>
          <TouchableOpacity
            style={styles.quickCastMiniInfo}
            activeOpacity={0.8}
            onPress={() => {
              if (cinemaSession) {
                setCinemaModalVisible(true);
              } else {
                setQuickCastModalVisible(true);
              }
            }}
          >
            <View style={styles.quickCastMiniDot} />
            <Text dir="auto" style={styles.quickCastMiniText} numberOfLines={1}>
              {cinemaSession
                ? `السينما الذكية: ${cinemaSession.title || 'عرض نشط'}`
                : `البروكسي نشط: ${quickCastTitle || 'بث مباشر'}`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCastMiniStopBtn}
            activeOpacity={0.75}
            onPress={handleStopQuickCast}
          >
            <Text style={styles.quickCastMiniStopText}>إيقاف</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isSearchPageOpen ? (
        <View style={styles.searchPageWrap}>
          {networkNotice && networkNotice.message ? (
            <View style={styles.networkWarnBanner}>
              <Text style={styles.networkWarnText}>{networkNotice.message}</Text>
              <View style={styles.networkWarnActions}>
                <TouchableOpacity
                  style={styles.networkWarnBtn}
                  activeOpacity={0.75}
                  onPress={() => refreshNetworkStatus({ verifyLanReachability: true })}
                >
                  <Text style={styles.networkWarnBtnText}>فحص مجدداً</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.networkWarnSetupBtn}
                  activeOpacity={0.75}
                  onPress={() => setShowWifiModal(true)}
                >
                  <Text style={styles.networkWarnSetupText}>إعداد الشاشة</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {smartSearchInput.type !== 'youtube_url' && smartSearchInput.type !== 'web_url' ? (
            <View style={styles.filterBarContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterBarContent}
                keyboardShouldPersistTaps="handled"
              >
                {SEARCH_FILTER_OPTIONS.map((option) => {
                  const isActive = searchFilter === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[
                        styles.filterChip,
                        isActive && styles.filterChipActive,
                      ]}
                      activeOpacity={0.75}
                      onPress={() => handleSelectSearchFilter(option.key)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isActive && styles.filterChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {smartSearchInput.type === 'youtube_url' ? (
            <View style={styles.smartLinkWrap}>
              <View style={styles.smartLinkCard}>
                <Text style={styles.smartLinkTitle}>تم التعرّف على رابط فيديو يوتيوب</Text>
                <Text dir="ltr" style={styles.smartLinkUrl} numberOfLines={1}>
                  {smartSearchInput.url}
                </Text>
                <TouchableOpacity
                  style={styles.smartLinkYoutubeBtn}
                  activeOpacity={0.8}
                  disabled={Boolean(castingVideoId)}
                  onPress={() =>
                    handleCastVideo({
                      videoId: smartSearchInput.videoId,
                      title: 'تشغيل من رابط مباشر',
                      channelTitle: 'YouTube',
                      thumbnailUrl: `https://i.ytimg.com/vi/${smartSearchInput.videoId}/mqdefault.jpg`,
                    })
                  }
                >
                  {castingVideoId === smartSearchInput.videoId ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.smartLinkBtnText}>
                      تشغيل الرابط مباشرة على الشاشة
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : smartSearchInput.type === 'web_url' ? (
            <View style={styles.smartLinkWrap}>
              <View style={styles.smartLinkCard}>
                <Text style={styles.smartLinkTitle}>
                  {isLikelyDirectVideoUrl(smartSearchInput.url)
                    ? 'تم التعرّف على رابط فيديو جاهز للبث'
                    : 'تم التعرّف على رابط موقع ويب'}
                </Text>
                <Text dir="ltr" style={styles.smartLinkUrl} numberOfLines={1}>
                  {smartSearchInput.url}
                </Text>
                <TouchableOpacity
                  style={styles.smartLinkProxyBtn}
                  activeOpacity={0.8}
                  onPress={() =>
                    openQuickCastSheet({
                      url: smartSearchInput.url,
                      title: inferMovieTitleFromUrl(smartSearchInput.url, 'فيلم مباشر'),
                      mimeType: guessMimeTypeFromUrl(smartSearchInput.url),
                    })
                  }
                >
                  <Text style={styles.smartLinkBtnText}>
                    بث عبر البروكسي الذكي (سينما / DLNA)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smartLinkQueueBtn}
                  activeOpacity={0.8}
                  onPress={async () => {
                    const nextQ = await CinemaStorageService.enqueueEpisode({
                      url: smartSearchInput.url,
                      title: inferMovieTitleFromUrl(smartSearchInput.url, 'حلقة مباشرة'),
                      mimeType: guessMimeTypeFromUrl(smartSearchInput.url),
                    });
                    setCinemaQueue(nextQ);
                    setCinemaTab('queue');
                    setCinemaModalVisible(true);
                  }}
                >
                  <Text style={styles.smartLinkBtnText}>+ إضافة لقائمة الانتظار</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smartLinkBrowserBtn}
                  activeOpacity={0.8}
                  disabled={isOpeningBrowserUrl}
                  onPress={() => handleOpenUrlOnTv(smartSearchInput.url)}
                >
                  {isOpeningBrowserUrl ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.smartLinkBtnText}>
                      فتح الرابط في متصفح الشاشة
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : trimmedSearchQuery.length === 0 ? (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.cinemaToolsRow}>
                <TouchableOpacity
                  style={styles.cinemaToolPrimaryBtn}
                  activeOpacity={0.82}
                  onPress={() => handleOpenSmartBrowser('')}
                >
                  <Text style={styles.cinemaToolPrimaryText}>🌐 متصفح الصيد الذكي</Text>
                  <Text style={styles.cinemaToolSubText}>صيد روابط MP4 / M3U8 والترجمة</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cinemaToolSecondaryBtn}
                  activeOpacity={0.82}
                  onPress={() => {
                    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                    setCinemaModalVisible(true);
                  }}
                >
                  <Text style={styles.cinemaToolPrimaryText}>🎬 لوحة السينما</Text>
                  <Text style={styles.cinemaToolSubText}>
                    الحلقات ({cinemaQueue.length}) · متابعة ({resumeList.length})
                  </Text>
                </TouchableOpacity>
              </View>

              {resumeList.length > 0 ? (
                <View style={styles.historySection}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyHeaderTitle}>متابعة المشاهدة</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setCinemaTab('queue');
                        setCinemaModalVisible(true);
                      }}
                    >
                      <Text style={styles.historyClearAllText}>عرض الكل</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.cinemaResumeRowWrap}>
                    {resumeList.slice(0, 3).map((resItem) => (
                      <TouchableOpacity
                        key={`home-res-${resItem.id}`}
                        style={styles.cinemaResumeChip}
                        activeOpacity={0.8}
                        onPress={() =>
                          startWebReceiverCast(resItem, {
                            startPositionSec: resItem.positionSec,
                            launchTv: true,
                            openCinemaModal: true,
                          }).catch(() => {})
                        }
                      >
                        <Text dir="auto" style={styles.cinemaResumeChipTitle} numberOfLines={1}>
                          {resItem.title}
                        </Text>
                        <Text style={styles.cinemaResumeChipTime}>
                          استكمال {formatSecondsHms(resItem.positionSec)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}

              {searchHistory.length > 0 ? (
                <View style={styles.historySection}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyHeaderTitle}>آخر عمليات البحث</Text>
                    <TouchableOpacity
                      onPress={handleClearAllSearchHistory}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.historyClearAllText}>مسح</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.recentChipsWrap}>
                    {searchHistory.map((term) => (
                      <View key={term} style={styles.recentSearchPill}>
                        <TouchableOpacity
                          style={styles.recentSearchPillMain}
                          activeOpacity={0.75}
                          onPress={() => handleSelectSuggestion(term)}
                        >
                          <SearchIcon color="#64748B" size={14} />
                          <Text dir="auto" style={styles.recentSearchPillText} numberOfLines={1}>
                            {term}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.recentSearchPillDelete}
                          activeOpacity={0.7}
                          onPress={() => handleRemoveSearchHistoryItem(term)}
                          accessibilityLabel={`حذف ${term}`}
                        >
                          <Text style={styles.historyDeleteGlyph}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {favoriteVideos.length > 0 ? (
                <View style={[styles.favoritesSection, searchHistory.length > 0 && styles.favoritesSectionSpaced]}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyHeaderTitle}>
                      المفضلة السريعة ({favoriteVideos.length})
                    </Text>
                  </View>
                  <View style={styles.favoritesList}>
                    {favoriteVideos.map((fav) => (
                      <View key={`fav-${fav.videoId}`} style={styles.videoSeparatorWrap}>
                        {renderVideoItem({ item: fav })}
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {searchHistory.length === 0 && favoriteVideos.length === 0 ? (
                <Text style={styles.emptySearchText}>
                  اكتب اسم الفيديو أو القناة للبحث، أو الصق رابط يوتيوب أو موقع ويب لتشغيله على الشاشة.
                </Text>
              ) : null}
            </ScrollView>
          ) : isSearching && visibleSearchResults.length === 0 ? (
            <View style={styles.searchPageWrap}>
              {matchingSearchHistory.length > 0 ? (
                <View style={styles.matchingHistoryWrap}>
                  {matchingSearchHistory.slice(0, 4).map((term) => (
                    <TouchableOpacity
                      key={`match-${term}`}
                      style={styles.matchingHistoryRow}
                      activeOpacity={0.75}
                      onPress={() => handleSelectSuggestion(term)}
                    >
                      <SearchIcon color="#0EA5E9" size={15} />
                      <Text dir="auto" style={styles.historyItemText} numberOfLines={1}>
                        {term}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <View style={styles.searchLoadingBox}>
                <ActivityIndicator size="large" color="#0EA5E9" />
                <Text style={styles.searchLoadingText}>جاري البحث في يوتيوب...</Text>
              </View>
            </View>
          ) : (
            <FlatList
              ref={searchListRef}
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              data={visibleSearchResults}
              keyExtractor={(item, index) => `${item.videoId}_${index}`}
              renderItem={renderVideoItem}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onEndReached={handleLoadMoreResults}
              onEndReachedThreshold={0.4}
              ItemSeparatorComponent={() => <View style={styles.videoSeparator} />}
              ListHeaderComponent={
                matchingSearchHistory.length > 0 &&
                matchingSearchHistory.some(
                  (term) => term.toLowerCase() !== trimmedSearchQuery.toLowerCase()
                ) ? (
                  <View style={styles.inlineAutocompleteWrap}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.inlineAutocompleteScroll}
                      keyboardShouldPersistTaps="handled"
                    >
                      {matchingSearchHistory
                        .filter(
                          (term) => term.toLowerCase() !== trimmedSearchQuery.toLowerCase()
                        )
                        .slice(0, 4)
                        .map((term) => (
                          <TouchableOpacity
                            key={`ac-${term}`}
                            style={styles.inlineAutocompleteChip}
                            activeOpacity={0.75}
                            onPress={() => handleSelectSuggestion(term)}
                          >
                            <SearchIcon color="#38BDF8" size={13} />
                            <Text dir="auto" style={styles.inlineAutocompleteText} numberOfLines={1}>
                              {term}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                !isSearching && !isLoadingMore && hasSearchedOnce && !feedback.text ? (
                  <Text style={styles.emptySearchText}>
                    {searchFilter !== 'all'
                      ? 'لا توجد نتائج مطابقة لهذا الفلتر حالياً. جرّب اختيار "الكل" أو عبارة بحث أخرى.'
                      : 'لم يتم العثور على نتائج مطابقة.'}
                  </Text>
                ) : null
              }
              ListFooterComponent={
                <View style={styles.listFooterBox}>
                  {isLoadingMore ? (
                    <View style={styles.loadMoreSpinnerWrap}>
                      <ActivityIndicator size="small" color="#0EA5E9" />
                    </View>
                  ) : null}
                  <View ref={bottomSentinelRef} style={styles.infiniteScrollSentinel} />
                </View>
              }
            />
          )}
        </View>
      ) : activeTab === 'tv' ? (
        <>
          <ScrollView
            style={styles.scrollArea}
            onLayout={handleTvAreaLayout}
            scrollEnabled={tvMetrics.needsScroll}
            contentContainerStyle={[
              styles.tvScrollContent,
              {
                paddingHorizontal: tvMetrics.hPad,
                paddingTop: tvMetrics.vPad,
                paddingBottom: tvMetrics.vPad,
                justifyContent: tvMetrics.needsScroll ? 'flex-start' : 'space-between',
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {tvHeaderElement}
          </ScrollView>

          <View
            style={[
              styles.streamingDock,
              {
                paddingHorizontal: tvMetrics.hPad,
                gap: tvMetrics.rowGap,
              },
            ]}
          >
            {tvTransport === 'wifi' ? (
              <>
                <TouchableOpacity
                  style={[styles.youtubeBtn, { minHeight: tvMetrics.streamingBtnH }]}
                  activeOpacity={0.8}
                  onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                  onPress={() => handleLaunchYouTube()}
                  disabled={isLaunchingYouTube}
                >
                  {isLaunchingYouTube ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={[styles.btnTextBold, { fontSize: tvMetrics.btnBoldFontSize }]}>
                      YouTube
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.netflixBtn, { minHeight: tvMetrics.streamingBtnH }]}
                  activeOpacity={0.8}
                  onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                  onPress={() => handleTvCommand('NETFLIX')}
                >
                  <Text style={[styles.btnTextBold, { fontSize: tvMetrics.btnBoldFontSize }]}>
                    Netflix
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ height: tvMetrics.streamingBtnH, flex: 1 }} />
            )}
          </View>
        </>
      ) : (
        <ScrollView
          style={styles.scrollArea}
          onLayout={handleAcAreaLayout}
          contentContainerStyle={[
            styles.acScrollContent,
            {
              paddingHorizontal: acMetrics.hPad,
              paddingTop: acMetrics.vPad,
              paddingBottom: acMetrics.needsScroll ? 24 : acMetrics.vPad,
              justifyContent: acMetrics.needsScroll ? 'flex-start' : 'space-between',
            },
          ]}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.acSectionStack,
              {
                gap: acMetrics.gap,
                flexGrow: acMetrics.needsScroll ? 0 : 1,
                justifyContent: acMetrics.needsScroll ? 'flex-start' : 'space-between',
              },
            ]}
          >
            <View style={[styles.acRowGap, { gap: acMetrics.rowGap }]}>
              {[
                { key: 'midea', label: 'Midea AC' },
                { key: 'gree', label: 'Gree AC' },
                { key: 'carrier', label: 'Carrier AC' },
              ].map((b) => (
                <TouchableOpacity
                  key={b.key}
                  style={[
                    styles.acBrandChip,
                    { minHeight: acMetrics.brandH },
                    acBrand === b.key && styles.chipBtnActive,
                  ]}
                  onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                  onPress={() => {
                    setAcBrand(b.key);
                    setAcTimerConfig(null);
                    if (b.key === 'midea' && acState.temperature < MIDEA_MIN_TEMP) {
                      setAcState((prev) => ({ ...prev, temperature: MIDEA_MIN_TEMP }));
                    }
                  }}
                >
                  <Text style={styles.acCompactLabel}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View
              style={[
                styles.acLcd,
                { paddingVertical: acMetrics.lcdPadV },
                !acState.power && styles.acLcdOff,
              ]}
            >
              <View style={styles.acLcdTop}>
                <Text style={styles.acMeta}>الوضع: {currentModeLabel}</Text>
                <Text style={styles.acMeta}>المروحة: {currentFanLabel}</Text>
              </View>
              <Text style={[styles.acTemp, { fontSize: acMetrics.tempFontSize }]}>
                {acState.power ? `${acState.temperature}°C` : 'OFF'}
              </Text>
              <Text style={styles.acFooter}>
                الريش: {acState.swing ? 'متحرك' : 'ثابت'}
                {acState.sleep ? ' · نوم' : ''}
                {acState.turbo ? ' · تربو' : ''}
                {' · IR 38kHz'}
                {acBrand === 'midea' ? ' · Midea' : ''}
              </Text>
              {acTimerConfig ? (
                <Text style={styles.acLcdTimerBadge}>
                  {acTimerConfig.action === 'on' ? 'مؤقت التشغيل' : 'مؤقت الإطفاء'} مبرمج:{' '}
                  {formatTargetClockLabel(acTimerConfig.minutes, acTimerConfig.setAtMs)}
                </Text>
              ) : null}
            </View>

            <View style={[styles.acRowGap, { gap: acMetrics.rowGap }]}>
              <TouchableOpacity
                style={[styles.tempStepBtn, { height: acMetrics.stepBtnH }]}
                onPressIn={() => {
                  HapticsManager.trigger(
                    acState.temperature <= acMinTemp
                      ? HAPTIC_PATTERNS.AC_LIMIT_HIT
                      : HAPTIC_PATTERNS.AC_TEMP_DOWN
                  );
                }}
                onPress={() => {
                  const nextTemp = Math.max(acMinTemp, acState.temperature - 1);
                  if (nextTemp !== acState.temperature) {
                    updateAcAndTransmit({
                      ...acState,
                      power: true,
                      temperature: nextTemp,
                    });
                  }
                }}
              >
                <Text style={styles.rockerSymbol}>−</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.acPowerBtn,
                  { height: acMetrics.stepBtnH },
                  acState.power ? styles.acPowerOn : styles.acPowerOff,
                ]}
                onPressIn={() =>
                  HapticsManager.trigger(
                    !acState.power ? HAPTIC_PATTERNS.AC_POWER_ON : HAPTIC_PATTERNS.AC_POWER_OFF
                  )
                }
                onPress={() => {
                  const nextPower = !acState.power;
                  updateAcAndTransmit({ ...acState, power: nextPower });
                }}
              >
                <Text style={styles.btnTextBold}>
                  {acState.power ? 'إطفاء' : 'تشغيل'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tempStepBtn, { height: acMetrics.stepBtnH }]}
                onPressIn={() => {
                  HapticsManager.trigger(
                    acState.temperature >= acMaxTemp
                      ? HAPTIC_PATTERNS.AC_LIMIT_HIT
                      : HAPTIC_PATTERNS.AC_TEMP_UP
                  );
                }}
                onPress={() => {
                  const nextTemp = Math.min(acMaxTemp, acState.temperature + 1);
                  if (nextTemp !== acState.temperature) {
                    updateAcAndTransmit({
                      ...acState,
                      power: true,
                      temperature: nextTemp,
                    });
                  }
                }}
              >
                <Text style={styles.rockerSymbol}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modesGrid}>
              {AC_MODES.map((m) => {
                const active = acState.mode === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[
                      styles.modeChip,
                      { minHeight: acMetrics.modeH },
                      active &&
                        (m.key === 'heat' ? styles.modeHeatActive : styles.modeCoolActive),
                    ]}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                    onPress={() =>
                      updateAcAndTransmit({ ...acState, power: true, mode: m.key })
                    }
                  >
                    <Text style={styles.acModeLabel}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.acRowGap, { gap: acMetrics.rowGap }]}>
              <TouchableOpacity
                style={[styles.extraCard, { minHeight: acMetrics.extraH }]}
                onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                onPress={() => {
                  const idx = FAN_SPEEDS.findIndex((f) => f.key === acState.fanSpeed);
                  const nextFan = FAN_SPEEDS[(idx + 1) % FAN_SPEEDS.length];
                  updateAcAndTransmit({
                    ...acState,
                    power: true,
                    fanSpeed: nextFan.key,
                  });
                }}
              >
                <Text style={styles.extraCaption}>سرعة المروحة</Text>
                <Text style={styles.btnText}>{currentFanLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.extraCard, { minHeight: acMetrics.extraH }]}
                onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                onPress={() => {
                  const nextSwing = !acState.swing;
                  updateAcAndTransmit(
                    { ...acState, power: true, swing: nextSwing },
                    { isSwingToggle: true }
                  );
                }}
              >
                <Text style={styles.extraCaption}>تأرجح الريش</Text>
                <Text style={styles.btnText}>
                  {acState.swing ? 'يعمل' : 'متوقف'}
                </Text>
              </TouchableOpacity>
            </View>

            {acBrand === 'midea' ? (
              <>
                <View style={styles.acFeatureGrid}>
                  <TouchableOpacity
                    style={[
                      styles.acFeatureBtn,
                      { minHeight: acMetrics.featureH },
                      acState.turbo && styles.modeCoolActive,
                    ]}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                    onPress={() =>
                      updateAcAndTransmit(
                        { ...acState, power: true, turbo: !acState.turbo },
                        { specialCommand: 'turbo' }
                      )
                    }
                  >
                    <Text style={styles.acFeatureTitle}>تربو</Text>
                    <Text style={styles.acTinyState}>
                      {acState.turbo ? 'مفعّل' : 'Turbo'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.acFeatureBtn,
                      { minHeight: acMetrics.featureH },
                      acState.led && styles.modeCoolActive,
                    ]}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                    onPress={() =>
                      updateAcAndTransmit(
                        { ...acState, led: !acState.led },
                        { specialCommand: 'led' }
                      )
                    }
                  >
                    <Text style={styles.acFeatureTitle}>الشاشة</Text>
                    <Text style={styles.acTinyState}>
                      {acState.led ? 'مضيئة' : 'مطفأة'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.acFeatureBtn,
                      { minHeight: acMetrics.featureH },
                      acState.clean && styles.modeCoolActive,
                    ]}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                    onPress={() =>
                      updateAcAndTransmit(
                        { ...acState, clean: !acState.clean },
                        { specialCommand: 'clean' }
                      )
                    }
                  >
                    <Text style={styles.acFeatureTitle}>تنظيف</Text>
                    <Text style={styles.acTinyState}>
                      {acState.clean ? 'نشط' : 'Clean'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.acFeatureBtn,
                      { minHeight: acMetrics.featureH },
                      acState.sleep && styles.modeCoolActive,
                    ]}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.AC_MODE_STEP)}
                    onPress={handleSleepToggle}
                  >
                    <Text style={styles.acFeatureTitle}>نوم</Text>
                    <Text style={styles.acTinyState}>
                      {acState.sleep ? 'مفعّل' : 'Sleep'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[
                    styles.timerCard,
                    { minHeight: acMetrics.timerH },
                    acTimerConfig && styles.modeCoolActive,
                  ]}
                  onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                  onPress={handleOpenTimerModal}
                >
                  <View style={styles.timerRow}>
                    <Text style={styles.btnText}>المؤقت (Timer)</Text>
                    <Text style={styles.timerValue} numberOfLines={1}>
                      {acTimerConfig
                        ? `${acTimerConfig.action === 'on' ? 'تشغيل' : 'إطفاء'} ${formatTargetClockLabel(acTimerConfig.minutes, acTimerConfig.setAtMs)} (${formatTimerDuration(acTimerConfig.minutes)})`
                        : 'ضبط مؤقت المكيف (30د – 24س)'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </ScrollView>
      )}

      {!isSearchPageOpen ? (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'tv' && styles.tabBtnActive]}
            onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
            onPress={() => setActiveTab('tv')}
          >
            <Text style={[styles.tabText, activeTab === 'tv' && styles.tabTextActive]}>
              ريموت الشاشة
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'ac' && styles.tabBtnActive]}
            onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
            onPress={() => setActiveTab('ac')}
          >
            <Text style={[styles.tabText, activeTab === 'ac' && styles.tabTextActive]}>
              ريموت التكييف
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Modal visible={showWifiModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>إعداد الشاشة الذكية (Auto-Discovery & Token)</Text>

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={[
                  styles.chipBtn,
                  wifiProtocol === 'samsung_tizen' && styles.chipBtnActive,
                ]}
                onPress={() => {
                  setWifiProtocol('samsung_tizen');
                  setTvPort('8002');
                  setDialPort('8080');
                }}
              >
                <Text style={styles.chipText}>Samsung Tizen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.chipBtn,
                  wifiProtocol === 'android_tv' && styles.chipBtnActive,
                ]}
                onPress={() => {
                  setWifiProtocol('android_tv');
                  setTvPort('8080');
                  setDialPort('8008');
                }}
              >
                <Text style={styles.chipText}>Android TV</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chipBtn, wifiProtocol === 'roku' && styles.chipBtnActive]}
                onPress={() => {
                  setWifiProtocol('roku');
                  setTvPort('8060');
                  setDialPort('8060');
                }}
              >
                <Text style={styles.chipText}>Roku ECP</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalStatusStrip}>
              <View
                style={[
                  styles.statusDot,
                  wifiStatus.isConnected ? styles.statusDotOn : styles.statusDotIdle,
                ]}
              />
              <Text style={styles.modalStatusText} numberOfLines={1}>
                {tvIp}:{tvPort} · {pairingBadgeText}
              </Text>
            </View>

            <View style={styles.modalScanRow}>
              <View style={styles.portField}>
                <Text style={styles.inputLabel}>نطاق الشبكة (Subnet)</Text>
                <TextInput
                  style={styles.input}
                  value={subnetPrefix}
                  onChangeText={setSubnetPrefix}
                  keyboardType="numeric"
                  placeholder="192.168.1"
                  placeholderTextColor="#64748B"
                />
              </View>
              <TouchableOpacity
                style={[styles.modalScanBtn, isDiscovering && styles.scanBtnActive]}
                onPress={() => handleScanSmartTvs()}
              >
                <Text style={styles.btnTextBold}>
                  {isDiscovering
                    ? `إيقاف (${scanProgress.scanned}/${scanProgress.total})`
                    : 'البحث عن الشاشات'}
                </Text>
              </TouchableOpacity>
            </View>

            {discoveredTvs.length > 0 ? (
              <View style={styles.modalDiscoveryList}>
                {discoveredTvs.map((device) => {
                  const isSelected = device.ip === tvIp;
                  return (
                    <TouchableOpacity
                      key={`modal-${device.ip}-${device.protocol}`}
                      style={[
                        styles.discoveredItem,
                        isSelected && styles.discoveredItemActive,
                      ]}
                      onPress={() => handleSelectDiscoveredTv(device)}
                    >
                      <View style={styles.discoveredMeta}>
                        <Text style={styles.discoveredName}>{device.name}</Text>
                        <Text style={styles.discoveredSub}>
                          {device.modelName} · {device.ip}:{device.port}
                        </Text>
                      </View>
                      <Text style={styles.discoveredConnectTag}>
                        {isSelected && wifiStatus.isConnected ? 'متصل' : 'اختيار'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : !isDiscovering && hasScannedOnce ? (
              <Text style={styles.emptySearchText}>
                لم يتم العثور على شاشات على النطاق {subnetPrefix}.x — تأكد من تشغيل التلفاز.
              </Text>
            ) : null}

            <Text style={styles.inputLabel}>عنوان IP المحلي للشاشة</Text>
            <TextInput
              style={styles.input}
              value={tvIp}
              onChangeText={(val) => {
                setTvIp(val);
                const detectedSubnet = getSubnetFromIp(val);
                if (detectedSubnet !== subnetPrefix && val.split('.').length >= 3) {
                  setSubnetPrefix(detectedSubnet);
                }
              }}
              keyboardType="numeric"
              placeholder="192.168.1.50"
              placeholderTextColor="#64748B"
            />

            <View style={styles.rowGap}>
              <View style={styles.portField}>
                <Text style={styles.inputLabel}>منفذ التحكم (8002 / 8001)</Text>
                <TextInput
                  style={styles.input}
                  value={tvPort}
                  onChangeText={setTvPort}
                  keyboardType="numeric"
                  placeholder="8002"
                  placeholderTextColor="#64748B"
                />
              </View>
              <View style={styles.portField}>
                <Text style={styles.inputLabel}>منفذ DIAL Cast</Text>
                <TextInput
                  style={styles.input}
                  value={dialPort}
                  onChangeText={setDialPort}
                  keyboardType="numeric"
                  placeholder="8080"
                  placeholderTextColor="#64748B"
                />
              </View>
            </View>

            {wifiProtocol === 'samsung_tizen' ? (
              <View style={styles.tokenStatusBox}>
                <Text style={styles.tokenStatusLabel}>
                  حالة الاقتران: {wifiStatus.hasSavedToken ? 'Token محفوظ محلياً' : 'سيتم طلب الموافقة عند أول اتصال'}
                </Text>
                {wifiStatus.hasSavedToken ? (
                  <TouchableOpacity onPress={handleClearSavedToken}>
                    <Text style={styles.clearTokenText}>مسح التوكن</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => setShowWifiModal(false)}
              >
                <Text style={styles.btnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.navBtn, styles.modalSaveBtn]}
                onPress={handleSaveWifi}
              >
                <Text style={styles.btnTextBold}>حفظ واتصال</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showTimerModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>مؤقت مكيف الهواء (Hardware IR Timer)</Text>
            <Text style={styles.timerModalHint}>
              يُرسل أمر المؤقت مباشرة إلى وحدة المكيف (COOLIX48) ليعمل تلقائياً حتى عند قفل الهاتف
            </Text>

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={[
                  styles.chipBtn,
                  draftTimerAction === 'off' && styles.chipBtnActive,
                ]}
                onPress={() => setDraftTimerAction('off')}
              >
                <Text style={styles.chipText}>جدولة الإطفاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.chipBtn,
                  draftTimerAction === 'on' && styles.chipBtnActive,
                ]}
                onPress={() => setDraftTimerAction('on')}
              >
                <Text style={styles.chipText}>جدولة التشغيل</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.timerStepperBox}>
              <TouchableOpacity
                style={styles.timerStepSideBtn}
                onPress={() => handleStepDraftTimer(-1)}
              >
                <Text style={styles.rockerSymbol}>−</Text>
              </TouchableOpacity>

              <View style={styles.timerStepCenter}>
                <Text style={styles.timerStepDurationText}>
                  {formatTimerDuration(draftTimerMinutes)}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.timerStepSideBtn}
                onPress={() => handleStepDraftTimer(1)}
              >
                <Text style={styles.rockerSymbol}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.timerTargetPreview}>
              {draftTimerAction === 'on'
                ? `سيتم تشغيل مكيف الهواء في ${formatTargetClockLabel(draftTimerMinutes)}`
                : `سيتم إيقاف مكيف الهواء في ${formatTargetClockLabel(draftTimerMinutes)}`}
            </Text>

            {acTimerConfig ? (
              <TouchableOpacity
                style={styles.timerCancelBtn}
                onPress={handleCancelAcTimer}
              >
                <Text style={styles.clearTokenText}>إلغاء المؤقت الحالي</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => setShowTimerModal(false)}
              >
                <Text style={styles.btnText}>خروج</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.navBtn, styles.modalSaveBtn]}
                onPress={handleConfirmAcTimer}
              >
                <Text style={styles.btnTextBold}>
                  {draftTimerAction === 'on' ? 'جدولة تشغيل الوقت' : 'جدولة إيقاف الوقت'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showHapticsModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>إعدادات الاهتزاز الميكانيكي (Haptics)</Text>
            <Text style={styles.timerModalHint}>
              نبضات مخصصة لكل زر لاستخدام الريموت في الظلام دون النظر للشاشة. زر طاقة التلفاز يتطلب ضغطة مطولة 0.35 ثانية لمنع الإطفاء العرضي.
            </Text>

            <Text style={styles.inputLabel}>حالة الاهتزاز</Text>
            <View style={styles.rowGap}>
              <TouchableOpacity
                style={[
                  styles.chipBtn,
                  hapticsConfig.enabled && styles.chipBtnActive,
                ]}
                onPress={() => handleUpdateHaptics({ enabled: true })}
              >
                <Text style={styles.chipText}>مفعّل</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.chipBtn,
                  !hapticsConfig.enabled && styles.chipBtnActive,
                ]}
                onPress={() => handleUpdateHaptics({ enabled: false })}
              >
                <Text style={styles.chipText}>معطّل</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>مستوى شدة الاهتزاز</Text>
            <View style={styles.rowGap}>
              {[
                { key: 'light', label: 'خفيف' },
                { key: 'medium', label: 'متوسط' },
                { key: 'strong', label: 'قوي' },
              ].map((tier) => (
                <TouchableOpacity
                  key={tier.key}
                  style={[
                    styles.chipBtn,
                    hapticsConfig.intensity === tier.key && styles.chipBtnActive,
                    !hapticsConfig.enabled && { opacity: 0.45 },
                  ]}
                  disabled={!hapticsConfig.enabled}
                  onPress={() => handleUpdateHaptics({ intensity: tier.key })}
                >
                  <Text style={styles.chipText}>{tier.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={[styles.navBtn, styles.modalSaveBtn]}
                onPress={() => setShowHapticsModal(false)}
              >
                <Text style={styles.btnTextBold}>إغلاق</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={voiceSession.phase !== 'idle'}
        transparent
        animationType="fade"
        onRequestClose={handleCancelVoiceSession}
      >
        <View style={styles.voiceModalBackdrop}>
          <View style={styles.voiceOverlayCard}>
            <View style={styles.voiceHeaderRow}>
              <Text style={styles.voiceOverlayTitle}>
                {voiceSession.phase === 'listening'
                  ? 'الريموت الصوتي (مصرى ar-EG)'
                  : voiceSession.phase === 'searching'
                  ? 'جاري البحث على يوتيوب...'
                  : voiceSession.phase === 'confirming'
                  ? 'تأكيد تنفيذ الأمر'
                  : voiceSession.phase === 'executing'
                  ? 'جاري التنفيذ...'
                  : voiceSession.phase === 'done'
                  ? 'تم بنجاح'
                  : 'تعذر تنفيذ الأمر الصوتي'}
              </Text>
              <TouchableOpacity
                style={styles.voiceCloseChip}
                activeOpacity={0.75}
                onPress={handleCancelVoiceSession}
                accessibilityLabel="إغلاق الريموت الصوتي"
              >
                <Text style={styles.voiceCloseGlyph}>✕</Text>
              </TouchableOpacity>
            </View>

            {voiceSession.phase === 'listening' ? (
              <View style={styles.voiceBodyStack}>
                <View style={styles.voicePulseRing}>
                  <View style={styles.voicePulseCore}>
                    <MicIcon color="#FFFFFF" size={28} />
                  </View>
                </View>

                <View style={styles.voiceWaveRow}>
                  {[0.45, 0.85, 1.0, 0.72, 0.5].map((mult, idx) => {
                    const dynamicH = Math.round(
                      10 + mult * (12 + Math.min(10, voiceSession.rmsLevel) * 2.4)
                    );
                    return (
                      <View
                        key={`wave-${idx}`}
                        style={[styles.voiceWaveBar, { height: dynamicH }]}
                      />
                    );
                  })}
                </View>

                <Text dir="auto" style={styles.voiceTranscriptPreview}>
                  {voiceSession.partialTranscript || voiceSession.statusMessage || 'تحدث الآن...'}
                </Text>

                <Text style={styles.voiceExamplesHint}>
                  أمثلة: «شغّل سورة البقرة ناصر القطامي» • «وطّي الصوت 5 درجات» • «اقفل بعد نص ساعة»
                </Text>

                <View style={styles.voiceActionsRow}>
                  <TouchableOpacity
                    style={styles.voicePrimaryBtn}
                    activeOpacity={0.8}
                    onPress={() => VoiceControl.stopSession()}
                  >
                    <Text style={styles.btnTextBold}>إرسال الآن</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.voiceSecondaryBtn}
                    activeOpacity={0.8}
                    onPress={handleCancelVoiceSession}
                  >
                    <Text style={styles.btnText}>إلغاء</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {voiceSession.phase === 'searching' ? (
              <View style={styles.voiceBodyStack}>
                <ActivityIndicator size="large" color="#0EA5E9" />
                <Text dir="auto" style={styles.voiceTranscriptPreview}>
                  {voiceSession.statusMessage}
                </Text>
                <View style={styles.voiceActionsRow}>
                  <TouchableOpacity
                    style={styles.voiceSecondaryBtn}
                    activeOpacity={0.8}
                    onPress={handleCancelVoiceSession}
                  >
                    <Text style={styles.btnText}>إلغاء</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {voiceSession.phase === 'confirming' ? (
              <View style={styles.voiceBodyStack}>
                {voiceSession.parsedCommand &&
                voiceSession.parsedCommand.type === 'YOUTUBE_DIRECT_PLAY' &&
                voiceSession.videoCandidate ? (
                  <View style={styles.voiceVideoPreviewCard}>
                    <Image
                      source={{ uri: voiceSession.videoCandidate.thumbnailUrl }}
                      style={styles.voiceVideoThumb}
                    />
                    <View style={styles.voiceVideoMeta}>
                      <Text dir="auto" style={styles.voiceVideoTitle} numberOfLines={2}>
                        {voiceSession.videoCandidate.title}
                      </Text>
                      <Text dir="auto" style={styles.voiceVideoChannel} numberOfLines={1}>
                        {voiceSession.videoCandidate.channelTitle}
                        {voiceSession.videoCandidate.durationText
                          ? ` · ${voiceSession.videoCandidate.durationText}`
                          : ''}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.voiceCommandBadge}>
                    <Text style={styles.voiceCommandLabel}>
                      {voiceSession.statusMessage}
                    </Text>
                    {voiceSession.transcript ? (
                      <Text dir="auto" style={styles.voiceRawHeard} numberOfLines={1}>
                        «{voiceSession.transcript}»
                      </Text>
                    ) : null}
                  </View>
                )}

                <View style={styles.voiceCountdownWrap}>
                  <View
                    style={[
                      styles.voiceCountdownFill,
                      {
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            voiceSession.countdownTotalMs > 0
                              ? (voiceSession.countdownRemainingMs /
                                  voiceSession.countdownTotalMs) *
                                  100
                              : 0
                          )
                        )}%`,
                      },
                    ]}
                  />
                </View>

                <Text style={styles.voiceCountdownCaption}>
                  التنفيذ التلقائي خلال{' '}
                  {Math.max(0.1, voiceSession.countdownRemainingMs / 1000).toFixed(1)} ث
                </Text>

                {voiceSession.parsedCommand &&
                voiceSession.parsedCommand.type === 'YOUTUBE_DIRECT_PLAY' ? (
                  <View style={styles.voiceActionsRow}>
                    <TouchableOpacity
                      style={styles.voicePrimaryBtn}
                      activeOpacity={0.8}
                      onPress={handleExecuteVoiceCommandNow}
                    >
                      <Text style={styles.btnTextBold}>تشغيل فوراً</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.voiceAltBtn}
                      activeOpacity={0.8}
                      onPress={handleOpenVoiceSearchResults}
                    >
                      <Text style={styles.voiceAltBtnText}>نتائج أخرى</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.voiceSecondaryBtn}
                      activeOpacity={0.8}
                      onPress={handleCancelVoiceSession}
                    >
                      <Text style={styles.btnText}>إلغاء</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.voiceActionsRow}>
                    <TouchableOpacity
                      style={[
                        styles.voicePrimaryBtn,
                        voiceSession.parsedCommand &&
                          voiceSession.parsedCommand.isDestructive &&
                          styles.voiceDangerBtn,
                      ]}
                      activeOpacity={0.8}
                      onPress={handleExecuteVoiceCommandNow}
                    >
                      <Text style={styles.btnTextBold}>تنفيذ الآن</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.voiceSecondaryBtn}
                      activeOpacity={0.8}
                      onPress={handleCancelVoiceSession}
                    >
                      <Text style={styles.btnText}>إلغاء</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : null}

            {voiceSession.phase === 'executing' ? (
              <View style={styles.voiceBodyStack}>
                <ActivityIndicator size="large" color="#0EA5E9" />
                <Text dir="auto" style={styles.voiceTranscriptPreview}>
                  {voiceSession.statusMessage}
                </Text>
                <View style={styles.voiceActionsRow}>
                  <TouchableOpacity
                    style={styles.voiceSecondaryBtn}
                    activeOpacity={0.8}
                    onPress={handleCancelVoiceSession}
                  >
                    <Text style={styles.btnText}>إيقاف</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {voiceSession.phase === 'done' ? (
              <View style={styles.voiceBodyStack}>
                <View style={styles.voiceSuccessBadge}>
                  <Text style={styles.voiceSuccessIcon}>✓</Text>
                </View>
                <Text dir="auto" style={styles.voiceTranscriptPreview}>
                  {voiceSession.statusMessage}
                </Text>
              </View>
            ) : null}

            {voiceSession.phase === 'error' ? (
              <View style={styles.voiceBodyStack}>
                <Text dir="auto" style={styles.voiceErrorText}>
                  {voiceSession.errorMessage}
                </Text>
                <View style={styles.voiceActionsRow}>
                  <TouchableOpacity
                    style={styles.voicePrimaryBtn}
                    activeOpacity={0.8}
                    onPress={handleVoiceMicPress}
                  >
                    <Text style={styles.btnTextBold}>حاول مجدداً</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.voiceSecondaryBtn}
                    activeOpacity={0.8}
                    onPress={handleCancelVoiceSession}
                  >
                    <Text style={styles.btnText}>إغلاق</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={quickCastModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setQuickCastModalVisible(false)}
      >
        <View style={styles.quickCastBackdrop}>
          <View style={styles.quickCastSheet}>
            <View style={styles.quickCastHeader}>
              <View style={styles.quickCastHeaderTextWrap}>
                <Text style={styles.quickCastTitle}>بث فوري للشاشة</Text>
                <View style={styles.quickCastBadge}>
                  <View style={styles.quickCastBadgeDot} />
                  <Text style={styles.quickCastBadgeText}>
                    البروكسي الذكي نشط (حماية 403)
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.quickCastCloseBtn}
                activeOpacity={0.75}
                onPress={() => setQuickCastModalVisible(false)}
                accessibilityLabel="إغلاق نافذة البث الفوري"
              >
                <Text style={styles.voiceCloseGlyph}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.quickCastScroll}
              contentContainerStyle={styles.quickCastScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.inputLabel}>اسم الفيلم / البث</Text>
              <TextInput
                style={styles.quickCastInput}
                value={quickCastTitle}
                onChangeText={setQuickCastTitle}
                placeholder="اسم الفيلم الظاهر في الإشعار والشاشة"
                placeholderTextColor="#64748B"
              />

              <Text style={styles.inputLabel}>رابط الفيديو المصدر</Text>
              <Text dir="ltr" style={styles.quickCastUrlBox} numberOfLines={2}>
                {quickCastSourceUrl || '—'}
              </Text>

              {Object.keys(quickCastHeaders || {}).length > 0 ? (
                <View style={styles.quickCastHeadersNote}>
                  <Text style={styles.quickCastHeadersNoteText}>
                    تم التقاط {Object.keys(quickCastHeaders).length} ترويسة حماية تلقائياً (Referer / Cookie / User-Agent)
                  </Text>
                </View>
              ) : null}

              <Text style={styles.inputLabel}>عنوان IP لشاشة سامسونج (اختياري — بحث تلقائي إذا تُرك فارغاً)</Text>
              <TextInput
                style={[styles.quickCastInput, styles.quickCastLtrInput]}
                value={quickCastTargetIp}
                onChangeText={setQuickCastTargetIp}
                placeholder="192.168.1.50"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
              />

              <View style={styles.quickCastSubSection}>
                <View style={styles.quickCastSubHeader}>
                  <Text style={styles.inputLabel}>الترجمة العربية (.srt / .vtt)</Text>
                  {quickCastSubtitleUri ? (
                    <TouchableOpacity onPress={handleRemoveQuickCastSubtitle}>
                      <Text style={styles.clearTokenText}>إزالة</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.quickCastSubBtn}
                  activeOpacity={0.8}
                  onPress={handlePickQuickCastSubtitle}
                >
                  <Text style={styles.quickCastSubBtnText} numberOfLines={1}>
                    {quickCastSubtitleUri
                      ? `📄 ${quickCastSubtitleName || 'ملف ترجمة مرفق'} (تغيير)`
                      : '📎 إرفاق ملف ترجمة من الهاتف (.srt / .vtt)'}
                  </Text>
                </TouchableOpacity>

                {quickCastSubtitleUri ? (
                  <View style={styles.quickCastOffsetRow}>
                    <TouchableOpacity
                      style={styles.quickCastOffsetBtn}
                      onPress={() => handleShiftQuickCastSubtitleOffset(-500)}
                    >
                      <Text style={styles.quickCastOffsetBtnText}>-0.5 ث</Text>
                    </TouchableOpacity>
                    <Text style={styles.quickCastOffsetLabel}>
                      مزامنة: {quickCastSubtitleOffsetMs >= 0 ? `+${(quickCastSubtitleOffsetMs / 1000).toFixed(1)}` : (quickCastSubtitleOffsetMs / 1000).toFixed(1)} ث
                    </Text>
                    <TouchableOpacity
                      style={styles.quickCastOffsetBtn}
                      onPress={() => handleShiftQuickCastSubtitleOffset(500)}
                    >
                      <Text style={styles.quickCastOffsetBtnText}>+0.5 ث</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {quickCastResumeMatch ? (
                <TouchableOpacity
                  style={[
                    styles.quickCastResumeBanner,
                    quickCastUseResume && styles.quickCastResumeBannerActive,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => {
                    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                    setQuickCastUseResume((prev) => !prev);
                  }}
                >
                  <Text style={styles.quickCastResumeTitle}>
                    {quickCastUseResume
                      ? `✓ استكمال من الدقيقة ${formatSecondsHms(quickCastResumeMatch.positionSec)}`
                      : `البدء من البداية (00:00) — اضغط للاستكمال من ${formatSecondsHms(quickCastResumeMatch.positionSec)}`}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {quickCastSession && quickCastSession.proxyStreamUrl ? (
                <View style={styles.quickCastSessionCard}>
                  <Text style={styles.quickCastSessionHeading}>
                    رابط البروكسي المحلي على الشبكة ({quickCastSession.lanIp}:{quickCastSession.port})
                  </Text>
                  <Text dir="ltr" style={styles.quickCastSessionUrl} numberOfLines={1}>
                    {quickCastSession.proxyStreamUrl}
                  </Text>
                  {quickCastSession.proxySubtitleUrl ? (
                    <Text dir="ltr" style={styles.quickCastSessionSubUrl} numberOfLines={1}>
                      {quickCastSession.proxySubtitleUrl}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {quickCastStatusText ? (
                <Text style={styles.quickCastStatusMsg}>{quickCastStatusText}</Text>
              ) : null}

              {quickCastErrorText ? (
                <Text style={styles.quickCastErrorMsg}>{quickCastErrorText}</Text>
              ) : null}
            </ScrollView>

            <View style={styles.quickCastFooterStack}>
              <TouchableOpacity
                style={[
                  styles.quickCastCinemaBtn,
                  quickCastBusy && { opacity: 0.7 },
                ]}
                activeOpacity={0.85}
                disabled={quickCastBusy}
                onPress={handleStartQuickCastToWebReceiver}
              >
                {quickCastBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.quickCastPrimaryBtnText}>
                    🎬 مشغّل السينما الذكي (Web Receiver)
                  </Text>
                )}
              </TouchableOpacity>

              <View style={styles.quickCastFooter}>
                <TouchableOpacity
                  style={[
                    styles.quickCastDlnaBtn,
                    quickCastBusy && { opacity: 0.7 },
                  ]}
                  activeOpacity={0.85}
                  disabled={quickCastBusy}
                  onPress={handleStartQuickCastToDlna}
                >
                  <Text style={styles.quickCastDlnaBtnText}>
                    📺 مشغّل سامسونج الأصلي (DLNA 4K)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickCastQueueActionBtn}
                  activeOpacity={0.85}
                  disabled={quickCastBusy}
                  onPress={handleEnqueueFromQuickCast}
                >
                  <Text style={styles.quickCastQueueActionText}>+ قائمة الانتظار</Text>
                </TouchableOpacity>

                {quickCastSession ? (
                  <TouchableOpacity
                    style={styles.quickCastStopBtn}
                    activeOpacity={0.85}
                    disabled={quickCastBusy}
                    onPress={handleStopQuickCast}
                  >
                    <Text style={styles.quickCastStopBtnText}>إيقاف</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <CinemaControlModal
        visible={cinemaModalVisible}
        onClose={() => setCinemaModalVisible(false)}
        activeTab={cinemaTab}
        onChangeTab={setCinemaTab}
        cinemaSession={cinemaSession}
        receiverState={receiverState}
        serverUrl={serverUrl}
        busyAction={cinemaBusyAction}
        statusNotice={cinemaNotice}
        subtitleStyle={subtitleStyle}
        queue={cinemaQueue}
        resumeList={resumeList}
        autoNextCountdown={autoNextCountdown}
        onSendCommand={handleCinemaCommand}
        onUpdateSubtitleStyle={handleUpdateSubtitleStyle}
        onPickSubtitle={handlePickCinemaSubtitle}
        onRemoveSubtitle={handleRemoveCinemaSubtitle}
        onLaunchTvBrowser={handleLaunchReceiverOnTv}
        onCopyReceiverUrl={handleCopyReceiverUrl}
        onOpenSmartBrowser={() => {
          setCinemaModalVisible(false);
          handleOpenSmartBrowser('');
        }}
        onStopCinema={handleStopQuickCast}
        onPlayQueueItem={async (item) => {
          const updated = await CinemaStorageService.removeFromQueue(item.queueId);
          setCinemaQueue(updated);
          await startWebReceiverCast(item, {
            startPositionSec: 0,
            launchTv: true,
            openCinemaModal: true,
          });
        }}
        onRemoveQueueItem={async (queueId) => {
          const updated = await CinemaStorageService.removeFromQueue(queueId);
          setCinemaQueue(updated);
        }}
        onClearQueue={async () => {
          const updated = await CinemaStorageService.clearQueue();
          setCinemaQueue(updated);
        }}
        onPlayNextNow={handlePlayNextFromQueue}
        onCancelAutoNext={handleCancelAutoNext}
        onPlayResumeItem={(item) =>
          startWebReceiverCast(item, {
            startPositionSec: item.positionSec,
            launchTv: true,
            openCinemaModal: true,
          })
        }
        onRemoveResumeItem={async (id) => {
          const updated = await CinemaStorageService.removeResumeItem(id);
          setResumeList(updated);
        }}
        onClearResumeList={async () => {
          const updated = await CinemaStorageService.clearResumeList();
          setResumeList(updated);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D11' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2532',
    gap: 10,
  },
  headerBrandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBrandGroupCompact: {
    gap: 6,
  },
  headerSearchIconBtn: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerMicActiveBtn: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(14,165,233,0.22)',
  },
  headerHapticsActiveBtn: {
    borderColor: 'rgba(14,165,233,0.45)',
    backgroundColor: 'rgba(14,165,233,0.1)',
  },
  headerSearchRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBackGlyph: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
  },
  headerSearchInput: {
    flex: 1,
    minHeight: 40,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#252E3E',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#F1F5F9',
    fontSize: 14,
    textAlign: 'right',
  },
  headerClearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerClearGlyph: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
  },
  headerTitle: { color: '#F1F5F9', fontSize: 19, fontWeight: '700' },
  headerStatus: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  headerWifiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 165,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    gap: 6,
  },
  headerWifiLabel: {
    color: '#F1F5F9',
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  headerWifiGear: {
    color: '#94A3B8',
    fontSize: 13,
  },
  feedbackBar: {
    marginHorizontal: 18,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
  },
  feedbackError: { borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.14)' },
  feedbackText: { color: '#F1F5F9', fontSize: 12, textAlign: 'center' },
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 16 },
  tvScrollContent: { flexGrow: 1 },
  streamingDock: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#0B0D11',
  },
  sectionStack: { gap: 10 },
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: '#131720',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 3,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentIrActive: { backgroundColor: '#EF4444' },
  segmentWifiActive: { backgroundColor: '#0EA5E9' },
  segmentText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  rowGap: { flexDirection: 'row', gap: 10 },
  chipBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  chipBtnActive: { borderColor: '#0EA5E9', backgroundColor: 'rgba(14,165,233,0.15)' },
  chipText: { color: '#F1F5F9', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  connectingInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  connectingInlineText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  modalStatusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalStatusText: {
    color: '#94A3B8',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOn: { backgroundColor: '#22C55E' },
  statusDotIdle: { backgroundColor: '#64748B' },
  scanBtnActive: { backgroundColor: '#F59E0B' },
  discoveryCard: {
    backgroundColor: '#131720',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 12,
    gap: 8,
  },
  discoveryProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discoveryStatusText: { color: '#F1F5F9', fontSize: 12, fontWeight: '600' },
  discoveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  discoveryTitle: { color: '#F1F5F9', fontSize: 12, fontWeight: '700', flex: 1 },
  discoveryCloseText: { color: '#0EA5E9', fontSize: 12, fontWeight: '700' },
  discoveryList: { gap: 8 },
  discoveredItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  discoveredItemActive: {
    borderColor: '#0EA5E9',
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  discoveredMeta: { flex: 1, gap: 2 },
  discoveredName: { color: '#F1F5F9', fontSize: 13, fontWeight: '700', textAlign: 'right' },
  discoveredSub: { color: '#94A3B8', fontSize: 11, textAlign: 'right' },
  discoveredConnectTag: { color: '#0EA5E9', fontSize: 12, fontWeight: '700' },
  powerBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  powerBtnHolding: {
    backgroundColor: '#DC2626',
    borderColor: '#FCA5A5',
  },
  actionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  btnTextBold: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  dpadCircle: {
    alignSelf: 'center',
    width: 228,
    height: 228,
    borderRadius: 114,
    backgroundColor: '#171E2C',
    borderWidth: 1,
    borderColor: '#253044',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    direction: 'ltr',
    marginVertical: 0,
  },
  dpadWedgeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    borderTopWidth: 113,
    borderRightWidth: 113,
    borderBottomWidth: 113,
    borderLeftWidth: 113,
    borderTopColor: 'rgba(14, 165, 233, 0.14)',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    zIndex: 2,
  },
  dpadTouchRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 4,
  },
  dpadDotsLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    direction: 'ltr',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 28,
    zIndex: 6,
  },
  dpadDotsMiddleRow: {
    width: '100%',
    flexDirection: 'row',
    direction: 'ltr',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  dpadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#64748B',
  },
  dpadDotActive: {
    backgroundColor: '#38BDF8',
    transform: [{ scale: 1.35 }],
  },
  dpadOkBtn: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#1E2738',
    borderWidth: 1,
    borderColor: '#2E3B52',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  dpadOkBtnActive: {
    backgroundColor: '#0EA5E9',
    borderColor: '#38BDF8',
  },
  dpadOkText: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
  },
  navBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rockerCard: {
    flex: 1,
    backgroundColor: '#131720',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 6,
    alignItems: 'center',
    gap: 5,
  },
  rockerKey: {
    width: '100%',
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#1A202C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rockerSymbol: { color: '#F1F5F9', fontSize: 20, fontWeight: '700' },
  rockerLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  youtubeBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  netflixBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#991B1B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchPageWrap: {
    flex: 1,
    backgroundColor: '#0B0D11',
  },
  networkWarnBanner: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.14)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    gap: 8,
  },
  networkWarnText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    lineHeight: 18,
  },
  networkWarnActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  networkWarnBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(245,158,11,0.2)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  networkWarnBtnText: {
    color: '#FEF3C7',
    fontSize: 11,
    fontWeight: '700',
  },
  networkWarnSetupBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#252E3E',
  },
  networkWarnSetupText: {
    color: '#F1F5F9',
    fontSize: 11,
    fontWeight: '700',
  },
  historySection: {
    gap: 10,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  historyHeaderTitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  historyClearAllText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
  },
  historyList: {
    gap: 8,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131720',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    minHeight: 46,
    paddingHorizontal: 12,
    gap: 8,
  },
  historyItemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  historyItemText: {
    flex: 1,
    color: '#F1F5F9',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  historyDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyDeleteGlyph: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },
  matchingHistoryWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 6,
  },
  matchingHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131720',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  searchLoadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  searchLoadingText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  emptySearchText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  filterBarContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#161B26',
    backgroundColor: '#0B0D11',
  },
  filterBarContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.18)',
    borderColor: '#0EA5E9',
  },
  filterChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  smartLinkWrap: {
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  smartLinkCard: {
    backgroundColor: '#131720',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#252E3E',
    padding: 14,
    gap: 10,
  },
  smartLinkTitle: {
    color: '#F1F5F9',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  smartLinkUrl: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'left',
  },
  smartLinkYoutubeBtn: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  smartLinkBrowserBtn: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  smartLinkBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  recentChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recentSearchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131720',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingRight: 10,
    paddingLeft: 4,
    minHeight: 34,
    maxWidth: '100%',
    gap: 4,
  },
  recentSearchPillMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    flexShrink: 1,
  },
  recentSearchPillText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 180,
  },
  recentSearchPillDelete: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoritesSection: {
    gap: 8,
  },
  favoritesSectionSpaced: {
    marginTop: 16,
  },
  favoritesList: {
    gap: 6,
  },
  videoSeparatorWrap: {
    width: '100%',
  },
  inlineAutocompleteWrap: {
    marginBottom: 8,
  },
  inlineAutocompleteScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  inlineAutocompleteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#131720',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inlineAutocompleteText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 160,
  },
  videoSeparator: {
    height: 6,
  },
  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131720',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#1E2532',
    overflow: 'hidden',
    minHeight: 66,
  },
  videoCardActive: {
    borderColor: '#0EA5E9',
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  videoCardMainTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 66,
  },
  videoThumbWrap: {
    width: 116,
    height: 66,
    position: 'relative',
    backgroundColor: '#0B0D11',
    overflow: 'hidden',
    flexShrink: 0,
  },
  videoThumb: {
    width: 116,
    height: 66,
    backgroundColor: '#0B0D11',
  },
  videoDurationBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(11, 13, 17, 0.88)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  videoDurationBadgeText: {
    color: '#F8FAFC',
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  videoLiveBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: '#DC2626',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  videoLiveBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  videoInfo: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 9,
    justifyContent: 'center',
    gap: 2,
  },
  videoTitle: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    lineHeight: 15,
  },
  videoChannel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'right',
    lineHeight: 13,
  },
  videoStatsText: {
    flex: 1,
    color: '#64748B',
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'right',
    lineHeight: 13,
  },
  videoActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  videoCastLabel: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
    flexShrink: 0,
  },
  videoStarBtn: {
    width: 34,
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  videoStarGlyph: {
    color: '#64748B',
    fontSize: 15,
    fontWeight: '600',
  },
  videoStarGlyphActive: {
    color: '#FACC15',
  },
  listFooterBox: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 8,
  },
  loadMoreSpinnerWrap: {
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infiniteScrollSentinel: {
    width: '100%',
    height: 1,
    opacity: 0,
  },
  acScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 32,
  },
  acSectionStack: { gap: 12 },
  acRowGap: { flexDirection: 'row', gap: 10 },
  acBrandChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acCompactLabel: { color: '#F1F5F9', fontSize: 12, fontWeight: '600' },
  acModeLabel: { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  acFeatureTitle: { color: '#F1F5F9', fontSize: 14, fontWeight: '700' },
  acTinyState: { color: '#94A3B8', fontSize: 11, fontWeight: '500' },
  acLcd: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 6,
  },
  acLcdOff: { opacity: 0.5 },
  acLcdTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },
  acMeta: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  acTemp: {
    color: '#F1F5F9',
    fontSize: 46,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  acFooter: { color: '#0EA5E9', fontSize: 12, fontWeight: '600' },
  acLcdTimerBadge: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  tempStepBtn: {
    width: 72,
    height: 54,
    borderRadius: 14,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerBtn: {
    flex: 1,
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerOn: { backgroundColor: '#EF4444' },
  acPowerOff: { backgroundColor: '#16A34A' },
  sectionCaption: { color: '#94A3B8', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  modesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  modeChip: {
    width: '31.5%',
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  modeCoolActive: { borderColor: '#0EA5E9', backgroundColor: 'rgba(14,165,233,0.16)' },
  modeHeatActive: { borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.16)' },
  extraCard: {
    flex: 1,
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  extraCaption: { color: '#94A3B8', fontSize: 11 },
  acFeatureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  acFeatureBtn: {
    width: '48.2%',
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  timerCard: {
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingVertical: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timerValue: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'left',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1E2532',
    backgroundColor: '#131720',
    padding: 6,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#0EA5E9',
  },
  tabText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#F1F5F9', fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#131720',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 18,
    gap: 12,
  },
  modalTitle: { color: '#F1F5F9', fontSize: 16, fontWeight: '700', textAlign: 'right' },
  inputLabel: { color: '#94A3B8', fontSize: 12, textAlign: 'right', marginBottom: 4 },
  portField: { flex: 1 },
  input: {
    minHeight: 44,
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#F1F5F9',
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  modalScanRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  modalScanBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalDiscoveryList: {
    maxHeight: 150,
    gap: 6,
  },
  tokenStatusBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tokenStatusLabel: { color: '#94A3B8', fontSize: 12, flex: 1, textAlign: 'right' },
  clearTokenText: { color: '#EF4444', fontSize: 12, fontWeight: '700' },
  modalSaveBtn: { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
  timerModalHint: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  timerStepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B0D11',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2532',
    overflow: 'hidden',
    minHeight: 62,
  },
  timerStepSideBtn: {
    width: 64,
    height: 62,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A202C',
  },
  timerStepCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  timerStepDurationText: {
    color: '#F1F5F9',
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timerTargetPreview: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  timerCancelBtn: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tvSleepBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 18,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(14,165,233,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.4)',
    gap: 10,
  },
  tvSleepBannerText: {
    color: '#E0F2FE',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flex: 1,
    textAlign: 'right',
  },
  tvSleepCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
  },
  tvSleepCancelText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
  },
  voiceModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,7,14,0.78)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  voiceOverlayCard: {
    backgroundColor: '#131720',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#253044',
    padding: 18,
    gap: 14,
  },
  voiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  voiceOverlayTitle: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
  voiceCloseChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceCloseGlyph: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  voiceBodyStack: {
    alignItems: 'center',
    gap: 12,
  },
  voicePulseRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(14,165,233,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(56,189,248,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voicePulseCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceWaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 38,
    gap: 6,
  },
  voiceWaveBar: {
    width: 5,
    borderRadius: 3,
    backgroundColor: '#38BDF8',
  },
  voiceTranscriptPreview: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  voiceExamplesHint: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 17,
  },
  voiceVideoPreviewCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B0D11',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 10,
    gap: 10,
  },
  voiceVideoThumb: {
    width: 108,
    height: 62,
    borderRadius: 8,
    backgroundColor: '#1A202C',
  },
  voiceVideoMeta: {
    flex: 1,
    gap: 4,
  },
  voiceVideoTitle: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
    lineHeight: 18,
  },
  voiceVideoChannel: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'right',
  },
  voiceCommandBadge: {
    width: '100%',
    backgroundColor: '#0B0D11',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
    alignItems: 'center',
  },
  voiceCommandLabel: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  voiceRawHeard: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
  },
  voiceCountdownWrap: {
    width: '100%',
    height: 5,
    borderRadius: 3,
    backgroundColor: '#1E2532',
    overflow: 'hidden',
  },
  voiceCountdownFill: {
    height: '100%',
    backgroundColor: '#0EA5E9',
  },
  voiceCountdownCaption: {
    color: '#94A3B8',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  voiceActionsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
  },
  voicePrimaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  voiceDangerBtn: {
    backgroundColor: '#EF4444',
  },
  voiceAltBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#38BDF8',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  voiceAltBtnText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  voiceSecondaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  voiceSuccessBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(34,197,94,0.2)',
    borderWidth: 1.5,
    borderColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceSuccessIcon: {
    color: '#22C55E',
    fontSize: 22,
    fontWeight: '700',
  },
  voiceErrorText: {
    color: '#FCA5A5',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  smartLinkProxyBtn: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  quickCastMiniBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 14,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: '#10B981',
    gap: 10,
  },
  quickCastMiniInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickCastMiniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  quickCastMiniText: {
    flex: 1,
    color: '#D1FAE5',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  quickCastMiniStopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  quickCastMiniStopText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
  },
  quickCastBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    justifyContent: 'flex-end',
  },
  quickCastSheet: {
    backgroundColor: '#131720',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#252E3E',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    maxHeight: '86%',
  },
  quickCastHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2532',
  },
  quickCastHeaderTextWrap: {
    flex: 1,
    gap: 6,
    alignItems: 'flex-start',
  },
  quickCastTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'right',
  },
  quickCastBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  quickCastBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
  },
  quickCastBadgeText: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '700',
  },
  quickCastCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickCastScroll: {
    flexGrow: 0,
    marginTop: 10,
  },
  quickCastScrollContent: {
    gap: 8,
    paddingBottom: 8,
  },
  quickCastInput: {
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#252E3E',
    color: '#F8FAFC',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    textAlign: 'right',
  },
  quickCastLtrInput: {
    textAlign: 'left',
  },
  quickCastUrlBox: {
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    color: '#94A3B8',
    fontSize: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
    textAlign: 'left',
  },
  quickCastHeadersNote: {
    backgroundColor: 'rgba(14, 165, 233, 0.12)',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  quickCastHeadersNoteText: {
    color: '#7DD3FC',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  quickCastSubSection: {
    gap: 6,
    marginTop: 2,
  },
  quickCastSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickCastSubBtn: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  quickCastSubBtnText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  quickCastOffsetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  quickCastOffsetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
  },
  quickCastOffsetBtnText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },
  quickCastOffsetLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  quickCastSessionCard: {
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 10,
    gap: 4,
  },
  quickCastSessionHeading: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  quickCastSessionUrl: {
    color: '#CBD5E1',
    fontSize: 11,
    textAlign: 'left',
  },
  quickCastSessionSubUrl: {
    color: '#6EE7B7',
    fontSize: 11,
    textAlign: 'left',
  },
  quickCastStatusMsg: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    lineHeight: 18,
  },
  quickCastErrorMsg: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    lineHeight: 18,
  },
  quickCastFooterStack: {
    gap: 8,
    marginTop: 10,
  },
  quickCastFooter: {
    flexDirection: 'row',
    gap: 8,
  },
  quickCastCinemaBtn: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  quickCastDlnaBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  quickCastDlnaBtnText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  quickCastQueueActionBtn: {
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  quickCastQueueActionText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  quickCastResumeBanner: {
    backgroundColor: 'rgba(250, 204, 21, 0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  quickCastResumeBannerActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.16)',
    borderColor: '#38BDF8',
  },
  quickCastResumeTitle: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  smartLinkQueueBtn: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  cinemaToolsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  cinemaToolPrimaryBtn: {
    flex: 1,
    backgroundColor: 'rgba(14, 165, 233, 0.14)',
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 3,
  },
  cinemaToolSecondaryBtn: {
    flex: 1,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#252E3E',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 3,
  },
  cinemaToolPrimaryText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  cinemaToolSubText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  cinemaResumeRowWrap: {
    gap: 7,
  },
  cinemaResumeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#131720',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8,
  },
  cinemaResumeChipTitle: {
    flex: 1,
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  cinemaResumeChipTime: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  quickCastPrimaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  quickCastPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  quickCastStopBtn: {
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderWidth: 1,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  quickCastStopBtnText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default App;
