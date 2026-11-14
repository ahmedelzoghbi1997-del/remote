import React, { useEffect, useRef, useState } from 'react';
import {
  I18nManager,
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

const { IrManagerModule } = NativeModules;

if (!I18nManager.isRTL) {
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

function RepeatableButton({
  onAction,
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

  const [tvTransport, setTvTransport] = useState('ir');
  const [tvBrand, setTvBrand] = useState('samsung');
  const [wifiProtocol, setWifiProtocol] = useState('android_tv');
  const [tvIp, setTvIp] = useState('192.168.1.50');
  const [tvPort, setTvPort] = useState('8080');
  const [showWifiModal, setShowWifiModal] = useState(false);

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
    if (Platform.OS === 'android' && IrManagerModule) {
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
      WifiControl.disconnect();
    };
  }, []);

  const transmitIrPattern = async (pattern) => {
    if (Platform.OS !== 'android' || !IrManagerModule) {
      throw new Error('وحدة IrManagerModule متاحة فقط على أجهزة أندرويد.');
    }
    const available = await IrManagerModule.hasIrEmitter();
    if (!available) {
      throw new Error('هذا الهاتف لا يحتوي على مستشعر IR Blaster.');
    }
    await IrManagerModule.transmitIR(pattern, CARRIER_38KHZ);
    setFeedback((prev) =>
      prev.tone === 'neutral' && prev.text === '' ? prev : { text: '', tone: 'neutral' }
    );
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
        setFeedback((prev) =>
          prev.tone === 'neutral' && prev.text === '' ? prev : { text: '', tone: 'neutral' }
        );
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

  const handleSaveWifi = async () => {
    const parsedPort = Number(tvPort) || (wifiProtocol === 'roku' ? 8060 : 8080);
    WifiControl.configure({
      protocol: wifiProtocol,
      ipAddress: tvIp,
      port: parsedPort,
    });
    setShowWifiModal(false);
    try {
      await WifiControl.connect();
      setFeedback({ text: '', tone: 'neutral' });
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر الاتصال بالواي فاي',
        tone: 'error',
      });
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

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0D11" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>الريموت الشامل</Text>
        <Text style={styles.headerStatus}>
          {hasIrHardware === null
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

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'tv' ? (
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

            {tvTransport === 'ir' ? (
              <View style={styles.rowGap}>
                {['samsung', 'lg'].map((key) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.chipBtn, tvBrand === key && styles.chipBtnActive]}
                    onPress={() => setTvBrand(key)}
                  >
                    <Text style={styles.chipText}>{TV_IR_BRANDS[key].label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.wifiBar}
                onPress={() => setShowWifiModal(true)}
              >
                <Text style={styles.wifiAddressText}>
                  {wifiProtocol === 'roku' ? 'Roku ECP' : 'Android TV WS'} · {tvIp}:{tvPort}
                </Text>
                <Text style={styles.wifiEditLabel}>إعداد IP</Text>
              </TouchableOpacity>
            )}

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
              <RepeatableButton
                style={styles.dpadBtnUp}
                repeatIntervalMs={130}
                onAction={() => handleTvCommand('UP')}
              >
                <Text style={styles.dpadArrow}>▲</Text>
              </RepeatableButton>

              <View style={styles.dpadMiddle}>
                <RepeatableButton
                  style={styles.dpadBtnStart}
                  repeatIntervalMs={130}
                  onAction={() => handleTvCommand('RIGHT')}
                >
                  <Text style={styles.dpadArrow}>▶</Text>
                </RepeatableButton>

                <TouchableOpacity
                  style={styles.dpadOkBtn}
                  activeOpacity={0.8}
                  onPress={() => handleTvCommand('OK')}
                >
                  <Text style={styles.btnTextBold}>موافق</Text>
                </TouchableOpacity>

                <RepeatableButton
                  style={styles.dpadBtnEnd}
                  repeatIntervalMs={130}
                  onAction={() => handleTvCommand('LEFT')}
                >
                  <Text style={styles.dpadArrow}>◀</Text>
                </RepeatableButton>
              </View>

              <RepeatableButton
                style={styles.dpadBtnDown}
                repeatIntervalMs={130}
                onAction={() => handleTvCommand('DOWN')}
              >
                <Text style={styles.dpadArrow}>▼</Text>
              </RepeatableButton>
            </View>

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => handleTvCommand('BACK')}
              >
                <Text style={styles.btnText}>رجوع</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => handleTvCommand('HOME')}
              >
                <Text style={styles.btnText}>الرئيسية</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => handleTvCommand('MENU')}
              >
                <Text style={styles.btnText}>القائمة</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.rowGap}>
              <View style={styles.rockerCard}>
                <RepeatableButton
                  style={styles.rockerKey}
                  repeatIntervalMs={120}
                  onAction={() => handleTvCommand('VOL_UP')}
                >
                  <Text style={styles.rockerSymbol}>+</Text>
                </RepeatableButton>
                <Text style={styles.rockerLabel}>الصوت</Text>
                <RepeatableButton
                  style={styles.rockerKey}
                  repeatIntervalMs={120}
                  onAction={() => handleTvCommand('VOL_DOWN')}
                >
                  <Text style={styles.rockerSymbol}>−</Text>
                </RepeatableButton>
              </View>

              <View style={styles.rockerCard}>
                <RepeatableButton
                  style={styles.rockerKey}
                  repeatIntervalMs={150}
                  onAction={() => handleTvCommand('CH_UP')}
                >
                  <Text style={styles.rockerSymbol}>▲</Text>
                </RepeatableButton>
                <Text style={styles.rockerLabel}>القناة</Text>
                <RepeatableButton
                  style={styles.rockerKey}
                  repeatIntervalMs={150}
                  onAction={() => handleTvCommand('CH_DOWN')}
                >
                  <Text style={styles.rockerSymbol}>▼</Text>
                </RepeatableButton>
              </View>
            </View>

            <View style={styles.smartAppsSection}>
              <Text style={styles.sectionCaption}>التطبيقات الذكية</Text>
              <View style={styles.rowGap}>
                <TouchableOpacity
                  style={styles.youtubeBtn}
                  activeOpacity={0.8}
                  onPress={() => handleTvCommand('YOUTUBE')}
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
          </View>
        ) : (
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
                  <Text style={styles.chipText}>{b.label}</Text>
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
                    updateAcAndTransmit(
                      { ...acState, power: true, temperature: nextTemp },
                      'خفض الحرارة'
                    );
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
                  updateAcAndTransmit(
                    { ...acState, power: nextPower },
                    nextPower ? 'تشغيل المكيف' : 'إطفاء المكيف'
                  );
                }}
              >
                <Text style={styles.btnTextBold}>
                  {acState.power ? 'إطفاء' : 'تشغيل'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.tempStepBtn}
                onPress={() => {
                  const nextTemp = Math.min(30, acState.temperature + 1);
                  if (nextTemp !== acState.temperature) {
                    updateAcAndTransmit(
                      { ...acState, power: true, temperature: nextTemp },
                      'رفع الحرارة'
                    );
                  }
                }}
              >
                <Text style={styles.rockerSymbol}>+</Text>
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
                      updateAcAndTransmit(
                        { ...acState, power: true, mode: m.key },
                        `وضع ${m.label}`
                      )
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
                  updateAcAndTransmit(
                    { ...acState, power: true, fanSpeed: nextFan.key },
                    `المروحة: ${nextFan.label}`
                  );
                }}
              >
                <Text style={styles.extraCaption}>سرعة المروحة</Text>
                <Text style={styles.btnTextBold}>{currentFanLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.extraCard}
                onPress={() => {
                  const nextSwing = !acState.swing;
                  updateAcAndTransmit(
                    { ...acState, power: true, swing: nextSwing },
                    nextSwing ? 'تفعيل التأرجح' : 'إيقاف التأرجح'
                  );
                }}
              >
                <Text style={styles.extraCaption}>تأرجح الريش</Text>
                <Text style={styles.btnTextBold}>
                  {acState.swing ? 'يعمل' : 'متوقف'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

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
            <Text style={styles.modalTitle}>إعداد الشاشة الذكية (Wi-Fi)</Text>

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={[styles.chipBtn, wifiProtocol === 'android_tv' && styles.chipBtnActive]}
                onPress={() => {
                  setWifiProtocol('android_tv');
                  setTvPort('8080');
                }}
              >
                <Text style={styles.chipText}>Android TV (WS)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chipBtn, wifiProtocol === 'roku' && styles.chipBtnActive]}
                onPress={() => {
                  setWifiProtocol('roku');
                  setTvPort('8060');
                }}
              >
                <Text style={styles.chipText}>Roku ECP (REST)</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              value={tvIp}
              onChangeText={setTvIp}
              keyboardType="numeric"
              placeholder="192.168.1.50"
              placeholderTextColor="#64748B"
            />
            <TextInput
              style={styles.input}
              value={tvPort}
              onChangeText={setTvPort}
              keyboardType="numeric"
              placeholder="8080"
              placeholderTextColor="#64748B"
            />

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
  feedbackIr: { borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.14)' },
  feedbackWifi: { borderColor: '#0EA5E9', backgroundColor: 'rgba(14,165,233,0.14)' },
  feedbackError: { borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.14)' },
  feedbackText: { color: '#F1F5F9', fontSize: 12, textAlign: 'center' },
  scrollArea: { flex: 1 },
  scrollContent: { padding: 14 },
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
  },
  chipBtnActive: { borderColor: '#0EA5E9', backgroundColor: 'rgba(14,165,233,0.15)' },
  chipText: { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  wifiBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
  },
  wifiAddressText: { color: '#F1F5F9', fontSize: 13, fontFamily: 'monospace' },
  wifiEditLabel: { color: '#0EA5E9', fontSize: 13, fontWeight: '700' },
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
    backgroundColor: '#0B0D11',
    borderWidth: 1.5,
    borderColor: '#253042',
    padding: 0,
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
  },
  dpadMiddle: {
    width: '100%',
    height: 92,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0B0D11',
    gap: 2,
  },
  dpadBtnUp: {
    width: '100%',
    height: 76,
    backgroundColor: '#1A202C',
    borderBottomWidth: 2,
    borderBottomColor: '#0B0D11',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadBtnDown: {
    width: '100%',
    height: 76,
    backgroundColor: '#1A202C',
    borderTopWidth: 2,
    borderTopColor: '#0B0D11',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadBtnStart: {
    flex: 1,
    height: '100%',
    backgroundColor: '#1A202C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadBtnEnd: {
    flex: 1,
    height: '100%',
    backgroundColor: '#1A202C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadArrow: { color: '#F1F5F9', fontSize: 22 },
  dpadOkBtn: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#0EA5E9',
    borderWidth: 4,
    borderColor: '#0B0D11',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
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
  acLcd: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  acLcdOff: { opacity: 0.5 },
  acLcdTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },
  acMeta: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  acTemp: {
    color: '#F1F5F9',
    fontSize: 52,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  acFooter: { color: '#0EA5E9', fontSize: 12, fontWeight: '600' },
  tempStepBtn: {
    width: 72,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerBtn: {
    flex: 1,
    height: 58,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerOn: { backgroundColor: '#EF4444' },
  acPowerOff: { backgroundColor: '#16A34A' },
  sectionCaption: { color: '#94A3B8', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  modesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeChip: {
    width: '31%',
    minHeight: 46,
    borderRadius: 12,
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
    minHeight: 60,
    borderRadius: 14,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  extraCaption: { color: '#94A3B8', fontSize: 12 },
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
  modalSaveBtn: { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
});

export default App;
