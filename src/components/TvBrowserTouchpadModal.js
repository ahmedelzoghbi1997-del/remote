import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import WifiControl, { normalizeBrowserUrl } from '../services/WifiControl';
import HapticsManager, { HAPTIC_PATTERNS } from '../services/HapticsManager';

const TOUCHPAD_SPEEDS = [
  { key: 'slow', label: 'بطيء', factor: 0.85 },
  { key: 'medium', label: 'متوسط', factor: 1.5 },
  { key: 'fast', label: 'سريع', factor: 2.5 },
];

export default function TvBrowserTouchpadModal({
  visible,
  wifiStatus,
  onClose,
  onEnsureWifiConnect,
}) {
  const { height: screenHeight } = useWindowDimensions();
  const isCompactScreen = screenHeight < 680;

  const [urlInput, setUrlInput] = useState('');
  const [bookmarks, setBookmarks] = useState([]);
  const [speedKey, setSpeedKey] = useState('medium');
  const [isTouchActive, setIsTouchActive] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);
  const [isOpeningUrl, setIsOpeningUrl] = useState(false);
  const [isPastingUrl, setIsPastingUrl] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [notice, setNotice] = useState({ text: '', tone: 'neutral' });

  const speedFactorRef = useRef(1.5);
  const isConnectedRef = useRef(false);
  const isSamsungRef = useRef(true);
  const gestureStartAtRef = useRef(0);
  const lastDxRef = useRef(0);
  const lastDyRef = useRef(0);
  const noticeTimerRef = useRef(null);

  const selectedSpeed =
    TOUCHPAD_SPEEDS.find((item) => item.key === speedKey) || TOUCHPAD_SPEEDS[1];
  speedFactorRef.current = selectedSpeed.factor;

  const isTizen = !wifiStatus || wifiStatus.protocol === 'samsung_tizen';
  const isReady = Boolean(wifiStatus && wifiStatus.isConnected && wifiStatus.isChannelReady);
  isConnectedRef.current = Boolean(wifiStatus && wifiStatus.isConnected);
  isSamsungRef.current = isTizen;

  const showNotice = (text, tone = 'neutral', autoClearMs = 2600) => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice({ text, tone });
    if (autoClearMs > 0) {
      noticeTimerRef.current = setTimeout(() => {
        noticeTimerRef.current = null;
        setNotice({ text: '', tone: 'neutral' });
      }, autoClearMs);
    }
  };

  useEffect(() => {
    if (!visible) return undefined;
    let mounted = true;
    WifiControl.getTvBookmarks()
      .then((list) => {
        if (mounted && Array.isArray(list)) {
          setBookmarks(list);
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      WifiControl.flushMouseMove();
    };
  }, [visible]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, []);

  const handleQuickConnect = async () => {
    if (isConnecting) return;
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    setIsConnecting(true);
    try {
      if (onEnsureWifiConnect) {
        await onEnsureWifiConnect();
      } else {
        await WifiControl.connect();
      }
      showNotice('تم الاتصال بشاشة Samsung بنجاح.', 'success', 2200);
    } catch (err) {
      showNotice(err && err.message ? err.message : 'تعذر الاتصال بالشاشة.', 'error', 4200);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleOpenUrl = async (targetUrl) => {
    const raw = typeof targetUrl === 'string' ? targetUrl : urlInput;
    if (typeof targetUrl === 'string') {
      setUrlInput(targetUrl);
    }
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    setIsOpeningUrl(true);
    try {
      const res = await WifiControl.openUrlInTvBrowser(raw);
      setUrlInput(res.url);
      showNotice(
        'تم فتح المتصفح على الشاشة. إن لم ينتقل للرابط تلقائياً، انقر على شريط العنوان ثم اضغط «لصق الرابط في شريط العنوان».',
        'success',
        5200
      );
    } catch (err) {
      showNotice(
        err && err.message ? err.message : 'تعذر فتح الرابط في متصفح الشاشة.',
        'error',
        4200
      );
    } finally {
      setIsOpeningUrl(false);
    }
  };

  const handlePasteUrlToAddressBar = async () => {
    HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    let normalizedUrl = '';
    try {
      normalizedUrl = normalizeBrowserUrl(urlInput);
      setUrlInput(normalizedUrl);
    } catch (err) {
      showNotice(
        err && err.message ? err.message : 'أدخل رابطاً صالحاً في حقل الرابط أولاً.',
        'error',
        3400
      );
      return;
    }

    setIsPastingUrl(true);
    try {
      await WifiControl.sendTextToTv(normalizedUrl);
      showNotice(
        `تم إرسال الرابط إلى شريط العنوان على الشاشة: ${normalizedUrl}`,
        'success',
        2600
      );
    } catch (err) {
      showNotice(
        err && err.message ? err.message : 'تعذر إرسال الرابط إلى شريط العنوان.',
        'error',
        4000
      );
    } finally {
      setIsPastingUrl(false);
    }
  };

  const handleSaveBookmark = async () => {
    HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    try {
      const next = await WifiControl.saveTvBookmark(urlInput);
      setBookmarks(next);
      showNotice('تم حفظ الموقع في مفضلتك.', 'success', 2000);
    } catch (err) {
      showNotice(
        err && err.message ? err.message : 'أدخل رابطاً صحيحاً قبل الحفظ في المفضلة.',
        'error',
        3600
      );
    }
  };

  const handleRemoveBookmark = async (bookmark) => {
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    try {
      const next = await WifiControl.removeTvBookmark(bookmark.id || bookmark.url);
      setBookmarks(next);
    } catch (_) {
      // ignore
    }
  };

  const handleLeftClick = async () => {
    HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    try {
      await WifiControl.sendMouseClick('LeftClick');
    } catch (err) {
      showNotice(
        err && err.message ? err.message : 'تعذر إرسال نقرة الماوس للشاشة.',
        'error',
        3600
      );
    }
  };

  const handleHelperKey = async (commandKey) => {
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    try {
      await WifiControl.sendCommand(commandKey);
    } catch (err) {
      showNotice(
        err && err.message ? err.message : 'تعذر إرسال الأمر للشاشة.',
        'error',
        3600
      );
    }
  };

  const handleSendKeyboardText = async () => {
    const cleanText = String(keyboardText || '');
    if (!cleanText.trim()) {
      showNotice('اكتب النص أو العبارة المطلوب إرسالها للشاشة.', 'error', 2800);
      return;
    }
    HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    setIsSendingText(true);
    try {
      await WifiControl.sendTextToTv(cleanText);
      setKeyboardText('');
      showNotice('تم إرسال النص إلى الشاشة بنجاح.', 'success', 2000);
    } catch (err) {
      showNotice(
        err && err.message ? err.message : 'تعذر إرسال النص إلى الشاشة.',
        'error',
        3800
      );
    } finally {
      setIsSendingText(false);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          gestureStartAtRef.current = Date.now();
          lastDxRef.current = 0;
          lastDyRef.current = 0;
          setIsTouchActive(true);
          HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
          if (!isSamsungRef.current) {
            showNotice(
              'لوحة الماوس مخصصة لشاشات Samsung Tizen عبر شبكة الواي فاي.',
              'error',
              3200
            );
          } else if (!isConnectedRef.current) {
            showNotice(
              'الشاشة غير متصلة حالياً. اضغط "اتصال بالشاشة" بالأعلى للتحكم بالماوس.',
              'error',
              3200
            );
          }
        },
        onPanResponderMove: (_evt, gestureState) => {
          const deltaX = gestureState.dx - lastDxRef.current;
          const deltaY = gestureState.dy - lastDyRef.current;
          lastDxRef.current = gestureState.dx;
          lastDyRef.current = gestureState.dy;

          if (Math.abs(deltaX) < 0.25 && Math.abs(deltaY) < 0.25) {
            return;
          }
          const scale = speedFactorRef.current;
          WifiControl.sendMouseMove(deltaX * scale, deltaY * scale);
        },
        onPanResponderRelease: (_evt, gestureState) => {
          setIsTouchActive(false);
          WifiControl.flushMouseMove();
          const elapsed = Date.now() - gestureStartAtRef.current;
          const travel = Math.hypot(gestureState.dx || 0, gestureState.dy || 0);
          if (elapsed < 220 && travel < 6) {
            handleLeftClick();
          }
        },
        onPanResponderTerminate: () => {
          setIsTouchActive(false);
          WifiControl.flushMouseMove();
        },
      }),
    []
  );

  return (
    <Modal visible={visible} transparent={false} animationType="slide">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerRight}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              متصفح التلفاز والماوس
            </Text>
            <View
              style={[
                styles.statusBadge,
                isReady && isTizen ? styles.statusBadgeOn : styles.statusBadgeOff,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  isReady && isTizen ? styles.statusDotOn : styles.statusDotOff,
                ]}
              />
              <Text style={styles.statusBadgeText}>
                {!isTizen ? 'Samsung فقط' : isReady ? 'متصل' : 'غير متصل'}
              </Text>
            </View>
          </View>

          <View style={styles.headerLeftActions}>
            {!isReady && isTizen ? (
              <TouchableOpacity
                style={styles.quickConnectBtn}
                activeOpacity={0.75}
                onPress={handleQuickConnect}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.quickConnectText}>اتصال</Text>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.closeBtn}
              activeOpacity={0.75}
              onPress={() => {
                HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                onClose();
              }}
              accessibilityLabel="إغلاق متصفح الشاشة"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {notice.text ? (
          <View
            style={[
              styles.noticeBar,
              notice.tone === 'error'
                ? styles.noticeError
                : notice.tone === 'success'
                ? styles.noticeSuccess
                : null,
            ]}
          >
            <Text style={styles.noticeText} numberOfLines={2}>
              {notice.text}
            </Text>
          </View>
        ) : null}

        <View style={[styles.body, isCompactScreen && styles.bodyCompact]}>
          {/* شريط إدخال الرابط وفتحه/حفظه */}
          <View style={styles.urlCard}>
            <View style={styles.urlInputRow}>
              <TextInput
                style={styles.urlInput}
                value={urlInput}
                onChangeText={setUrlInput}
                placeholder="أدخل رابط الموقع (مثال: google.com)"
                placeholderTextColor="#64748B"
                returnKeyType="go"
                onSubmitEditing={() => handleOpenUrl()}
              />
              {urlInput.length > 0 ? (
                <TouchableOpacity
                  style={styles.clearInputBtn}
                  activeOpacity={0.75}
                  onPress={() => {
                    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                    setUrlInput('');
                  }}
                  accessibilityLabel="مسح الرابط"
                >
                  <Text style={styles.clearInputGlyph}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.urlActionRow}>
              <TouchableOpacity
                style={[styles.primaryActionBtn, isOpeningUrl && styles.btnDisabled]}
                activeOpacity={0.8}
                onPress={() => handleOpenUrl()}
                disabled={isOpeningUrl}
              >
                {isOpeningUrl ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryActionText}>فتح على متصفح الشاشة</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryActionBtn}
                activeOpacity={0.8}
                onPress={handleSaveBookmark}
              >
                <Text style={styles.secondaryActionText}>★ حفظ في المفضلة</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.pasteAddressBtn, isPastingUrl && styles.btnDisabled]}
              activeOpacity={0.8}
              onPress={handlePasteUrlToAddressBar}
              disabled={isPastingUrl}
            >
              {isPastingUrl ? (
                <ActivityIndicator size="small" color="#38BDF8" />
              ) : (
                <Text style={styles.pasteAddressBtnText}>
                  ⤶ لصق الرابط في شريط العنوان
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* قسم مواقعي المفضلة */}
          <View style={styles.bookmarksSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>مواقعي المفضلة</Text>
              <Text style={styles.sectionCount}>
                {bookmarks.length > 0 ? `${bookmarks.length} محفوظ` : 'فارغة'}
              </Text>
            </View>

            {bookmarks.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bookmarksScroll}
                keyboardShouldPersistTaps="handled"
              >
                {bookmarks.map((bm) => (
                  <View key={bm.id} style={styles.bookmarkChip}>
                    <TouchableOpacity
                      style={styles.bookmarkOpenArea}
                      activeOpacity={0.75}
                      onPress={() => {
                        setUrlInput(bm.url);
                        handleOpenUrl(bm.url);
                      }}
                    >
                      <Text style={styles.bookmarkTitle} numberOfLines={1}>
                        {bm.title}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.bookmarkDeleteBtn}
                      activeOpacity={0.7}
                      onPress={() => handleRemoveBookmark(bm)}
                      accessibilityLabel={`حذف ${bm.title}`}
                    >
                      <Text style={styles.bookmarkDeleteGlyph}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyBookmarksBox}>
                <Text style={styles.emptyBookmarksText}>
                  أضف أي رابط بالأعلى واضغط "حفظ في المفضلة" لفتحه لاحقاً بلمسة واحدة.
                </Text>
              </View>
            )}
          </View>

          {/* كيبورد إدخال النص المباشر (عند التفعيل) */}
          {isKeyboardOpen ? (
            <View style={styles.keyboardBox}>
              <View style={styles.keyboardInputRow}>
                <TextInput
                  style={styles.keyboardInput}
                  value={keyboardText}
                  onChangeText={setKeyboardText}
                  placeholder="اكتب بالعربية أو الإنجليزية للإرسال مباشرة للشاشة..."
                  placeholderTextColor="#64748B"
                  returnKeyType="send"
                  autoFocus
                  onSubmitEditing={handleSendKeyboardText}
                />
                {keyboardText.length > 0 ? (
                  <TouchableOpacity
                    style={styles.clearInputBtn}
                    activeOpacity={0.75}
                    onPress={() => setKeyboardText('')}
                  >
                    <Text style={styles.clearInputGlyph}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={styles.keyboardBtnRow}>
                <TouchableOpacity
                  style={styles.keyboardCloseBtn}
                  activeOpacity={0.75}
                  onPress={() => setIsKeyboardOpen(false)}
                >
                  <Text style={styles.keyboardCloseText}>إخفاء الكيبورد</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.keyboardSendBtn, isSendingText && styles.btnDisabled]}
                  activeOpacity={0.8}
                  onPress={handleSendKeyboardText}
                  disabled={isSendingText}
                >
                  {isSendingText ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryActionText}>إرسال للشاشة ↵</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* منطقة لوحة ماوس اللمس (Touchpad) */}
          <View style={styles.touchpadWrapper}>
            <View style={styles.touchpadHeader}>
              <Text style={styles.sectionTitle}>لوحة الماوس (Touchpad)</Text>
              <View style={styles.speedSwitch}>
                {TOUCHPAD_SPEEDS.map((tier) => {
                  const active = speedKey === tier.key;
                  return (
                    <TouchableOpacity
                      key={tier.key}
                      style={[styles.speedChip, active && styles.speedChipActive]}
                      activeOpacity={0.75}
                      onPress={() => {
                        HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                        setSpeedKey(tier.key);
                      }}
                    >
                      <Text
                        style={[
                          styles.speedChipText,
                          active && styles.speedChipTextActive,
                        ]}
                      >
                        {tier.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View
              style={[
                styles.touchpadSurface,
                isCompactScreen && styles.touchpadSurfaceCompact,
                isTouchActive && styles.touchpadSurfaceActive,
              ]}
              {...panResponder.panHandlers}
            >
              <View style={styles.touchpadReticle} pointerEvents="none">
                <View
                  style={[
                    styles.touchpadDot,
                    isTouchActive && styles.touchpadDotActive,
                  ]}
                />
                <Text style={styles.touchpadHintTitle}>
                  حرّك إصبعك لتحريك مؤشر الشاشة
                </Text>
                <Text style={styles.touchpadHintSub}>
                  نقرة خفيفة للضغط · السرعة الحالية: {selectedSpeed.label}
                </Text>
              </View>
            </View>
          </View>

          {/* شريط الأزرار المساعدة أسفل Touchpad */}
          <View style={styles.helperBar}>
            <View style={styles.helperRow}>
              <TouchableOpacity
                style={[styles.helperBtn, styles.helperClickBtn]}
                activeOpacity={0.75}
                onPress={handleLeftClick}
              >
                <Text style={styles.helperClickText}>نقرة يسرى</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.helperBtn}
                activeOpacity={0.75}
                onPress={() => handleHelperKey('BACK')}
              >
                <Text style={styles.helperBtnText}>رجوع</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.helperBtn}
                activeOpacity={0.75}
                onPress={() => handleHelperKey('OK')}
              >
                <Text style={styles.helperBtnText}>إدخال ↵</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.helperRow}>
              <TouchableOpacity
                style={styles.helperBtn}
                activeOpacity={0.75}
                onPress={() => handleHelperKey('UP')}
              >
                <Text style={styles.helperBtnText}>▲ تمرير أعلى</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.helperBtn}
                activeOpacity={0.75}
                onPress={() => handleHelperKey('DOWN')}
              >
                <Text style={styles.helperBtnText}>▼ تمرير أسفل</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.helperBtn,
                  isKeyboardOpen && styles.helperKeyboardActive,
                ]}
                activeOpacity={0.75}
                onPress={() => {
                  HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                  setIsKeyboardOpen((prev) => !prev);
                }}
              >
                <Text
                  style={[
                    styles.helperBtnText,
                    isKeyboardOpen && styles.helperKeyboardActiveText,
                  ]}
                >
                  كيبورد / إرسال نص
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0D11',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2532',
    gap: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusBadgeOn: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.35)',
  },
  statusBadgeOff: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.35)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotOn: {
    backgroundColor: '#22C55E',
  },
  statusDotOff: {
    backgroundColor: '#F59E0B',
  },
  statusBadgeText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },
  headerLeftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickConnectBtn: {
    backgroundColor: '#0EA5E9',
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickConnectText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
  },
  noticeBar: {
    marginHorizontal: 14,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
  },
  noticeError: {
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderColor: '#EF4444',
  },
  noticeSuccess: {
    backgroundColor: 'rgba(34,197,94,0.14)',
    borderColor: '#22C55E',
  },
  noticeText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  bodyCompact: {
    paddingVertical: 6,
    gap: 7,
  },
  urlCard: {
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 14,
    padding: 10,
    gap: 8,
  },
  urlInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#252E3E',
    borderRadius: 11,
    paddingHorizontal: 10,
    minHeight: 42,
    gap: 6,
  },
  urlInput: {
    flex: 1,
    color: '#F1F5F9',
    fontSize: 13,
    textAlign: 'right',
    paddingVertical: 6,
  },
  clearInputBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearInputGlyph: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  urlActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryActionBtn: {
    flex: 1.35,
    minHeight: 40,
    borderRadius: 11,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryActionBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 11,
    backgroundColor: '#181E2A',
    borderWidth: 1,
    borderColor: '#2B3548',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  secondaryActionText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  pasteAddressBtn: {
    minHeight: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(14,165,233,0.14)',
    borderWidth: 1,
    borderColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  pasteAddressBtnText: {
    color: '#38BDF8',
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  btnDisabled: {
    opacity: 0.65,
  },
  bookmarksSection: {
    gap: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCount: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  bookmarksScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  bookmarkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#252E3E',
    borderRadius: 10,
    overflow: 'hidden',
    maxWidth: 170,
  },
  bookmarkOpenArea: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    justifyContent: 'center',
  },
  bookmarkTitle: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  bookmarkDeleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderLeftWidth: 1,
    borderLeftColor: '#1E2532',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookmarkDeleteGlyph: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyBookmarksBox: {
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyBookmarksText: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
  },
  keyboardBox: {
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: 14,
    padding: 10,
    gap: 8,
  },
  keyboardInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#252E3E',
    borderRadius: 10,
    paddingHorizontal: 10,
    minHeight: 42,
    gap: 6,
  },
  keyboardInput: {
    flex: 1,
    color: '#F1F5F9',
    fontSize: 13,
    textAlign: 'right',
    paddingVertical: 6,
  },
  keyboardBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  keyboardCloseBtn: {
    flex: 0.85,
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#181E2A',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardCloseText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  keyboardSendBtn: {
    flex: 1.4,
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  touchpadWrapper: {
    flex: 1,
    gap: 7,
    minHeight: 170,
  },
  touchpadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  speedSwitch: {
    flexDirection: 'row',
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 10,
    padding: 2,
    gap: 3,
  },
  speedChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  speedChipActive: {
    backgroundColor: '#0EA5E9',
  },
  speedChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  speedChipTextActive: {
    color: '#FFFFFF',
  },
  touchpadSurface: {
    flex: 1,
    minHeight: 150,
    backgroundColor: '#131720',
    borderWidth: 1.5,
    borderColor: '#252E3E',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  touchpadSurfaceCompact: {
    minHeight: 125,
  },
  touchpadSurfaceActive: {
    borderColor: '#0EA5E9',
    backgroundColor: '#151E2E',
  },
  touchpadReticle: {
    alignItems: 'center',
    gap: 6,
  },
  touchpadDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#334155',
    borderWidth: 2,
    borderColor: '#475569',
    marginBottom: 4,
  },
  touchpadDotActive: {
    backgroundColor: '#38BDF8',
    borderColor: '#BAE6FD',
  },
  touchpadHintTitle: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  touchpadHintSub: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  helperBar: {
    gap: 7,
  },
  helperRow: {
    flexDirection: 'row',
    gap: 7,
  },
  helperBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  helperClickBtn: {
    backgroundColor: 'rgba(14,165,233,0.16)',
    borderColor: '#0EA5E9',
  },
  helperClickText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  helperBtnText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  helperKeyboardActive: {
    backgroundColor: 'rgba(14,165,233,0.18)',
    borderColor: '#0EA5E9',
  },
  helperKeyboardActiveText: {
    color: '#38BDF8',
  },
});
