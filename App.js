import React, { useEffect, useRef, useState } from 'react';
import {
  I18nManager,
  NativeModules,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import AcRemote from './src/components/AcRemote';
import RemoteIcon from './src/components/RemoteIcon';
import TvRemote from './src/components/TvRemote';
import WifiSheet from './src/components/WifiSheet';
import {
  CARRIER_38KHZ,
  TV_IR_BRANDS,
  buildAcIrPattern,
  encodeNecToMicroseconds,
  encodeSamsungDual0707,
} from './src/ir/encoders';
import WifiControl from './src/services/WifiControl';
import { colors, fontSizes, radii, spacing } from './src/theme';

const IrManagerModule = Platform.OS === 'web' ? null : NativeModules?.IrManagerModule;

if (Platform.OS !== 'web' && I18nManager && !I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

function triggerHaptic(type = 'impactLight') {
  try {
    if (Platform.OS === 'web') return;
    const nativeHaptic =
      NativeModules?.RNReactNativeHapticFeedback || NativeModules?.RNHapticFeedback;
    if (nativeHaptic && typeof nativeHaptic.trigger === 'function') {
      nativeHaptic.trigger(type, {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
      return;
    }
    const duration =
      type === 'impactMedium' ? 14 : type === 'notificationSuccess' ? 18 : 8;
    if (Vibration && typeof Vibration.vibrate === 'function') {
      Vibration.vibrate(duration);
    }
  } catch (_) {
    // تجاهل أي خطأ إذا كان الاهتزاز غير مدعوم
  }
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

  // حالة البحث وبث يوتيوب
  const [isLaunchingYouTube, setIsLaunchingYouTube] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearchedOnce, setHasSearchedOnce] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [castingVideoId, setCastingVideoId] = useState(null);

  // حالة ريموت التكييف
  const [acBrand, setAcBrand] = useState('gree');
  const [acState, setAcState] = useState({
    power: true,
    temperature: 22,
    mode: 'cool',
    fanSpeed: 'auto',
    swing: true,
  });

  const lastCommandTimeRef = useRef(0);

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
    };
  }, []);

  // التبديل التلقائي إلى Wi-Fi إذا كان الهاتف لا يدعم IR
  useEffect(() => {
    if (hasIrHardware === false) {
      setTvTransport('wifi');
    }
  }, [hasIrHardware]);

  // إخفاء شريط التنبيه تلقائياً بعد 1200ms
  useEffect(() => {
    if (!feedback.text) return undefined;
    const timer = setTimeout(() => {
      setFeedback({ text: '', tone: 'neutral' });
    }, 1200);
    return () => clearTimeout(timer);
  }, [feedback]);

  const transmitIrPattern = async (pattern) => {
    if (Platform.OS === 'web') {
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
  };

  const handleTvCommand = async (commandKey) => {
    triggerHaptic(commandKey === 'POWER' ? 'impactMedium' : 'impactLight');
    const now = Date.now();
    if (now - lastCommandTimeRef.current < 80) {
      // السماح بالضغطات المتكررة فوراً مع تجنب النقر المزدوج اللحظي فقط
      lastCommandTimeRef.current = now;
    } else {
      lastCommandTimeRef.current = now;
    }

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
      }
      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر تنفيذ الأمر',
        tone: 'error',
      });
    }
  };

  const handleScanSmartTvs = async (overrideSubnet) => {
    triggerHaptic('impactLight');
    if (isDiscovering) {
      WifiControl.abortDiscovery();
      setIsDiscovering(false);
      return;
    }

    const activeSubnet = getSubnetFromIp(
      overrideSubnet || tvIp || `${subnetPrefix}.1`
    );
    setSubnetPrefix(activeSubnet);
    setIsDiscovering(true);
    setHasScannedOnce(true);
    setDiscoveredTvs([]);
    setScanProgress({ scanned: 0, total: 254 });

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
    triggerHaptic('impactLight');
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
      triggerHaptic('notificationSuccess');
      setFeedback({ text: 'تم الاتصال بالشاشة', tone: 'success' });
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
    triggerHaptic('impactLight');
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
      triggerHaptic('notificationSuccess');
      setFeedback({ text: 'تم الاتصال بالشاشة', tone: 'success' });
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
    triggerHaptic('impactLight');
    await WifiControl.clearToken(tvIp);
    setFeedback({ text: 'تم مسح التوكن', tone: 'success' });
  };

  const handleLaunchYouTube = async () => {
    triggerHaptic('impactLight');
    setIsLaunchingYouTube(true);
    try {
      await WifiControl.launchYouTube();
      triggerHaptic('notificationSuccess');
      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر فتح تطبيق يوتيوب',
        tone: 'error',
      });
    } finally {
      setIsLaunchingYouTube(false);
    }
  };

  const handleSearchYouTube = async () => {
    triggerHaptic('impactLight');
    setIsSearching(true);
    setHasSearchedOnce(true);
    try {
      const results = await WifiControl.searchYouTubeVideos(searchQuery);
      setSearchResults(results);
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر البحث في يوتيوب',
        tone: 'error',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCastVideo = async (video) => {
    if (!video || !video.videoId) return;
    triggerHaptic('impactLight');
    setCastingVideoId(video.videoId);
    try {
      await WifiControl.castYouTubeVideo(video.videoId);
      triggerHaptic('notificationSuccess');
      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر بث الفيديو على الشاشة',
        tone: 'error',
      });
    } finally {
      setCastingVideoId(null);
    }
  };

  const updateAcAndTransmit = async (nextAcState) => {
    triggerHaptic(nextAcState.power !== acState.power ? 'impactMedium' : 'impactLight');
    setAcState(nextAcState);
    try {
      const pattern = buildAcIrPattern(acBrand, nextAcState);
      await transmitIrPattern(pattern);
      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر إرسال أمر التكييف',
        tone: 'error',
      });
    }
  };

  const isStatusConnected =
    tvTransport === 'wifi' ? Boolean(wifiStatus.isConnected) : Boolean(hasIrHardware);
  const statusLabel =
    tvTransport === 'wifi'
      ? wifiStatus.isConnected
        ? 'متصل Wi-Fi'
        : 'غير متصل'
      : hasIrHardware
      ? 'IR جاهز'
      : 'بلا IR';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* [أ] Header مدمج ارتفاع 44: يمين زر طاقة 40×40 + "ريموت"، يسار نقطة 6px + نص 11px */}
      <View style={styles.header}>
        <View style={styles.headerStart}>
          <TouchableOpacity
            style={styles.headerPowerBtn}
            activeOpacity={0.55}
            accessibilityLabel="الطاقة"
            accessibilityRole="button"
            onPress={() => handleTvCommand('POWER')}
          >
            <RemoteIcon name="power" color={colors.textPrimary} size={18} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>ريموت</Text>
        </View>

        <View style={styles.headerStatus}>
          <View
            style={[
              styles.statusDot,
              isStatusConnected ? styles.statusDotOn : styles.statusDotOff,
            ]}
          />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>

      {/* شريط إشعار رفيع ارتفاع 28 لا يزيح التخطيط */}
      <View style={styles.feedbackSlot}>
        {feedback.text ? (
          <View
            style={[
              styles.feedbackPill,
              feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess,
            ]}
          >
            <Text style={styles.feedbackText} numberOfLines={1}>
              {feedback.text}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.mainContent}>
        {activeTab === 'tv' ? (
          <TvRemote
            tvTransport={tvTransport}
            setTvTransport={(mode) => {
              triggerHaptic('impactLight');
              setTvTransport(mode);
            }}
            tvBrand={tvBrand}
            setTvBrand={(brand) => {
              triggerHaptic('impactLight');
              setTvBrand(brand);
            }}
            wifiProtocol={wifiProtocol}
            tvIp={tvIp}
            tvPort={tvPort}
            wifiStatus={wifiStatus}
            isDiscovering={isDiscovering}
            discoveredTvs={discoveredTvs}
            hasScannedOnce={hasScannedOnce}
            onOpenSettings={() => {
              triggerHaptic('impactLight');
              setShowWifiModal(true);
            }}
            onScanSmartTvs={handleScanSmartTvs}
            onSelectDiscoveredTv={handleSelectDiscoveredTv}
            onTvCommand={handleTvCommand}
            onLaunchYouTube={handleLaunchYouTube}
            isLaunchingYouTube={isLaunchingYouTube}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSearchYouTube={handleSearchYouTube}
            isSearching={isSearching}
            hasSearchedOnce={hasSearchedOnce}
            searchResults={searchResults}
            castingVideoId={castingVideoId}
            onCastVideo={handleCastVideo}
          />
        ) : (
          <AcRemote
            acBrand={acBrand}
            setAcBrand={(brand) => {
              triggerHaptic('impactLight');
              setAcBrand(brand);
            }}
            acState={acState}
            updateAcAndTransmit={updateAcAndTransmit}
          />
        )}
      </View>

      {/* [و] شريط التبويب السفلي بارتفاع 52 وحد علوي فقط */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'tv' && styles.tabBtnActive]}
          activeOpacity={0.55}
          accessibilityLabel="الشاشة"
          accessibilityRole="button"
          onPress={() => {
            triggerHaptic('impactLight');
            setActiveTab('tv');
          }}
        >
          <Text style={[styles.tabText, activeTab === 'tv' && styles.tabTextActive]}>
            الشاشة
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'ac' && styles.tabBtnActive]}
          activeOpacity={0.55}
          accessibilityLabel="التكييف"
          accessibilityRole="button"
          onPress={() => {
            triggerHaptic('impactLight');
            setActiveTab('ac');
          }}
        >
          <Text style={[styles.tabText, activeTab === 'ac' && styles.tabTextActive]}>
            التكييف
          </Text>
        </TouchableOpacity>
      </View>

      <WifiSheet
        visible={showWifiModal}
        onClose={() => setShowWifiModal(false)}
        tvTransport={tvTransport}
        setTvTransport={setTvTransport}
        tvBrand={tvBrand}
        setTvBrand={setTvBrand}
        wifiProtocol={wifiProtocol}
        setWifiProtocol={setWifiProtocol}
        tvPort={tvPort}
        setTvPort={setTvPort}
        dialPort={dialPort}
        setDialPort={setDialPort}
        subnetPrefix={subnetPrefix}
        setSubnetPrefix={setSubnetPrefix}
        isDiscovering={isDiscovering}
        scanProgress={scanProgress}
        hasScannedOnce={hasScannedOnce}
        isConnectingWifi={isConnectingWifi}
        discoveredTvs={discoveredTvs}
        tvIp={tvIp}
        setTvIp={setTvIp}
        wifiStatus={wifiStatus}
        getSubnetFromIp={getSubnetFromIp}
        onScanSmartTvs={handleScanSmartTvs}
        onSelectDiscoveredTv={handleSelectDiscoveredTv}
        onClearSavedToken={handleClearSavedToken}
        onSaveWifi={handleSaveWifi}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.background,
  },
  header: {
    height: 44,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  headerStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerPowerBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.capsule,
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.title,
    fontWeight: '700',
  },
  headerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radii.capsule,
  },
  statusDotOn: {
    backgroundColor: colors.accent,
  },
  statusDotOff: {
    backgroundColor: colors.textTertiary,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  feedbackSlot: {
    height: 28,
    width: '100%',
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  feedbackPill: {
    height: 26,
    borderRadius: radii.button,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedbackSuccess: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  feedbackError: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },
  feedbackText: {
    color: colors.textPrimary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  mainContent: {
    flex: 1,
    width: '100%',
  },

  tabBar: {
    height: 52,
    width: '100%',
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    gap: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    borderRadius: radii.capsule,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
});

export default App;
