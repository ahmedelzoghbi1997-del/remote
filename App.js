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

const IrManagerModule = Platform.OS === 'web' ? null : NativeModules?.IrManagerModule;

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

function encodeSamsungDual0707(commandHex, addressHigh = 0x07, addressLow = 0x07) {
  const cmd = commandHex & 0xff;
  const cmdInv = ~cmd & 0xff;
  const pattern = [4500, 4500];
  pushByteLsbFirst(pattern, addressHigh);
  pushByteLsbFirst(pattern, addressLow);
  pushByteLsbFirst(pattern, cmd);
  pushByteLsbFirst(pattern, cmdInv);
  pattern.push(560);
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

function buildAcIrPattern(brandKey, acState) {
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

/**
 * أيقونات هندسية فائقة الدقة مبنية بـ View لضمان المظهر العصري المتناسق دون الاعتماد على خطوط خارجية
 */
function RemoteIcon({ name, color = '#F5F5F7', size = 22 }) {
  if (name === 'power') {
    const ringSize = Math.round(size * 0.86);
    const stemH = Math.round(size * 0.44);
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: 2.3,
            borderColor: color,
            borderTopColor: 'transparent',
            position: 'absolute',
            bottom: 1,
          }}
        />
        <View
          style={{
            width: 2.4,
            height: stemH,
            borderRadius: 2,
            backgroundColor: color,
            position: 'absolute',
            top: 1,
          }}
        />
      </View>
    );
  }

  if (name === 'mute') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={iconStyles.speakerRow}>
          <View
            style={{
              width: 5,
              height: 8,
              backgroundColor: color,
              borderTopLeftRadius: 1.5,
              borderBottomLeftRadius: 1.5,
            }}
          />
          <View
            style={{
              width: 0,
              height: 0,
              borderTopWidth: 7,
              borderBottomWidth: 7,
              borderRightWidth: 6,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              borderRightColor: color,
              marginLeft: -1,
            }}
          />
        </View>
        <View
          style={{
            position: 'absolute',
            width: size * 0.9,
            height: 2.2,
            borderRadius: 2,
            backgroundColor: '#FF453A',
            transform: [{ rotate: '-42deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'volume') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={iconStyles.speakerRow}>
          <View
            style={{
              width: 4,
              height: 7,
              backgroundColor: color,
              borderTopLeftRadius: 1.5,
              borderBottomLeftRadius: 1.5,
            }}
          />
          <View
            style={{
              width: 0,
              height: 0,
              borderTopWidth: 6,
              borderBottomWidth: 6,
              borderRightWidth: 5,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              borderRightColor: color,
              marginLeft: -1,
            }}
          />
          <View
            style={{
              width: 4,
              height: 9,
              borderRightWidth: 1.8,
              borderTopRightRadius: 5,
              borderBottomRightRadius: 5,
              borderColor: color,
              marginLeft: 2,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'channel') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.84,
            height: size * 0.58,
            borderRadius: 3.5,
            borderWidth: 1.8,
            borderColor: color,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: color,
              opacity: 0.7,
            }}
          />
        </View>
        <View
          style={{
            width: size * 0.36,
            height: 1.8,
            backgroundColor: color,
            borderRadius: 1,
            marginTop: 2,
          }}
        />
      </View>
    );
  }

  if (name === 'input') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.85,
            height: size * 0.64,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: color,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderTopWidth: 2,
              borderRightWidth: 2,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              marginLeft: -2,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'home') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: 11,
            height: 11,
            borderTopWidth: 2.2,
            borderLeftWidth: 2.2,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
            marginBottom: -5,
          }}
        />
        <View
          style={{
            width: 13,
            height: 9,
            borderLeftWidth: 2,
            borderRightWidth: 2,
            borderBottomWidth: 2,
            borderBottomLeftRadius: 2,
            borderBottomRightRadius: 2,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              width: 4,
              height: 4,
              backgroundColor: color,
              borderTopLeftRadius: 1,
              borderTopRightRadius: 1,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'back') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderBottomWidth: 2.3,
              borderLeftWidth: 2.3,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              marginRight: -5,
            }}
          />
          <View
            style={{
              width: 11,
              height: 2.3,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'menu') {
    return (
      <View style={[iconStyles.box, { width: size, height: size, gap: 4 }]}>
        <View style={{ width: 15, height: 2, borderRadius: 1, backgroundColor: color }} />
        <View style={{ width: 15, height: 2, borderRadius: 1, backgroundColor: color }} />
        <View style={{ width: 15, height: 2, borderRadius: 1, backgroundColor: color }} />
      </View>
    );
  }

  if (name === 'plus') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={{ width: 14, height: 2.4, borderRadius: 1.5, backgroundColor: color }} />
        <View
          style={{
            position: 'absolute',
            width: 2.4,
            height: 14,
            borderRadius: 1.5,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'minus') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={{ width: 14, height: 2.4, borderRadius: 1.5, backgroundColor: color }} />
      </View>
    );
  }

  // أسهم الاتجاهات (chevron_up, chevron_down, chevron_left, chevron_right)
  const rotationMap = {
    chevron_up: '-45deg',
    chevron_right: '45deg',
    chevron_down: '135deg',
    chevron_left: '-135deg',
  };
  const rotation = rotationMap[name] || '0deg';
  const armSize = Math.round(size * 0.48);

  return (
    <View style={[iconStyles.box, { width: size, height: size }]}>
      <View
        style={{
          width: armSize,
          height: armSize,
          borderTopWidth: 2.5,
          borderRightWidth: 2.5,
          borderColor: color,
          borderTopRightRadius: 1.5,
          transform: [{ rotate: rotation }],
        }}
      />
    </View>
  );
}

const iconStyles = StyleSheet.create({
  box: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

function RepeatableButton({
  onAction,
  repeatIntervalMs = 130,
  initialDelayMs = 220,
  style,
  activeOpacity = 0.6,
  hitSlop,
  children,
}) {
  const holdTimerRef = useRef(null);
  const repeatTimerRef = useRef(null);
  const latestActionRef = useRef(onAction);

  latestActionRef.current = onAction;

  const clearTimers = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const handlePressIn = () => {
    clearTimers();
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
  const [tvBrand, setTvBrand] = useState('samsung');
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
  const [acBrand, setAcBrand] = useState('gree');
  const [acState, setAcState] = useState({
    power: true,
    temperature: 22,
    mode: 'cool',
    fanSpeed: 'auto',
    swing: true,
  });

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
      return { mocked: true, pulseCount: pattern.length, carrierFrequency: CARRIER_38KHZ };
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

  const handleTvCommand = async (commandKey) => {
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
        const pattern =
          brand.protocol === 'samsung_dual'
            ? encodeSamsungDual0707(cmdHex, brand.addressHigh, brand.addressLow)
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

  const updateAcAndTransmit = async (nextAcState) => {
    setAcState(nextAcState);
    try {
      const pattern = buildAcIrPattern(acBrand, nextAcState);
      await transmitIrPattern(pattern);
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر إرسال أمر التكييف',
        tone: 'error',
      });
    }
  };

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
      {/* مبدّل وضع الإرسال بأسلوب كبسولة OLED أنيقة */}
      <View style={styles.segmentBox}>
        <TouchableOpacity
          style={[styles.segmentBtn, tvTransport === 'ir' && styles.segmentActive]}
          onPress={() => setTvTransport('ir')}
        >
          <Text
            style={[styles.segmentText, tvTransport === 'ir' && styles.segmentTextActive]}
          >
            أشعة IR
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, tvTransport === 'wifi' && styles.segmentActive]}
          onPress={() => setTvTransport('wifi')}
        >
          <Text
            style={[styles.segmentText, tvTransport === 'wifi' && styles.segmentTextActive]}
          >
            واي فاي (Smart TV)
          </Text>
        </TouchableOpacity>
      </View>

      {tvTransport === 'ir' ? (
        <View style={styles.rowGap}>
          {['samsung', 'lg'].map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.chipBtn, tvBrand === key && styles.chipBtnActive]}
              onPress={() => setTvBrand(key)}
            >
              <Text style={[styles.chipText, tvBrand === key && styles.chipTextActive]}>
                {TV_IR_BRANDS[key].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
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
                <ActivityIndicator size="small" color="#0A84FF" />
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
      )}

      {/* الصف العلوي: أزرار دائرية نقية بأيقونات (طاقة، المصدر، كتم) */}
      <View style={styles.circleControlsRow}>
        <TouchableOpacity
          style={styles.powerCircleBtn}
          activeOpacity={0.75}
          onPress={() => handleTvCommand('POWER')}
        >
          <RemoteIcon name="power" color="#FFFFFF" size={24} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.utilityCircleBtn}
          activeOpacity={0.75}
          onPress={() => handleTvCommand('INPUT')}
        >
          <RemoteIcon name="input" color="#E5E5EA" size={22} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.utilityCircleBtn}
          activeOpacity={0.75}
          onPress={() => handleTvCommand('MUTE')}
        >
          <RemoteIcon name="mute" color="#E5E5EA" size={22} />
        </TouchableOpacity>
      </View>

      {/* الدائرة المركزية الموحدة بدون فواصل حادة (Apple TV / Samsung Touchpad Style) */}
      <View style={styles.dpadOuterContainer}>
        <View style={styles.dpadSurface}>
          <RepeatableButton
            style={styles.dpadTouchZoneTopBottom}
            repeatIntervalMs={130}
            onAction={() => handleTvCommand('UP')}
          >
            <RemoteIcon name="chevron_up" color="#D1D1D6" size={22} />
          </RepeatableButton>

          <View style={styles.dpadMiddleBand}>
            <RepeatableButton
              style={styles.dpadTouchZoneSide}
              repeatIntervalMs={130}
              onAction={() => handleTvCommand('RIGHT')}
            >
              <RemoteIcon name="chevron_right" color="#D1D1D6" size={22} />
            </RepeatableButton>

            <TouchableOpacity
              style={styles.dpadOkCircle}
              activeOpacity={0.82}
              onPress={() => handleTvCommand('OK')}
            >
              <Text style={styles.dpadOkText}>OK</Text>
            </TouchableOpacity>

            <RepeatableButton
              style={styles.dpadTouchZoneSide}
              repeatIntervalMs={130}
              onAction={() => handleTvCommand('LEFT')}
            >
              <RemoteIcon name="chevron_left" color="#D1D1D6" size={22} />
            </RepeatableButton>
          </View>

          <RepeatableButton
            style={styles.dpadTouchZoneTopBottom}
            repeatIntervalMs={130}
            onAction={() => handleTvCommand('DOWN')}
          >
            <RemoteIcon name="chevron_down" color="#D1D1D6" size={22} />
          </RepeatableButton>
        </View>
      </View>

      {/* أزرار التنقل السفلية الدائرية بأيقونات (رجوع، الرئيسية، القائمة) */}
      <View style={styles.circleControlsRow}>
        <TouchableOpacity
          style={styles.utilityCircleBtn}
          activeOpacity={0.75}
          onPress={() => handleTvCommand('BACK')}
        >
          <RemoteIcon name="back" color="#E5E5EA" size={22} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.utilityCircleBtn}
          activeOpacity={0.75}
          onPress={() => handleTvCommand('HOME')}
        >
          <RemoteIcon name="home" color="#E5E5EA" size={22} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.utilityCircleBtn}
          activeOpacity={0.75}
          onPress={() => handleTvCommand('MENU')}
        >
          <RemoteIcon name="menu" color="#E5E5EA" size={22} />
        </TouchableOpacity>
      </View>

      {/* الكبسولات العمودية للصوت والقنوات (Vertical Pill Capsules) */}
      <View style={styles.pillsOuterContainer}>
        <View style={styles.pillsRow}>
          <View style={styles.verticalPill}>
            <RepeatableButton
              style={styles.pillHalfBtn}
              repeatIntervalMs={120}
              onAction={() => handleTvCommand('VOL_UP')}
            >
              <RemoteIcon name="plus" color="#F5F5F7" size={20} />
            </RepeatableButton>

            <View style={styles.pillCenterIconWrap} pointerEvents="none">
              <RemoteIcon name="volume" color="#8E8E93" size={18} />
            </View>

            <RepeatableButton
              style={styles.pillHalfBtn}
              repeatIntervalMs={120}
              onAction={() => handleTvCommand('VOL_DOWN')}
            >
              <RemoteIcon name="minus" color="#F5F5F7" size={20} />
            </RepeatableButton>
          </View>

          <View style={styles.verticalPill}>
            <RepeatableButton
              style={styles.pillHalfBtn}
              repeatIntervalMs={150}
              onAction={() => handleTvCommand('CH_UP')}
            >
              <RemoteIcon name="chevron_up" color="#F5F5F7" size={20} />
            </RepeatableButton>

            <View style={styles.pillCenterIconWrap} pointerEvents="none">
              <RemoteIcon name="channel" color="#8E8E93" size={18} />
            </View>

            <RepeatableButton
              style={styles.pillHalfBtn}
              repeatIntervalMs={150}
              onAction={() => handleTvCommand('CH_DOWN')}
            >
              <RemoteIcon name="chevron_down" color="#F5F5F7" size={20} />
            </RepeatableButton>
          </View>
        </View>
      </View>

      {tvTransport === 'wifi' ? (
        <>
          {/* التطبيقات الذكية */}
          <View style={styles.smartAppsSection}>
            <Text style={styles.sectionCaption}>التطبيقات الذكية</Text>
            <View style={styles.rowGap}>
              <TouchableOpacity
                style={styles.youtubeBtn}
                activeOpacity={0.8}
                onPress={handleLaunchYouTube}
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
                placeholderTextColor="#636366"
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
        </>
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
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>ريموت</Text>
        <View style={styles.headerStatusPill}>
          <View
            style={[
              styles.statusDot,
              hasIrHardware || wifiStatus.isConnected
                ? styles.statusDotOn
                : styles.statusDotIdle,
            ]}
          />
          <Text style={styles.headerStatus}>
            {Platform.OS === 'web'
              ? 'معاينة UI'
              : hasIrHardware === null
              ? 'جاري الفحص...'
              : hasIrHardware
              ? 'IR جاهز'
              : 'Wi-Fi'}
          </Text>
        </View>
      </View>

      {feedback.tone === 'error' && feedback.text ? (
        <View style={[styles.feedbackBar, styles.feedbackError]}>
          <Text style={styles.feedbackText} numberOfLines={2}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      {activeTab === 'tv' ? (
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {tvHeaderElement}
          {tvTransport === 'wifi' && searchResults.length > 0 ? (
            <View style={styles.videoListWrap}>
              {searchResults.map((item) => (
                <View key={item.videoId} style={styles.videoItemSpacing}>
                  {renderVideoItem({ item })}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionStack}>
            <View style={styles.rowGap}>
              {[
                { key: 'gree', label: 'Gree AC' },
                { key: 'carrier', label: 'Carrier AC' },
              ].map((b) => (
                <TouchableOpacity
                  key={b.key}
                  style={[styles.chipBtn, acBrand === b.key && styles.chipBtnActive]}
                  onPress={() => setAcBrand(b.key)}
                >
                  <Text style={[styles.chipText, acBrand === b.key && styles.chipTextActive]}>
                    {b.label}
                  </Text>
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
                توجيه الهواء: {acState.swing ? 'متحرك' : 'ثابت'} · IR 38kHz
              </Text>
            </View>

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={styles.tempStepBtn}
                onPress={() => {
                  const nextTemp = Math.max(16, acState.temperature - 1);
                  if (nextTemp !== acState.temperature) {
                    updateAcAndTransmit({
                      ...acState,
                      power: true,
                      temperature: nextTemp,
                    });
                  }
                }}
              >
                <RemoteIcon name="minus" color="#F5F5F7" size={22} />
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
                <RemoteIcon name="power" color="#FFFFFF" size={24} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.tempStepBtn}
                onPress={() => {
                  const nextTemp = Math.min(30, acState.temperature + 1);
                  if (nextTemp !== acState.temperature) {
                    updateAcAndTransmit({
                      ...acState,
                      power: true,
                      temperature: nextTemp,
                    });
                  }
                }}
              >
                <RemoteIcon name="plus" color="#F5F5F7" size={22} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionCaption}>وضع التشغيل</Text>
            <View style={styles.modesWrap}>
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
                    <Text style={styles.btnText}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.rowGap}>
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
                <Text style={styles.btnTextBold}>{currentFanLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.extraCard}
                onPress={() => {
                  const nextSwing = !acState.swing;
                  updateAcAndTransmit({ ...acState, power: true, swing: nextSwing });
                }}
              >
                <Text style={styles.extraCaption}>تأرجح الريش</Text>
                <Text style={styles.btnTextBold}>
                  {acState.swing ? 'يعمل' : 'متوقف'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'tv' && styles.tabBtnActive]}
          onPress={() => setActiveTab('tv')}
        >
          <Text style={[styles.tabText, activeTab === 'tv' && styles.tabTextActive]}>
            الشاشة
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'ac' && styles.tabBtnActive]}
          onPress={() => setActiveTab('ac')}
        >
          <Text style={[styles.tabText, activeTab === 'ac' && styles.tabTextActive]}>
            التكييف
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
                <Text
                  style={[
                    styles.chipText,
                    wifiProtocol === 'samsung_tizen' && styles.chipTextActive,
                  ]}
                >
                  Samsung Tizen
                </Text>
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
                <Text
                  style={[
                    styles.chipText,
                    wifiProtocol === 'android_tv' && styles.chipTextActive,
                  ]}
                >
                  Android TV
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chipBtn, wifiProtocol === 'roku' && styles.chipBtnActive]}
                onPress={() => {
                  setWifiProtocol('roku');
                  setTvPort('8060');
                  setDialPort('8060');
                }}
              >
                <Text
                  style={[styles.chipText, wifiProtocol === 'roku' && styles.chipTextActive]}
                >
                  Roku ECP
                </Text>
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
                  placeholderTextColor="#636366"
                />
              </View>
              <TouchableOpacity
                style={[styles.modalScanBtn, isDiscovering && styles.scanBtnActive]}
                onPress={() => handleScanSmartTvs()}
              >
                <Text style={styles.btnTextBold}>
                  {isDiscovering ? 'إيقاف الفحص' : 'البحث عن الشاشات'}
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
              placeholderTextColor="#636366"
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
                  placeholderTextColor="#636366"
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
                  placeholderTextColor="#636366"
                />
              </View>
            </View>

            {wifiProtocol === 'samsung_tizen' ? (
              <View style={styles.tokenStatusBox}>
                <Text style={styles.tokenStatusLabel}>
                  حالة الاقتران:{' '}
                  {wifiStatus.hasSavedToken
                    ? 'Token محفوظ محلياً'
                    : 'سيتم طلب الموافقة عند أول اتصال'}
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
                style={styles.modalCancelBtn}
                onPress={() => setShowWifiModal(false)}
              >
                <Text style={styles.btnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCancelBtn, styles.modalSaveBtn]}
                onPress={handleSaveWifi}
              >
                <Text style={styles.btnTextBold}>حفظ واتصال</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // لوحة ألوان OLED Black الحديثة المستوحاة من Apple TV و Samsung Smart
  root: { flex: 1, width: '100%', backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexShrink: 0,
  },
  headerTitle: {
    color: '#F5F5F7',
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#141416',
  },
  headerStatus: { color: '#8E8E93', fontSize: 12, fontWeight: '600' },
  feedbackBar: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
    flexShrink: 0,
  },
  feedbackError: {
    backgroundColor: 'rgba(255,59,48,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.45)',
  },
  feedbackText: { color: '#F5F5F7', fontSize: 12, textAlign: 'center' },
  scrollArea: { flex: 1, width: '100%' },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 32,
    flexGrow: 1,
  },
  sectionStack: { width: '100%', gap: 18 },

  // مبدّل الوضع العلوي (IR / Wi-Fi) بأسلوب كبسولة ناعم
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: '#141416',
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: '#0A84FF' },
  segmentText: { color: '#8E8E93', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#FFFFFF', fontWeight: '700' },

  rowGap: { flexDirection: 'row', gap: 10 },
  chipBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: '#141416',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  chipBtnActive: {
    backgroundColor: 'rgba(10,132,255,0.2)',
    borderWidth: 1,
    borderColor: '#0A84FF',
  },
  chipText: { color: '#8E8E93', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },

  // شريط Wi-Fi والاكتشاف
  wifiSectionWrap: { gap: 10 },
  wifiBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#141416',
    gap: 8,
  },
  wifiInfoTouchable: { flex: 1, gap: 3 },
  wifiStatusHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusDotOn: { backgroundColor: '#30D158' },
  statusDotIdle: { backgroundColor: '#636366' },
  wifiDeviceTitle: { color: '#F5F5F7', fontSize: 13, fontWeight: '700', flex: 1 },
  wifiAddressText: { color: '#8E8E93', fontSize: 11, fontFamily: 'monospace' },
  wifiBarActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scanBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#0A84FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanBtnActive: { backgroundColor: '#FF9F0A' },
  scanBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  wifiEditBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#2C2C2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wifiEditLabel: { color: '#E5E5EA', fontSize: 12, fontWeight: '600' },

  discoveryCard: {
    backgroundColor: '#141416',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  discoveryProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discoveryStatusText: { color: '#F5F5F7', fontSize: 12, fontWeight: '600' },
  discoveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  discoveryTitle: { color: '#F5F5F7', fontSize: 12, fontWeight: '700', flex: 1 },
  discoveryCloseText: { color: '#0A84FF', fontSize: 12, fontWeight: '700' },
  discoveryList: { gap: 8 },
  discoveredItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  discoveredItemActive: {
    borderWidth: 1,
    borderColor: '#0A84FF',
    backgroundColor: 'rgba(10,132,255,0.14)',
  },
  discoveredMeta: { flex: 1, gap: 2 },
  discoveredName: { color: '#F5F5F7', fontSize: 13, fontWeight: '700', textAlign: 'right' },
  discoveredSub: { color: '#8E8E93', fontSize: 11, textAlign: 'right' },
  discoveredConnectTag: { color: '#0A84FF', fontSize: 12, fontWeight: '700' },

  // صفوف الأزرار الدائرية العلوية والسفلية
  circleControlsRow: {
    width: '100%',
    minHeight: 58,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 28,
    flexShrink: 0,
  },
  powerCircleBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    flexShrink: 0,
  },
  utilityCircleBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },

  // الدائرة المركزية الموحدة بدون أي خطوط فاصلة حادة (Seamless Touchpad D-Pad)
  dpadOuterContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flexShrink: 0,
  },
  dpadSurface: {
    width: 248,
    minHeight: 248,
    height: 248,
    borderRadius: 124,
    backgroundColor: '#161618',
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
    paddingVertical: 6,
    paddingHorizontal: 6,
    flexShrink: 0,
  },
  dpadTouchZoneTopBottom: {
    flex: 1,
    minHeight: 72,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadMiddleBand: {
    width: '100%',
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  dpadTouchZoneSide: {
    flex: 1,
    minHeight: 84,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadOkCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#38BDF8',
    borderWidth: 2,
    borderColor: '#7DD3FC',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    flexShrink: 0,
  },
  dpadOkText: {
    color: '#001524',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // كبسولات الصوت والقنوات العمودية (Vertical Pill Capsules)
  pillsOuterContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    flexShrink: 0,
  },
  pillsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 32,
  },
  verticalPill: {
    width: 78,
    minHeight: 172,
    borderRadius: 39,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    paddingVertical: 4,
    flexShrink: 0,
  },
  pillHalfBtn: {
    flex: 1,
    minHeight: 68,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillCenterIconWrap: {
    height: 24,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },

  // التطبيقات الذكية
  smartAppsSection: { gap: 10, marginTop: 4 },
  youtubeBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  netflixBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#8E1A1A',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // لوحة البث والبحث في يوتيوب عبر الواي فاي
  castPanel: {
    marginTop: 2,
    backgroundColor: '#141416',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  castHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  castPanelTitle: {
    color: '#F5F5F7',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  launchYtBtn: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  launchYtBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#F5F5F7',
    fontSize: 13,
    textAlign: 'right',
  },
  searchBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#0A84FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptySearchText: {
    color: '#8E8E93',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
  },
  videoListWrap: { width: '100%', marginTop: 14, gap: 10 },
  videoItemSpacing: { width: '100%' },
  videoSeparator: { height: 10 },
  videoCard: {
    flexDirection: 'row',
    backgroundColor: '#141416',
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 84,
  },
  videoCardActive: {
    borderWidth: 1,
    borderColor: '#0A84FF',
    backgroundColor: 'rgba(10,132,255,0.14)',
  },
  videoThumb: {
    width: 124,
    height: 84,
    backgroundColor: '#1C1C1E',
  },
  videoInfo: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
    gap: 6,
  },
  videoTitle: {
    color: '#F5F5F7',
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
    color: '#8E8E93',
    fontSize: 11,
    flex: 1,
    textAlign: 'right',
  },
  videoCastLabel: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },

  // واجهة ريموت التكييف بنسق OLED
  acLcd: {
    backgroundColor: '#141416',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  acLcdOff: { opacity: 0.45 },
  acLcdTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },
  acMeta: { color: '#8E8E93', fontSize: 13, fontWeight: '600' },
  acTemp: {
    color: '#F5F5F7',
    fontSize: 54,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  acFooter: { color: '#38BDF8', fontSize: 12, fontWeight: '600' },
  tempStepBtn: {
    width: 68,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerBtn: {
    flex: 1,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerOn: { backgroundColor: '#FF3B30' },
  acPowerOff: { backgroundColor: '#30D158' },
  sectionCaption: { color: '#8E8E93', fontSize: 12, fontWeight: '600', textAlign: 'right' },
  modesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeChip: {
    width: '31%',
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#141416',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeCoolActive: {
    backgroundColor: 'rgba(10,132,255,0.2)',
    borderWidth: 1,
    borderColor: '#0A84FF',
  },
  modeHeatActive: {
    backgroundColor: 'rgba(255,159,10,0.2)',
    borderWidth: 1,
    borderColor: '#FF9F0A',
  },
  extraCard: {
    flex: 1,
    minHeight: 62,
    borderRadius: 16,
    backgroundColor: '#141416',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  extraCaption: { color: '#8E8E93', fontSize: 12 },

  btnText: { color: '#F5F5F7', fontSize: 13, fontWeight: '600' },
  btnTextBold: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  // شريط التبويب السفلي
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0A0A0C',
    borderTopWidth: 1,
    borderTopColor: '#1C1C1E',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  tabBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: '#141416',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: '#0A84FF',
  },
  tabText: { color: '#8E8E93', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF', fontWeight: '700' },

  // نافذة إعداد الواي فاي
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#141416',
    borderRadius: 22,
    padding: 20,
    gap: 12,
  },
  modalTitle: { color: '#F5F5F7', fontSize: 16, fontWeight: '700', textAlign: 'right' },
  inputLabel: { color: '#8E8E93', fontSize: 12, textAlign: 'right', marginBottom: 4 },
  portField: { flex: 1 },
  input: {
    minHeight: 44,
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#F5F5F7',
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
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#0A84FF',
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
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tokenStatusLabel: { color: '#8E8E93', fontSize: 12, flex: 1, textAlign: 'right' },
  clearTokenText: { color: '#FF3B30', fontSize: 12, fontWeight: '700' },
  modalCancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSaveBtn: { backgroundColor: '#0A84FF' },
});

export default App;
