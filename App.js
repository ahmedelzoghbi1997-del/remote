import React, { useEffect, useRef, useState } from 'react';
import {
  I18nManager,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
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

  const handleSwitchTab = (tab) => {
    if (Platform.OS !== 'web') {
      try {
        Vibration.vibrate(8);
      } catch (_) {
        // ignore
      }
    }
    setActiveTab(tab);
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>ريموت</Text>
      </View>

      {feedback.tone === 'error' && feedback.text ? (
        <View style={[styles.feedbackBar, styles.feedbackError]}>
          <Text style={styles.feedbackText} numberOfLines={2}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      <View style={styles.mainContent}>
        {activeTab === 'tv' ? (
          <TvRemote
            tvTransport={tvTransport}
            tvBrand={tvBrand}
            wifiProtocol={wifiProtocol}
            wifiStatus={wifiStatus}
            hasIrHardware={hasIrHardware}
            onOpenSettings={() => setShowWifiModal(true)}
            onTvCommand={handleTvCommand}
          />
        ) : (
          <AcRemote
            acBrand={acBrand}
            setAcBrand={setAcBrand}
            acState={acState}
            updateAcAndTransmit={updateAcAndTransmit}
          />
        )}
      </View>

      <View style={styles.tabBar}>
        <Pressable
          accessibilityLabel="ريموت الشاشة"
          style={({ pressed }) => [
            styles.tabBtn,
            activeTab === 'tv' && styles.tabBtnActive,
            pressed && styles.tabPressed,
          ]}
          onPress={() => handleSwitchTab('tv')}
        >
          <RemoteIcon
            name="tv"
            size={18}
            color={activeTab === 'tv' ? colors.white : colors.textSecondary}
          />
          <Text style={[styles.tabText, activeTab === 'tv' && styles.tabTextActive]}>
            الشاشة
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel="ريموت التكييف"
          style={({ pressed }) => [
            styles.tabBtn,
            activeTab === 'ac' && styles.tabBtnActive,
            pressed && styles.tabPressed,
          ]}
          onPress={() => handleSwitchTab('ac')}
        >
          <RemoteIcon
            name="ac"
            size={18}
            color={activeTab === 'ac' ? colors.white : colors.textSecondary}
          />
          <Text style={[styles.tabText, activeTab === 'ac' && styles.tabTextActive]}>
            التكييف
          </Text>
        </Pressable>
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
  root: { flex: 1, width: '100%', backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: 2,
    flexShrink: 0,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.title,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  feedbackBar: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceHigh,
    flexShrink: 0,
  },
  feedbackError: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorderSoft,
  },
  feedbackText: { color: colors.textPrimary, fontSize: fontSizes.sm, textAlign: 'center' },
  mainContent: { flex: 1, width: '100%' },

  // شريط التبويب السفلي بأيقونات مدمجة
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.tabBarBg,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHigh,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    gap: 10,
    flexShrink: 0,
  },
  tabBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  tabText: { color: colors.textSecondary, fontSize: fontSizes.base, fontWeight: '600' },
  tabTextActive: { color: colors.white, fontWeight: '700' },
});

export default App;
