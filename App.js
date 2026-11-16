import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
} from 'react-native';
import WifiControl from './src/services/WifiControl';
import {
  encodeMideaAcPattern,
  MIDEA_MAX_TEMP,
  MIDEA_MIN_TEMP,
} from './src/protocols/mideaAc';

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
  repeatIntervalMs = 130,
  initialDelayMs = 220,
  style,
  activeOpacity = 0.7,
  hitSlop,
  children,
}) {
  const holdTimerRef = useRef(null);
  const repeatTimerRef = useRef(null);
  const latestActionRef = useRef(onAction);
  const latestActiveChangeRef = useRef(onActiveChange);

  latestActionRef.current = onAction;
  latestActiveChangeRef.current = onActiveChange;

  const clearTimers = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    if (latestActiveChangeRef.current) {
      latestActiveChangeRef.current(false);
    }
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const handlePressIn = () => {
    clearTimers();
    if (latestActiveChangeRef.current) {
      latestActiveChangeRef.current(true);
    }
    if (latestActionRef.current) {
      latestActionRef.current();
    }
    holdTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = setInterval(() => {
        if (latestActionRef.current) {
          latestActionRef.current();
        }
      }, repeatIntervalMs);
    }, initialDelayMs);
  };

  return (
    <TouchableOpacity
      style={style}
      activeOpacity={activeOpacity}
      hitSlop={hitSlop}
      onPressIn={handlePressIn}
      onPressOut={clearTimers}
    >
      {children}
    </TouchableOpacity>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('tv');
  const [hasIrHardware, setHasIrHardware] = useState(null);
  const [feedback, setFeedback] = useState({
    text: '',
    tone: 'neutral',
  });

  // حالة ريموت الشاشة والواي فاي والاقتران التلقائي
  const [tvTransport, setTvTransport] = useState('ir');
  const tvBrand = 'samsung';
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

  // حالة البحث والتشغيل المباشر (Cast) ليوتيوب عبر الواي فاي
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLaunchingYouTube, setIsLaunchingYouTube] = useState(false);
  const [castingVideoId, setCastingVideoId] = useState(null);
  const [hasSearchedOnce, setHasSearchedOnce] = useState(false);

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
  const [acTimerSeconds, setAcTimerSeconds] = useState(0);
  const [acTimerAction, setAcTimerAction] = useState('off');
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [draftTimerMinutes, setDraftTimerMinutes] = useState(30);
  const [draftTimerAction, setDraftTimerAction] = useState('off');

  const [activeDpadDir, setActiveDpadDir] = useState(null);
  const isSendingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const unsubscribe = WifiControl.subscribe((status) => {
      if (mounted) {
        setWifiStatus(status);
      }
    });

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

    if (Platform.OS === 'web') {
      setHasIrHardware(true);
    } else if (Platform.OS === 'android' && IrManagerModule) {
      IrManagerModule.hasIrEmitter()
        .then((supported) => {
          if (mounted) {
            setHasIrHardware(Boolean(supported));
          }
        })
        .catch(() => {
          if (mounted) {
            setHasIrHardware(false);
          }
        });
    } else {
      setHasIrHardware(false);
    }

    return () => {
      mounted = false;
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
    const available = await IrManagerModule.hasIrEmitter();
    if (!available) {
      throw new Error('هذا الهاتف لا يحتوي على مستشعر IR Blaster.');
    }
    await IrManagerModule.transmitIR(pattern, CARRIER_38KHZ);
    clearErrorBanner();
  };

  const handleTvCommand = async (commandKey, options = {}) => {
    if (isSendingRef.current) {
      return;
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
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر تنفيذ الأمر',
        tone: 'error',
      });
    } finally {
      isSendingRef.current = false;
    }
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
      WifiControl.configure({
        protocol: wifiProtocol,
        ipAddress: tvIp,
        port: Number(tvPort) || undefined,
        dialPort: Number(dialPort) || undefined,
      });
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

  const handleSearchYouTube = async () => {
    if (!searchQuery.trim()) {
      setFeedback({ text: 'اكتب عنوان الفيديو للبحث في يوتيوب.', tone: 'error' });
      return;
    }
    setIsSearching(true);
    setHasSearchedOnce(true);
    try {
      const items = await WifiControl.searchYouTubeVideos(searchQuery);
      setSearchResults(items);
      clearErrorBanner();
    } catch (error) {
      setSearchResults([]);
      setFeedback({
        text: error && error.message ? error.message : 'فشل البحث في يوتيوب',
        tone: 'error',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCastVideo = async (item) => {
    setCastingVideoId(item.videoId);
    try {
      WifiControl.configure({
        protocol: wifiProtocol,
        ipAddress: tvIp,
        port: Number(tvPort) || undefined,
        dialPort: Number(dialPort) || undefined,
      });
      await WifiControl.castYouTubeVideo(item.videoId);
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
    setAcState(nextAcState);
    try {
      const pattern = buildAcIrPattern(acBrand, nextAcState, options);
      await transmitIrPattern(pattern);
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر إرسال أمر التكييف',
        tone: 'error',
      });
    }
  };

  useEffect(() => {
    if (acTimerSeconds <= 0) return undefined;
    const timer = setInterval(() => {
      setAcTimerSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          const targetPower = acTimerAction === 'on';
          setAcState((curr) => {
            const nextState = { ...curr, power: targetPower };
            const pattern = buildAcIrPattern(acBrand, nextState);
            transmitIrPattern(pattern).catch(() => {});
            return nextState;
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [acTimerSeconds, acTimerAction, acBrand]);

  const formatTimerLabel = (totalSec) => {
    if (!totalSec || totalSec <= 0) return 'متوقف';
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs} ساعة ${mins} دقيقة`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const formatTimerDuration = (totalMinutes) => {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hrs} ساعة ${mins} دقيقة`;
  };

  const formatTargetClockLabel = (offsetMinutes) => {
    const now = new Date();
    const target = new Date(now.getTime() + offsetMinutes * 60 * 1000);
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
    setDraftTimerAction(acTimerSeconds > 0 ? acTimerAction : defaultAction);
    setDraftTimerMinutes(
      acTimerSeconds > 0 ? Math.max(30, Math.round(acTimerSeconds / 60)) : 60
    );
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

  const handleConfirmAcTimer = () => {
    setAcTimerAction(draftTimerAction);
    setAcTimerSeconds(draftTimerMinutes * 60);
    setShowTimerModal(false);
  };

  const handleCancelAcTimer = () => {
    setAcTimerSeconds(0);
    setShowTimerModal(false);
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

  const tvHeaderElement = (
    <View style={styles.sectionStack}>
      <View style={styles.segmentBox}>
        <TouchableOpacity
          style={[styles.segmentBtn, tvTransport === 'ir' && styles.segmentIrActive]}
          onPress={() => setTvTransport('ir')}
        >
          <Text style={styles.segmentText}>أشعة IR (38kHz)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, tvTransport === 'wifi' && styles.segmentWifiActive]}
          onPress={() => setTvTransport('wifi')}
        >
          <Text style={styles.segmentText}>واي فاي (Smart TV)</Text>
        </TouchableOpacity>
      </View>

      {tvTransport === 'wifi' ? (
        <View style={styles.wifiSectionWrap}>
          <View style={styles.wifiBar}>
            <TouchableOpacity
              style={styles.wifiInfoTouchable}
              onPress={() => setShowWifiModal(true)}
            >
              <View style={styles.wifiStatusHeader}>
                <View
                  style={[
                    styles.statusDot,
                    wifiStatus.isConnected ? styles.statusDotOn : styles.statusDotIdle,
                  ]}
                />
                <Text style={styles.wifiDeviceTitle} numberOfLines={1}>
                  {wifiStatus.deviceName || protocolDisplayLabel}
                </Text>
              </View>
              <Text style={styles.wifiAddressText}>
                {tvIp}:{tvPort} · {pairingBadgeText}
              </Text>
            </TouchableOpacity>

            <View style={styles.wifiBarActions}>
              <TouchableOpacity
                style={[styles.scanBtn, isDiscovering && styles.scanBtnActive]}
                activeOpacity={0.8}
                onPress={() => handleScanSmartTvs()}
              >
                {isDiscovering ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.scanBtnText}>البحث عن الشاشات</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.wifiEditBtn}
                onPress={() => setShowWifiModal(true)}
              >
                <Text style={styles.wifiEditLabel}>إعداد</Text>
              </TouchableOpacity>
            </View>
          </View>

          {isConnectingWifi ? (
            <View style={styles.discoveryCard}>
              <View style={styles.discoveryProgressRow}>
                <ActivityIndicator size="small" color="#0EA5E9" />
                <Text style={styles.discoveryStatusText}>
                  جاري الاقتران والاتصال بـ {tvIp}:{tvPort}...
                </Text>
              </View>
            </View>
          ) : null}

          {isDiscovering || hasScannedOnce ? (
            <View style={styles.discoveryCard}>
              <View style={styles.discoveryHeader}>
                <Text style={styles.discoveryTitle}>
                  {isDiscovering
                    ? `جاري فحص الشبكة (${subnetPrefix}.1 - 254)... ${scanProgress.scanned}/${scanProgress.total}`
                    : `الشاشات المكتشفة (${discoveredTvs.length})`}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    if (isDiscovering) {
                      WifiControl.abortDiscovery();
                      setIsDiscovering(false);
                    } else {
                      setHasScannedOnce(false);
                    }
                  }}
                >
                  <Text style={styles.discoveryCloseText}>
                    {isDiscovering ? 'إيقاف' : 'إخفاء'}
                  </Text>
                </TouchableOpacity>
              </View>

              {discoveredTvs.length > 0 ? (
                <View style={styles.discoveryList}>
                  {discoveredTvs.map((device) => {
                    const isSelected = device.ip === tvIp;
                    return (
                      <TouchableOpacity
                        key={`${device.ip}-${device.protocol}`}
                        style={[
                          styles.discoveredItem,
                          isSelected && styles.discoveredItemActive,
                        ]}
                        activeOpacity={0.75}
                        onPress={() => handleSelectDiscoveredTv(device)}
                      >
                        <View style={styles.discoveredMeta}>
                          <Text style={styles.discoveredName}>{device.name}</Text>
                          <Text style={styles.discoveredSub}>
                            {device.modelName} · {device.ip}:{device.port}
                          </Text>
                        </View>
                        <Text style={styles.discoveredConnectTag}>
                          {isSelected && wifiStatus.isConnected ? 'متصل' : 'اتصال'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : !isDiscovering ? (
                <Text style={styles.emptySearchText}>
                  لم يتم العثور على شاشات على النطاق {subnetPrefix}.x — تأكد من تشغيل التلفاز أو عدّل النطاق من "إعداد".
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.rowGap}>
        <TouchableOpacity
          style={styles.powerBtn}
          onPress={() => handleTvCommand('POWER')}
        >
          <Text style={styles.btnTextBold}>طاقة</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleTvCommand('INPUT')}
        >
          <Text style={styles.btnText}>المصدر</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleTvCommand('MUTE')}
        >
          <Text style={styles.btnText}>كتم</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dpadCircle}>
        <View style={styles.dpadRotatedGrid}>
          <RepeatableButton
            style={[
              styles.dpadSector,
              styles.dpadSectorUp,
              activeDpadDir === 'UP' && styles.dpadSectorActive,
            ]}
            activeOpacity={1}
            repeatIntervalMs={180}
            onActiveChange={(active) => setActiveDpadDir(active ? 'UP' : null)}
            onAction={() => handleTvCommand('UP', { burstFrames: 2 })}
          />
          <RepeatableButton
            style={[
              styles.dpadSector,
              styles.dpadSectorRight,
              activeDpadDir === 'RIGHT' && styles.dpadSectorActive,
            ]}
            activeOpacity={1}
            repeatIntervalMs={180}
            onActiveChange={(active) => setActiveDpadDir(active ? 'RIGHT' : null)}
            onAction={() => handleTvCommand('RIGHT', { burstFrames: 2 })}
          />
          <RepeatableButton
            style={[
              styles.dpadSector,
              styles.dpadSectorDown,
              activeDpadDir === 'DOWN' && styles.dpadSectorActive,
            ]}
            activeOpacity={1}
            repeatIntervalMs={180}
            onActiveChange={(active) => setActiveDpadDir(active ? 'DOWN' : null)}
            onAction={() => handleTvCommand('DOWN', { burstFrames: 2 })}
          />
          <RepeatableButton
            style={[
              styles.dpadSector,
              styles.dpadSectorLeft,
              activeDpadDir === 'LEFT' && styles.dpadSectorActive,
            ]}
            activeOpacity={1}
            repeatIntervalMs={180}
            onActiveChange={(active) => setActiveDpadDir(active ? 'LEFT' : null)}
            onAction={() => handleTvCommand('LEFT', { burstFrames: 2 })}
          />
        </View>

        <View style={styles.dpadDotsLayer} pointerEvents="none">
          <View
            style={[
              styles.dpadDot,
              styles.dpadDotUp,
              activeDpadDir === 'UP' && styles.dpadDotActive,
            ]}
          />
          <View
            style={[
              styles.dpadDot,
              styles.dpadDotRight,
              activeDpadDir === 'RIGHT' && styles.dpadDotActive,
            ]}
          />
          <View
            style={[
              styles.dpadDot,
              styles.dpadDotDown,
              activeDpadDir === 'DOWN' && styles.dpadDotActive,
            ]}
          />
          <View
            style={[
              styles.dpadDot,
              styles.dpadDotLeft,
              activeDpadDir === 'LEFT' && styles.dpadDotActive,
            ]}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.dpadOkBtn,
            activeDpadDir === 'OK' && styles.dpadOkBtnActive,
          ]}
          activeOpacity={0.85}
          onPressIn={() => setActiveDpadDir('OK')}
          onPressOut={() => setActiveDpadDir(null)}
          onPress={() => handleTvCommand('OK')}
        >
          <Text style={styles.dpadOkText}>موافق</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.rowGap}>
        <TouchableOpacity style={styles.navBtn} onPress={() => handleTvCommand('BACK')}>
          <Text style={styles.btnText}>رجوع</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} onPress={() => handleTvCommand('HOME')}>
          <Text style={styles.btnText}>الرئيسية</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} onPress={() => handleTvCommand('MENU')}>
          <Text style={styles.btnText}>القائمة</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.rowGap}>
        <View style={styles.rockerCard}>
          <RepeatableButton
            style={styles.rockerKey}
            repeatIntervalMs={180}
            onAction={() => handleTvCommand('VOL_UP', { burstFrames: 2 })}
          >
            <Text style={styles.rockerSymbol}>+</Text>
          </RepeatableButton>
          <Text style={styles.rockerLabel}>الصوت</Text>
          <RepeatableButton
            style={styles.rockerKey}
            repeatIntervalMs={180}
            onAction={() => handleTvCommand('VOL_DOWN', { burstFrames: 2 })}
          >
            <Text style={styles.rockerSymbol}>−</Text>
          </RepeatableButton>
        </View>

        <View style={styles.rockerCard}>
          <RepeatableButton
            style={styles.rockerKey}
            repeatIntervalMs={180}
            onAction={() => handleTvCommand('CH_UP', { burstFrames: 2 })}
          >
            <Text style={styles.rockerSymbol}>▲</Text>
          </RepeatableButton>
          <Text style={styles.rockerLabel}>القناة</Text>
          <RepeatableButton
            style={styles.rockerKey}
            repeatIntervalMs={180}
            onAction={() => handleTvCommand('CH_DOWN', { burstFrames: 2 })}
          >
            <Text style={styles.rockerSymbol}>▼</Text>
          </RepeatableButton>
        </View>
      </View>

      {tvTransport === 'wifi' ? (
        <View style={styles.smartAppsSection}>
          <Text style={styles.sectionCaption}>التطبيقات الذكية</Text>
          <View style={styles.rowGap}>
            <TouchableOpacity
              style={styles.youtubeBtn}
              activeOpacity={0.8}
              onPress={() => handleLaunchYouTube()}
            >
              <Text style={styles.btnTextBold}>YouTube</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.netflixBtn}
              activeOpacity={0.8}
              onPress={() => handleTvCommand('NETFLIX')}
            >
              <Text style={styles.btnTextBold}>Netflix</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {tvTransport === 'wifi' ? (
        <View style={styles.castPanel}>
          <View style={styles.castHeaderRow}>
            <Text style={styles.castPanelTitle}>البحث والتشغيل المباشر (Cast)</Text>
            <TouchableOpacity
              style={styles.launchYtBtn}
              activeOpacity={0.8}
              onPress={handleLaunchYouTube}
              disabled={isLaunchingYouTube}
            >
              {isLaunchingYouTube ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.launchYtBtnText}>فتح YouTube</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionCaption}>بحث يوتيوب</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="ابحث عن فيديو لتشغيله على الشاشة..."
              placeholderTextColor="#64748B"
              returnKeyType="search"
              onSubmitEditing={handleSearchYouTube}
            />
            <TouchableOpacity
              style={styles.searchBtn}
              activeOpacity={0.8}
              onPress={handleSearchYouTube}
              disabled={isSearching}
            >
              {isSearching ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.btnTextBold}>بحث</Text>
              )}
            </TouchableOpacity>
          </View>

          {!isSearching && hasSearchedOnce && searchResults.length === 0 ? (
            <Text style={styles.emptySearchText}>لم يتم العثور على نتائج مطابقة.</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const renderVideoItem = ({ item }) => {
    const isCasting = castingVideoId === item.videoId;
    return (
      <TouchableOpacity
        style={[styles.videoCard, isCasting && styles.videoCardActive]}
        activeOpacity={0.75}
        onPress={() => handleCastVideo(item)}
        disabled={Boolean(castingVideoId)}
      >
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={styles.videoThumb}
          resizeMode="cover"
        />
        <View style={styles.videoInfo}>
          <Text style={styles.videoTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.videoMetaRow}>
            <Text style={styles.videoChannel} numberOfLines={1}>
              {item.channelTitle}
              {item.durationText ? ` · ${item.durationText}` : ''}
            </Text>
            <Text style={styles.videoCastLabel}>
              {isCasting ? 'جاري البث...' : 'تشغيل على الشاشة'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0D11" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>الريموت الشامل</Text>
        <Text style={styles.headerStatus}>
          {Platform.OS === 'web'
            ? 'معاينة الويب (وضع المحاكاة)'
            : hasIrHardware === null
            ? 'جاري فحص IR...'
            : hasIrHardware
            ? 'IR Blaster جاهز'
            : 'وضع Wi-Fi (لا يوجد IR)'}
        </Text>
      </View>

      {feedback.tone === 'error' && feedback.text ? (
        <View style={[styles.feedbackBar, styles.feedbackError]}>
          <Text style={styles.feedbackText} numberOfLines={2}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      {activeTab === 'tv' ? (
        <FlatList
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          data={tvTransport === 'wifi' ? searchResults : []}
          keyExtractor={(item) => item.videoId}
          renderItem={renderVideoItem}
          ListHeaderComponent={tvHeaderElement}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.videoSeparator} />}
        />
      ) : (
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.acScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.acSectionStack}>
            <View style={styles.acRowGap}>
              {[
                { key: 'midea', label: 'Midea AC' },
                { key: 'gree', label: 'Gree AC' },
                { key: 'carrier', label: 'Carrier AC' },
              ].map((b) => (
                <TouchableOpacity
                  key={b.key}
                  style={[styles.acBrandChip, acBrand === b.key && styles.chipBtnActive]}
                  onPress={() => {
                    setAcBrand(b.key);
                    if (b.key === 'midea' && acState.temperature < MIDEA_MIN_TEMP) {
                      setAcState((prev) => ({ ...prev, temperature: MIDEA_MIN_TEMP }));
                    }
                  }}
                >
                  <Text style={styles.acCompactLabel}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.acLcd, !acState.power && styles.acLcdOff]}>
              <View style={styles.acLcdTop}>
                <Text style={styles.acMeta}>الوضع: {currentModeLabel}</Text>
                <Text style={styles.acMeta}>المروحة: {currentFanLabel}</Text>
              </View>
              <Text style={styles.acTemp}>
                {acState.power ? `${acState.temperature}°C` : 'OFF'}
              </Text>
              <Text style={styles.acFooter}>
                الريش: {acState.swing ? 'متحرك' : 'ثابت'} · IR 38kHz
                {acBrand === 'midea' ? ' · Midea' : ''}
              </Text>
            </View>

            <View style={styles.acRowGap}>
              <TouchableOpacity
                style={styles.tempStepBtn}
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
                  acState.power ? styles.acPowerOn : styles.acPowerOff,
                ]}
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
                style={styles.tempStepBtn}
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

            <View style={styles.modesRow}>
              {AC_MODES.map((m) => {
                const active = acState.mode === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[
                      styles.modeChip,
                      active &&
                        (m.key === 'heat' ? styles.modeHeatActive : styles.modeCoolActive),
                    ]}
                    onPress={() =>
                      updateAcAndTransmit({ ...acState, power: true, mode: m.key })
                    }
                  >
                    <Text style={styles.acCompactLabel}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.acRowGap}>
              <TouchableOpacity
                style={styles.extraCard}
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
                style={styles.extraCard}
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
                <View style={styles.modesRow}>
                  <TouchableOpacity
                    style={[styles.acFeatureBtn, acState.turbo && styles.modeCoolActive]}
                    onPress={() =>
                      updateAcAndTransmit(
                        { ...acState, power: true, turbo: !acState.turbo },
                        { specialCommand: 'turbo' }
                      )
                    }
                  >
                    <Text style={styles.acCompactLabel}>تربو</Text>
                    <Text style={styles.acTinyState}>
                      {acState.turbo ? 'مفعّل' : 'Turbo'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.acFeatureBtn, acState.led && styles.modeCoolActive]}
                    onPress={() =>
                      updateAcAndTransmit(
                        { ...acState, led: !acState.led },
                        { specialCommand: 'led' }
                      )
                    }
                  >
                    <Text style={styles.acCompactLabel}>الشاشة</Text>
                    <Text style={styles.acTinyState}>
                      {acState.led ? 'مضيئة' : 'مطفأة'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.acFeatureBtn, acState.clean && styles.modeCoolActive]}
                    onPress={() =>
                      updateAcAndTransmit(
                        { ...acState, clean: !acState.clean },
                        { specialCommand: 'clean' }
                      )
                    }
                  >
                    <Text style={styles.acCompactLabel}>تنظيف</Text>
                    <Text style={styles.acTinyState}>
                      {acState.clean ? 'نشط' : 'Clean'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.acFeatureBtn, acState.sleep && styles.modeCoolActive]}
                    onPress={() =>
                      updateAcAndTransmit(
                        { ...acState, power: true, sleep: !acState.sleep },
                        { specialCommand: 'sleep' }
                      )
                    }
                  >
                    <Text style={styles.acCompactLabel}>نوم</Text>
                    <Text style={styles.acTinyState}>
                      {acState.sleep ? 'مفعّل' : 'Sleep'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[
                    styles.timerCard,
                    acTimerSeconds > 0 && styles.modeCoolActive,
                  ]}
                  onPress={handleOpenTimerModal}
                >
                  <View style={styles.timerRow}>
                    <Text style={styles.btnText}>المؤقت (Timer)</Text>
                    <Text style={styles.timerValue} numberOfLines={1}>
                      {acTimerSeconds > 0
                        ? `${acTimerAction === 'on' ? 'تشغيل' : 'إطفاء'} ${formatTargetClockLabel(Math.ceil(acTimerSeconds / 60))}`
                        : 'ضبط (30د – 24س)'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </ScrollView>
      )}

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'tv' && styles.tabBtnActive]}
          onPress={() => setActiveTab('tv')}
        >
          <Text style={[styles.tabText, activeTab === 'tv' && styles.tabTextActive]}>
            ريموت الشاشة
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'ac' && styles.tabBtnActive]}
          onPress={() => setActiveTab('ac')}
        >
          <Text style={[styles.tabText, activeTab === 'ac' && styles.tabTextActive]}>
            ريموت التكييف
          </Text>
        </TouchableOpacity>
      </View>

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
                  {isDiscovering ? 'إيقاف الفحص' : 'البحث عن الشاشات (Scan)'}
                </Text>
              </TouchableOpacity>
            </View>

            {discoveredTvs.length > 0 ? (
              <View style={styles.modalDiscoveryList}>
                {discoveredTvs.map((device) => (
                  <TouchableOpacity
                    key={`modal-${device.ip}-${device.protocol}`}
                    style={styles.discoveredItem}
                    onPress={() => handleSelectDiscoveredTv(device)}
                  >
                    <View style={styles.discoveredMeta}>
                      <Text style={styles.discoveredName}>{device.name}</Text>
                      <Text style={styles.discoveredSub}>
                        {device.modelName} · {device.ip}:{device.port}
                      </Text>
                    </View>
                    <Text style={styles.discoveredConnectTag}>اختيار</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
            <Text style={styles.modalTitle}>مؤقت مكيف الهواء (Timer)</Text>
            <Text style={styles.timerModalHint}>
              حدد الوقت المطلوب (بنفس تدرج ريموت Midea من 30 دقيقة حتى 24 ساعة)
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

            {acTimerSeconds > 0 ? (
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2532',
  },
  headerTitle: { color: '#F1F5F9', fontSize: 19, fontWeight: '700' },
  headerStatus: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
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
  scrollContent: { padding: 14, paddingBottom: 24 },
  sectionStack: { gap: 12 },
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: '#131720',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
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
  wifiSectionWrap: { gap: 8 },
  wifiBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    gap: 8,
  },
  wifiInfoTouchable: { flex: 1, gap: 3 },
  wifiStatusHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOn: { backgroundColor: '#22C55E' },
  statusDotIdle: { backgroundColor: '#64748B' },
  wifiDeviceTitle: { color: '#F1F5F9', fontSize: 13, fontWeight: '700', flex: 1 },
  wifiAddressText: { color: '#94A3B8', fontSize: 11, fontFamily: 'monospace' },
  wifiBarActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scanBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanBtnActive: { backgroundColor: '#F59E0B' },
  scanBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  wifiEditBtn: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wifiEditLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
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
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtn: {
    flex: 1,
    minHeight: 48,
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
    width: 248,
    height: 248,
    borderRadius: 124,
    backgroundColor: '#171E2C',
    borderWidth: 1,
    borderColor: '#253044',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    direction: 'ltr',
    marginVertical: 4,
  },
  dpadRotatedGrid: {
    position: 'absolute',
    width: 352,
    height: 352,
    top: -52,
    left: -52,
    transform: [{ rotate: '45deg' }],
  },
  dpadSector: {
    position: 'absolute',
    width: 176,
    height: 176,
    backgroundColor: 'transparent',
  },
  dpadSectorUp: { top: 0, left: 0 },
  dpadSectorRight: { top: 0, left: 176 },
  dpadSectorDown: { top: 176, left: 176 },
  dpadSectorLeft: { top: 176, left: 0 },
  dpadSectorActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.14)',
  },
  dpadDotsLayer: {
    position: 'absolute',
    width: 248,
    height: 248,
    top: 0,
    left: 0,
    zIndex: 5,
  },
  dpadDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#64748B',
  },
  dpadDotActive: {
    backgroundColor: '#38BDF8',
    transform: [{ scale: 1.35 }],
  },
  dpadDotUp: { top: 34, left: 120 },
  dpadDotRight: { right: 34, top: 120 },
  dpadDotDown: { bottom: 34, left: 120 },
  dpadDotLeft: { left: 34, top: 120 },
  dpadOkBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
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
    minHeight: 46,
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
    padding: 8,
    alignItems: 'center',
    gap: 8,
  },
  rockerKey: {
    width: '100%',
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#1A202C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rockerSymbol: { color: '#F1F5F9', fontSize: 20, fontWeight: '700' },
  rockerLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  smartAppsSection: { gap: 8, marginTop: 2 },
  youtubeBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  netflixBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#991B1B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  castPanel: {
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: '#131720',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 14,
    gap: 10,
  },
  castHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  castPanelTitle: {
    color: '#F1F5F9',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  launchYtBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  launchYtBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#F1F5F9',
    fontSize: 13,
    textAlign: 'right',
  },
  searchBtn: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptySearchText: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
  },
  videoSeparator: {
    height: 10,
  },
  videoCard: {
    flexDirection: 'row',
    backgroundColor: '#131720',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2532',
    overflow: 'hidden',
    minHeight: 84,
  },
  videoCardActive: {
    borderColor: '#0EA5E9',
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  videoThumb: {
    width: 124,
    height: 84,
    backgroundColor: '#0B0D11',
  },
  videoInfo: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
    gap: 6,
  },
  videoTitle: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  videoMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  videoChannel: {
    color: '#94A3B8',
    fontSize: 11,
    flex: 1,
    textAlign: 'right',
  },
  videoCastLabel: {
    color: '#0EA5E9',
    fontSize: 11,
    fontWeight: '700',
  },
  acScrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  acSectionStack: { gap: 9 },
  acRowGap: { flexDirection: 'row', gap: 8 },
  acBrandChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acCompactLabel: { color: '#F1F5F9', fontSize: 12, fontWeight: '600' },
  acTinyState: { color: '#94A3B8', fontSize: 10, fontWeight: '500' },
  acLcd: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
  },
  acLcdOff: { opacity: 0.5 },
  acLcdTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },
  acMeta: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  acTemp: {
    color: '#F1F5F9',
    fontSize: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  acFooter: { color: '#0EA5E9', fontSize: 11, fontWeight: '600' },
  tempStepBtn: {
    width: 66,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerOn: { backgroundColor: '#EF4444' },
  acPowerOff: { backgroundColor: '#16A34A' },
  sectionCaption: { color: '#94A3B8', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  modesRow: { flexDirection: 'row', gap: 6 },
  modeChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeCoolActive: { borderColor: '#0EA5E9', backgroundColor: 'rgba(14,165,233,0.16)' },
  modeHeatActive: { borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.16)' },
  extraCard: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  extraCaption: { color: '#94A3B8', fontSize: 11 },
  acFeatureBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  timerCard: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingVertical: 10,
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
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1E2532',
    backgroundColor: '#131720',
    padding: 8,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    minHeight: 48,
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
});

export default App;
