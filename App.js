import React, { useEffect, useState } from 'react';
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

function encodeNecToMicroseconds(addressHex, commandHex) {
  let addr1, finalAddr2;
  if (addressHex > 0xff) {
    // دعم لبروتوكول سامسونج (العنوان المزدوج 16-بت)
    addr1 = (addressHex >> 8) & 0xff;
    finalAddr2 = addressHex & 0xff;
  } else {
    // بروتوكول NEC القياسي للأجهزة الأخرى والتكييف
    addr1 = addressHex & 0xff;
    finalAddr2 = ~addr1 & 0xff;
  }

  const cmd = commandHex & 0xff;
  const cmdInv = ~cmd & 0xff;

  const frame32 =
    ((addr1 << 24) >>> 0) |
    ((finalAddr2 << 16) >>> 0) |
    ((cmd << 8) >>> 0) |
    (cmdInv >>> 0);

  const pattern = [9000, 4500];
  for (let bit = 31; bit >= 0; bit--) {
    const isOne = ((frame32 >>> bit) & 1) === 1;
    pattern.push(560);
    pattern.push(isOne ? 1690 : 560);
  }
  pattern.push(560);
  return pattern;
}

const TV_IR_BRANDS = {
  samsung: {
    label: 'Samsung TV',
    address: 0x0707, // الكود السري الخاص بشاشتك E0E0
    commands: {
      POWER: 0x02, // أمر 40BF يتوافق برمجياً مع 0x02
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
    },
  },
  lg: {
    label: 'LG TV',
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

  const stateByte =
    ((acState.power ? 1 : 0) << 7) |
    ((modeMap[acState.mode] ?? 1) << 4) |
    ((fanMap[acState.fanSpeed] ?? 0) << 2) |
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

function App() {
  const [activeTab, setActiveTab] = useState('tv');
  const [hasIrHardware, setHasIrHardware] = useState(null);
  const [feedback, setFeedback] = useState({
    text: 'جاهز للتحكم بالشاشة والتكييف',
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

  const transmitIrPattern = async (pattern, label) => {
    if (Platform.OS !== 'android' || !IrManagerModule) {
      throw new Error('وحدة IrManagerModule متاحة فقط على أجهزة أندرويد.');
    }
    const available = await IrManagerModule.hasIrEmitter();
    if (!available) {
      throw new Error('هذا الهاتف لا يحتوي على مستشعر IR Blaster.');
    }
    const res = await IrManagerModule.transmitIR(pattern, CARRIER_38KHZ);
    setFeedback({
      text: `IR · ${label} (${res.carrierFrequency} Hz · ${res.pulseCount} نبضة)`,
      tone: 'ir',
    });
  };

  const handleTvCommand = async (commandKey, labelAr) => {
    try {
      if (tvTransport === 'ir') {
        const brand = TV_IR_BRANDS[tvBrand];
        const cmdHex = brand.commands[commandKey];
        const pattern = encodeNecToMicroseconds(brand.address, cmdHex);
        await transmitIrPattern(pattern, labelAr);
      } else {
        await WifiControl.sendCommand(commandKey);
        setFeedback({
          text: `Wi-Fi (${wifiProtocol.toUpperCase()}) · تم إرسال "${labelAr}"`,
          tone: 'wifi',
        });
      }
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر تنفيذ الأمر',
        tone: 'error',
      });
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
      setFeedback({
        text: `متصل بالشاشة الذكية ${tvIp}:${parsedPort}`,
        tone: 'wifi',
      });
    } catch (error) {
      setFeedback({
        text: error && error.message ? error.message : 'تعذر الاتصال بالواي فاي',
        tone: 'error',
      });
    }
  };

  const updateAcAndTransmit = async (nextAcState, actionLabel) => {
    setAcState(nextAcState);
    try {
      const pattern = buildAcIrPattern(acBrand, nextAcState);
      await transmitIrPattern(pattern, `${actionLabel} (${nextAcState.temperature}°C)`);
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

      <View
        style={[
          styles.feedbackBar,
          feedback.tone === 'ir' && styles.feedbackIr,
          feedback.tone === 'wifi' && styles.feedbackWifi,
          feedback.tone === 'error' && styles.feedbackError,
        ]}
      >
        <Text style={styles.feedbackText} numberOfLines={1}>
          {feedback.text}
        </Text>
      </View>

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
                onPress={() => handleTvCommand('POWER', 'الطاقة')}
              >
                <Text style={styles.btnTextBold}>طاقة</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleTvCommand('INPUT', 'تبديل المصدر')}
              >
                <Text style={styles.btnText}>المصدر</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleTvCommand('MUTE', 'كتم الصوت')}
              >
                <Text style={styles.btnText}>كتم</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dpadCircle}>
              <TouchableOpacity
                style={styles.dpadBtn}
                onPress={() => handleTvCommand('UP', 'أعلى')}
              >
                <Text style={styles.dpadArrow}>▲</Text>
              </TouchableOpacity>

              <View style={styles.dpadMiddle}>
                <TouchableOpacity
                  style={styles.dpadBtn}
                  onPress={() => handleTvCommand('RIGHT', 'يمين')}
                >
                  <Text style={styles.dpadArrow}>▶</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dpadOkBtn}
                  onPress={() => handleTvCommand('OK', 'موافق')}
                >
                  <Text style={styles.btnTextBold}>موافق</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dpadBtn}
                  onPress={() => handleTvCommand('LEFT', 'يسار')}
                >
                  <Text style={styles.dpadArrow}>◀</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.dpadBtn}
                onPress={() => handleTvCommand('DOWN', 'أسفل')}
              >
                <Text style={styles.dpadArrow}>▼</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.rowGap}>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => handleTvCommand('BACK', 'رجوع')}
              >
                <Text style={styles.btnText}>رجوع</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => handleTvCommand('HOME', 'الرئيسية')}
              >
                <Text style={styles.btnText}>الرئيسية</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => handleTvCommand('MENU', 'القائمة')}
              >
                <Text style={styles.btnText}>القائمة</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.rowGap}>
              <View style={styles.rockerCard}>
                <TouchableOpacity
                  style={styles.rockerKey}
                  onPress={() => handleTvCommand('VOL_UP', 'رفع الصوت')}
                >
                  <Text style={styles.rockerSymbol}>+</Text>
                </TouchableOpacity>
                <Text style={styles.rockerLabel}>الصوت</Text>
                <TouchableOpacity
                  style={styles.rockerKey}
                  onPress={() => handleTvCommand('VOL_DOWN', 'خفض الصوت')}
                >
                  <Text style={styles.rockerSymbol}>−</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.rockerCard}>
                <TouchableOpacity
                  style={styles.rockerKey}
                  onPress={() => handleTvCommand('CH_UP', 'القناة التالية')}
                >
                  <Text style={styles.rockerSymbol}>▲</Text>
                </TouchableOpacity>
                <Text style={styles.rockerLabel}>القناة</Text>
                <TouchableOpacity
                  style={styles.rockerKey}
                  onPress={() => handleTvCommand('CH_DOWN', 'القناة السابقة')}
                >
                  <Text style={styles.rockerSymbol}>▼</Text>
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
          <Text style={[styles.tabText, activeTab ==
