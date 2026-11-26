import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatSecondsHms } from '../services/CinemaStorageService';
import HapticsManager, { HAPTIC_PATTERNS } from '../services/HapticsManager';

function CinemaSeekSlider({ positionSec, durationSec, disabled, onSeek }) {
  const [barWidth, setBarWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [dragSec, setDragSec] = useState(0);
  const lastBucketRef = useRef(-1);
  const latestDurRef = useRef(durationSec);
  const latestDragRef = useRef(0);
  latestDurRef.current = durationSec;

  const dur = Math.max(0, Number(durationSec) || 0);
  const canSeek = !disabled && dur > 1;
  const displayedPos = isDragging ? dragSec : Math.min(Number(positionSec) || 0, dur || Number(positionSec) || 0);
  const progress = canSeek ? Math.max(0, Math.min(1, displayedPos / dur)) : 0;

  const computeFromEvent = (event) => {
    const x = Number(event && event.nativeEvent ? event.nativeEvent.locationX : 0);
    const width = Math.max(40, barWidth);
    const ratio = Math.max(0, Math.min(1, x / width));
    const maxDur = Math.max(0, Number(latestDurRef.current) || 0);
    const maxSafe = maxDur > 2 ? maxDur - 1 : maxDur;
    const sec = Math.max(0, Math.min(maxSafe, Math.round(ratio * maxDur)));
    return { ratio, sec };
  };

  return (
    <View style={styles.seekWrap}>
      <View
        style={[styles.seekHitArea, !canSeek && { opacity: 0.55 }]}
        onLayout={(e) => {
          const w = e && e.nativeEvent && e.nativeEvent.layout ? e.nativeEvent.layout.width : 0;
          if (w > 20) setBarWidth(w);
        }}
        pointerEvents="box-only"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => canSeek}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          if (!canSeek) {
            HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
            return;
          }
          const { ratio, sec } = computeFromEvent(e);
          latestDragRef.current = sec;
          lastBucketRef.current = Math.round(ratio * 24);
          setDragSec(sec);
          setIsDragging(true);
          HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
        }}
        onResponderMove={(e) => {
          if (!canSeek || !isDragging) return;
          const { ratio, sec } = computeFromEvent(e);
          latestDragRef.current = sec;
          setDragSec(sec);
          const b = Math.round(ratio * 24);
          if (b !== lastBucketRef.current) {
            lastBucketRef.current = b;
            HapticsManager.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
          }
        }}
        onResponderRelease={() => {
          if (!canSeek || !isDragging) {
            setIsDragging(false);
            return;
          }
          const target = latestDragRef.current;
          setIsDragging(false);
          lastBucketRef.current = -1;
          HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
          if (onSeek) onSeek(target);
        }}
        onResponderTerminate={() => setIsDragging(false)}
      >
        <View style={styles.seekTrackBg}>
          <View
            style={[
              styles.seekTrackFill,
              { width: canSeek ? `${Math.round(progress * 1000) / 10}%` : '0%' },
            ]}
          />
          {canSeek ? (
            <View
              style={[
                styles.seekThumb,
                { left: Math.max(0, Math.min(barWidth - 16, Math.round(progress * barWidth) - 8)) },
                isDragging && styles.seekThumbActive,
              ]}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.seekTimesRow}>
        <Text style={styles.seekTimeTxt}>{formatSecondsHms(displayedPos)}</Text>
        <Text style={styles.seekTimeTxt}>
          {dur > 0 ? formatSecondsHms(dur) : 'بث مباشر / جاري الحساب'}
        </Text>
      </View>
    </View>
  );
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

export default function CinemaControlModal({
  visible,
  onClose,
  activeTab,
  onChangeTab,
  cinemaSession,
  receiverState,
  serverUrl,
  busyAction,
  statusNotice,
  subtitleStyle,
  queue,
  resumeList,
  autoNextCountdown,
  onSendCommand,
  onUpdateSubtitleStyle,
  onPickSubtitle,
  onRemoveSubtitle,
  onLaunchTvBrowser,
  onCopyReceiverUrl,
  onOpenSmartBrowser,
  onStopCinema,
  onPlayQueueItem,
  onRemoveQueueItem,
  onClearQueue,
  onPlayNextNow,
  onCancelAutoNext,
  onPlayResumeItem,
  onRemoveResumeItem,
  onClearResumeList,
}) {
  const status = (receiverState && receiverState.status) || (cinemaSession ? 'loading' : 'idle');
  const isPlaying = status === 'playing';
  const posSec = Number(receiverState && receiverState.positionSec) || 0;
  const durSec = Number(receiverState && receiverState.durationSec) || 0;
  const currentQuality =
    receiverState && typeof receiverState.qualityIndex === 'number'
      ? receiverState.qualityIndex
      : -1;
  const levels =
    receiverState && Array.isArray(receiverState.levels) && receiverState.levels.length > 0
      ? receiverState.levels
      : [];
  const playbackRate = Number(receiverState && receiverState.playbackRate) || 1;
  const aspectMode = (receiverState && receiverState.aspectMode) === 'cover' ? 'cover' : 'contain';
  const volume =
    receiverState && typeof receiverState.volume === 'number' ? receiverState.volume : 100;
  const muted = Boolean(receiverState && receiverState.muted);

  const statusLabel =
    status === 'playing'
      ? 'جاري التشغيل'
      : status === 'paused'
      ? 'متوقف مؤقتاً'
      : status === 'loading'
      ? 'جاري التحميل...'
      : status === 'ended'
      ? 'انتهى العرض'
      : status === 'error'
      ? 'خطأ في العرض'
      : 'في وضع الاستعداد';

  const statusDotColor =
    status === 'playing'
      ? '#10B981'
      : status === 'paused'
      ? '#F59E0B'
      : status === 'error'
      ? '#EF4444'
      : '#38BDF8';

  const subFontSize = Number(subtitleStyle && subtitleStyle.fontSize) || 34;
  const subColor = (subtitleStyle && subtitleStyle.color) || '#FFFFFF';
  const subBgOpacity =
    subtitleStyle && typeof subtitleStyle.bgOpacity === 'number' ? subtitleStyle.bgOpacity : 0.45;
  const subVerticalOffset = Number(subtitleStyle && subtitleStyle.verticalOffset) || 8;
  const subOffsetSec = Number(subtitleStyle && subtitleStyle.offsetSec) || 0;

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeBtn}
            activeOpacity={0.75}
            onPress={() => {
              HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
              onClose();
            }}
            accessibilityLabel="إغلاق لوحة السينما"
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {(cinemaSession && cinemaSession.title) ||
                (receiverState && receiverState.title) ||
                'مشغّل السينما الذكي'}
            </Text>
            <View style={styles.statusPill}>
              <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
              <Text style={styles.statusText}>{statusLabel}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.browserHeaderBtn}
            activeOpacity={0.8}
            onPress={() => {
              HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
              onOpenSmartBrowser && onOpenSmartBrowser();
            }}
          >
            <Text style={styles.browserHeaderBtnText}>متصفح الصيد</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.receiverBar}>
          <View style={styles.receiverUrlWrap}>
            <Text style={styles.receiverUrlLabel}>عنوان الشاشة (/tv)</Text>
            <Text dir="ltr" style={styles.receiverUrlVal} numberOfLines={1}>
              {serverUrl || (cinemaSession && cinemaSession.receiverUrl) || 'http://LAN:8899/tv'}
            </Text>
          </View>
          <View style={styles.receiverBtns}>
            <TouchableOpacity
              style={styles.tvOpenBtn}
              activeOpacity={0.8}
              disabled={busyAction}
              onPress={() => {
                HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
                onLaunchTvBrowser && onLaunchTvBrowser();
              }}
            >
              {busyAction ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.tvOpenBtnText}>فتح على الشاشة</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.copyUrlBtn}
              activeOpacity={0.8}
              onPress={() => {
                HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                onCopyReceiverUrl && onCopyReceiverUrl();
              }}
            >
              <Text style={styles.copyUrlBtnText}>نسخ</Text>
            </TouchableOpacity>
          </View>
        </View>

        {statusNotice ? (
          <View style={styles.noticeBar}>
            <Text style={styles.noticeText}>{statusNotice}</Text>
          </View>
        ) : null}

        {autoNextCountdown ? (
          <View style={styles.countdownCard}>
            <View style={styles.countdownTop}>
              <Text style={styles.countdownTitle} numberOfLines={1}>
                التالي تلقائياً خلال {autoNextCountdown.seconds} ث: {autoNextCountdown.nextItem && autoNextCountdown.nextItem.title}
              </Text>
            </View>
            <View style={styles.countdownActions}>
              <TouchableOpacity
                style={styles.countdownNowBtn}
                activeOpacity={0.85}
                onPress={() => {
                  HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
                  onPlayNextNow && onPlayNextNow();
                }}
              >
                <Text style={styles.countdownNowText}>تشغيل الآن</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.countdownCancelBtn}
                activeOpacity={0.8}
                onPress={() => {
                  HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                  onCancelAutoNext && onCancelAutoNext();
                }}
              >
                <Text style={styles.countdownCancelText}>إلغاء</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'control' && styles.tabBtnActive]}
            activeOpacity={0.8}
            onPress={() => {
              HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
              onChangeTab('control');
            }}
          >
            <Text style={[styles.tabText, activeTab === 'control' && styles.tabTextActive]}>
              التحكم الحي
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'subtitles' && styles.tabBtnActive]}
            activeOpacity={0.8}
            onPress={() => {
              HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
              onChangeTab('subtitles');
            }}
          >
            <Text style={[styles.tabText, activeTab === 'subtitles' && styles.tabTextActive]}>
              الترجمة الحية
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'queue' && styles.tabBtnActive]}
            activeOpacity={0.8}
            onPress={() => {
              HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
              onChangeTab('queue');
            }}
          >
            <Text style={[styles.tabText, activeTab === 'queue' && styles.tabTextActive]}>
              الحلقات ({queue.length})
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {activeTab === 'control' ? (
            <View style={styles.sectionStack}>
              <View style={styles.card}>
                <CinemaSeekSlider
                  positionSec={posSec}
                  durationSec={durSec}
                  disabled={!cinemaSession && status === 'idle'}
                  onSeek={(sec) => onSendCommand('seek', { positionSec: sec })}
                />

                <View style={styles.transportRow}>
                  <TouchableOpacity
                    style={styles.seekBtn}
                    activeOpacity={0.75}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                      onSendCommand('seekDelta', { deltaSec: -30 });
                    }}
                  >
                    <Text style={styles.seekBtnText}>-30ث</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.seekBtn}
                    activeOpacity={0.75}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                      onSendCommand('seekDelta', { deltaSec: -10 });
                    }}
                  >
                    <Text style={styles.seekBtnText}>-10ث</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.playPauseBtn}
                    activeOpacity={0.85}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
                      onSendCommand(isPlaying ? 'pause' : 'play', {});
                    }}
                  >
                    <Text style={styles.playPauseText}>
                      {isPlaying ? '⏸ إيقاف' : '▶ تشغيل'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.seekBtn}
                    activeOpacity={0.75}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                      onSendCommand('seekDelta', { deltaSec: 10 });
                    }}
                  >
                    <Text style={styles.seekBtnText}>+10ث</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.seekBtn}
                    activeOpacity={0.75}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                      onSendCommand('seekDelta', { deltaSec: 30 });
                    }}
                  >
                    <Text style={styles.seekBtnText}>+30ث</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.quickSkipRow}>
                  <TouchableOpacity
                    style={styles.skipIntroBtn}
                    activeOpacity={0.85}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
                      onSendCommand('seekDelta', { deltaSec: 85 });
                    }}
                  >
                    <Text style={styles.skipIntroText}>⏭ تخطي المقدمة (+85ث)</Text>
                  </TouchableOpacity>

                  {queue.length > 0 ? (
                    <TouchableOpacity
                      style={styles.nextEpBtn}
                      activeOpacity={0.85}
                      onPress={() => {
                        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
                        onPlayNextNow && onPlayNextNow();
                      }}
                    >
                      <Text style={styles.nextEpBtnText}>الحلقة التالية</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {levels.length > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>جودة البث الفورية (HLS)</Text>
                  <View style={styles.chipsWrap}>
                    {levels.map((lv) => {
                      const active = currentQuality === lv.index;
                      return (
                        <TouchableOpacity
                          key={`lv-${lv.index}`}
                          style={[styles.chipBtn, active && styles.chipBtnActive]}
                          activeOpacity={0.8}
                          onPress={() => {
                            HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                            onSendCommand('setQuality', { levelIndex: lv.index });
                          }}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {lv.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.cardTitle}>السرعة ونسبة العرض</Text>
                <View style={styles.chipsWrap}>
                  {PLAYBACK_RATES.map((rate) => {
                    const active = Math.abs(playbackRate - rate) < 0.05;
                    return (
                      <TouchableOpacity
                        key={`rate-${rate}`}
                        style={[styles.chipBtn, active && styles.chipBtnActive]}
                        activeOpacity={0.8}
                        onPress={() => {
                          HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                          onSendCommand('setRate', { playbackRate: rate });
                        }}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {rate}x
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.aspectRow}>
                  <TouchableOpacity
                    style={[styles.aspectBtn, aspectMode === 'contain' && styles.aspectBtnActive]}
                    activeOpacity={0.8}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                      onSendCommand('setAspect', { aspectMode: 'contain' });
                    }}
                  >
                    <Text style={styles.aspectBtnText}>احتواء كامل (Contain)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.aspectBtn, aspectMode === 'cover' && styles.aspectBtnActive]}
                    activeOpacity={0.8}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                      onSendCommand('setAspect', { aspectMode: 'cover' });
                    }}
                  >
                    <Text style={styles.aspectBtnText}>ملء الشاشة (Cover)</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.volRow}>
                  <Text style={styles.cardTitle}>
                    صوت المتصفح: {muted ? 'مكتوم' : `${Math.round(volume)}%`}
                  </Text>
                  <View style={styles.volBtns}>
                    <TouchableOpacity
                      style={styles.volStepBtn}
                      onPress={() => {
                        HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                        onSendCommand('setVolume', { volume: Math.max(0, volume - 10) });
                      }}
                    >
                      <Text style={styles.volStepText}>−10%</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.muteBtn, muted && styles.muteBtnActive]}
                      onPress={() => {
                        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
                        onSendCommand('setMute', { muted: !muted });
                      }}
                    >
                      <Text style={styles.muteBtnText}>{muted ? 'إلغاء الكتم' : 'كتم'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.volStepBtn}
                      onPress={() => {
                        HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                        onSendCommand('setVolume', { volume: Math.min(100, volume + 10) });
                      }}
                    >
                      <Text style={styles.volStepText}>+10%</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {cinemaSession ? (
                  <TouchableOpacity
                    style={styles.stopAllBtn}
                    activeOpacity={0.85}
                    onPress={() => {
                      HapticsManager.trigger(HAPTIC_PATTERNS.POWER_TV);
                      onStopCinema && onStopCinema();
                    }}
                  >
                    <Text style={styles.stopAllBtnText}>إيقاف البث السينمائي وإغلاق الخادم</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : activeTab === 'subtitles' ? (
            <View style={styles.sectionStack}>
              <View style={styles.card}>
                <View style={styles.subHeadRow}>
                  <Text style={styles.cardTitle}>ملف الترجمة العربي (.SRT / .VTT)</Text>
                  {cinemaSession && cinemaSession.subtitleUri ? (
                    <TouchableOpacity onPress={onRemoveSubtitle}>
                      <Text style={styles.removeLink}>إزالة</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.pickSubBtn}
                  activeOpacity={0.82}
                  onPress={() => {
                    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
                    onPickSubtitle && onPickSubtitle();
                  }}
                >
                  <Text style={styles.pickSubBtnText} numberOfLines={1}>
                    {cinemaSession && cinemaSession.subtitleUri
                      ? `📄 ${cinemaSession.subtitleName || 'ترجمة مرفقة'} (تغيير الملف)`
                      : '📎 إرفاق ترجمة من الهاتف وبثها فوراً'}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.subLabel}>
                  حجم الخط: {subFontSize}px
                </Text>
                <View style={styles.stepControlRow}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => onUpdateSubtitleStyle({ fontSize: Math.max(18, subFontSize - 4) })}
                  >
                    <Text style={styles.stepBtnText}>تصغير −</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => onUpdateSubtitleStyle({ fontSize: 34 })}
                  >
                    <Text style={styles.stepBtnText}>افتراضي (34)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => onUpdateSubtitleStyle({ fontSize: Math.min(56, subFontSize + 4) })}
                  >
                    <Text style={styles.stepBtnText}>تكبير +</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.subLabel}>لون النص</Text>
                <View style={styles.chipsWrap}>
                  <TouchableOpacity
                    style={[styles.chipBtn, subColor === '#FFFFFF' && styles.chipBtnActive]}
                    onPress={() => onUpdateSubtitleStyle({ color: '#FFFFFF' })}
                  >
                    <Text style={styles.chipText}>أبيض ناصع</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chipBtn, subColor === '#FACC15' && styles.chipBtnActive]}
                    onPress={() => onUpdateSubtitleStyle({ color: '#FACC15' })}
                  >
                    <Text style={[styles.chipText, { color: '#FACC15' }]}>أصفر سينمائي</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.subLabel}>خلفية الترجمة</Text>
                <View style={styles.chipsWrap}>
                  {[
                    { label: 'بدون خلفية', val: 0 },
                    { label: 'خفيفة', val: 0.45 },
                    { label: 'داكنة', val: 0.8 },
                  ].map((opt) => {
                    const active = Math.abs(subBgOpacity - opt.val) < 0.08;
                    return (
                      <TouchableOpacity
                        key={opt.label}
                        style={[styles.chipBtn, active && styles.chipBtnActive]}
                        onPress={() => onUpdateSubtitleStyle({ bgOpacity: opt.val })}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.subLabel}>
                  الارتفاع عن أسفل الشاشة: {subVerticalOffset}%
                </Text>
                <View style={styles.stepControlRow}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() =>
                      onUpdateSubtitleStyle({ verticalOffset: Math.max(3, subVerticalOffset - 3) })
                    }
                  >
                    <Text style={styles.stepBtnText}>لأسفل ↓</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() =>
                      onUpdateSubtitleStyle({ verticalOffset: Math.min(30, subVerticalOffset + 3) })
                    }
                  >
                    <Text style={styles.stepBtnText}>لأعلى ↑</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.subLabel}>
                  مزامنة التوقيت: {subOffsetSec >= 0 ? `+${subOffsetSec.toFixed(1)}` : subOffsetSec.toFixed(1)} ثانية
                </Text>
                <View style={styles.stepControlRow}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() =>
                      onUpdateSubtitleStyle({ offsetSec: Number((subOffsetSec - 0.5).toFixed(1)) })
                    }
                  >
                    <Text style={styles.stepBtnText}>تأخير −0.5ث</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => onUpdateSubtitleStyle({ offsetSec: 0 })}
                  >
                    <Text style={styles.stepBtnText}>تصفير</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() =>
                      onUpdateSubtitleStyle({ offsetSec: Number((subOffsetSec + 0.5).toFixed(1)) })
                    }
                  >
                    <Text style={styles.stepBtnText}>تقديم +0.5ث</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.sectionStack}>
              <View style={styles.card}>
                <View style={styles.subHeadRow}>
                  <Text style={styles.cardTitle}>قائمة الانتظار ({queue.length})</Text>
                  {queue.length > 0 ? (
                    <TouchableOpacity onPress={onClearQueue}>
                      <Text style={styles.removeLink}>مسح الكل</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {queue.length === 0 ? (
                  <Text style={styles.emptyHint}>
                    قائمة الحلقات فارغة. أضف حلقات من «متصفح الصيد الذكي» أو نافذة البث ليتم تشغيلها تلقائياً بالترتيب.
                  </Text>
                ) : (
                  queue.map((item, idx) => (
                    <View key={item.queueId} style={styles.listItemRow}>
                      <View style={styles.listItemInfo}>
                        <Text dir="auto" style={styles.listItemTitle} numberOfLines={1}>
                          {idx + 1}. {item.title}
                        </Text>
                        <Text dir="ltr" style={styles.listItemSub} numberOfLines={1}>
                          {item.url}
                        </Text>
                      </View>
                      <View style={styles.listItemBtns}>
                        <TouchableOpacity
                          style={styles.playMiniBtn}
                          onPress={() => onPlayQueueItem && onPlayQueueItem(item)}
                        >
                          <Text style={styles.playMiniText}>تشغيل</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.delMiniBtn}
                          onPress={() => onRemoveQueueItem && onRemoveQueueItem(item.queueId)}
                        >
                          <Text style={styles.delMiniText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.card}>
                <View style={styles.subHeadRow}>
                  <Text style={styles.cardTitle}>متابعة المشاهدة ({resumeList.length})</Text>
                  {resumeList.length > 0 ? (
                    <TouchableOpacity onPress={onClearResumeList}>
                      <Text style={styles.removeLink}>مسح السجل</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {resumeList.length === 0 ? (
                  <Text style={styles.emptyHint}>
                    يتم حفظ موضع التوقف تلقائياً كل 5 ثوانٍ أثناء المشاهدة لتكمله لاحقاً بنقرة واحدة.
                  </Text>
                ) : (
                  resumeList.map((item) => {
                    const pct =
                      item.durationSec > 0
                        ? Math.min(100, Math.round((item.positionSec / item.durationSec) * 100))
                        : 0;
                    return (
                      <View key={item.id} style={styles.resumeCard}>
                        <View style={styles.listItemRow}>
                          <View style={styles.listItemInfo}>
                            <Text dir="auto" style={styles.listItemTitle} numberOfLines={1}>
                              {item.title}
                            </Text>
                            <Text style={styles.resumeTimeMeta}>
                              توقفت عند {formatSecondsHms(item.positionSec)}
                              {item.durationSec > 0 ? ` / ${formatSecondsHms(item.durationSec)}` : ''}
                            </Text>
                          </View>
                          <View style={styles.listItemBtns}>
                            <TouchableOpacity
                              style={styles.playMiniBtn}
                              onPress={() => onPlayResumeItem && onPlayResumeItem(item)}
                            >
                              <Text style={styles.playMiniText}>استكمال</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.delMiniBtn}
                              onPress={() => onRemoveResumeItem && onRemoveResumeItem(item.id)}
                            >
                              <Text style={styles.delMiniText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        {pct > 0 ? (
                          <View style={styles.resumeProgressBg}>
                            <View style={[styles.resumeProgressFill, { width: `${pct}%` }]} />
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D11' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2532',
    gap: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#181E2A',
    borderWidth: 1,
    borderColor: '#273142',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeGlyph: { color: '#E2E8F0', fontSize: 16, fontWeight: '700' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 3 },
  headerTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#131822',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  browserHeaderBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(14, 165, 233, 0.16)',
    borderWidth: 1,
    borderColor: '#0EA5E9',
  },
  browserHeaderBtnText: { color: '#38BDF8', fontSize: 11, fontWeight: '800' },
  receiverBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#12161F',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2532',
    gap: 8,
  },
  receiverUrlWrap: { flex: 1, gap: 2 },
  receiverUrlLabel: { color: '#64748B', fontSize: 10, fontWeight: '700', textAlign: 'right' },
  receiverUrlVal: { color: '#7DD3FC', fontSize: 12, fontWeight: '700', textAlign: 'left' },
  receiverBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tvOpenBtn: {
    backgroundColor: '#0EA5E9',
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
  },
  tvOpenBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  copyUrlBtn: {
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#2B3548',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
  },
  copyUrlBtnText: { color: '#E2E8F0', fontSize: 11, fontWeight: '700' },
  noticeBar: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  noticeText: { color: '#6EE7B7', fontSize: 12, fontWeight: '600', textAlign: 'right' },
  countdownCard: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(14, 165, 233, 0.15)',
    borderWidth: 1,
    borderColor: '#38BDF8',
    gap: 8,
  },
  countdownTop: { flexDirection: 'row', alignItems: 'center' },
  countdownTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800', flex: 1, textAlign: 'right' },
  countdownActions: { flexDirection: 'row', gap: 8 },
  countdownNowBtn: {
    flex: 1,
    backgroundColor: '#0EA5E9',
    borderRadius: 9,
    paddingVertical: 8,
    alignItems: 'center',
  },
  countdownNowText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  countdownCancelBtn: {
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  countdownCancelText: { color: '#CBD5E1', fontSize: 12, fontWeight: '700' },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#141923',
    borderWidth: 1,
    borderColor: '#1F2937',
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.18)',
    borderColor: '#0EA5E9',
  },
  tabText: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#38BDF8' },
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingBottom: 28 },
  sectionStack: { gap: 12 },
  card: {
    backgroundColor: '#131720',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
    padding: 14,
    gap: 12,
  },
  cardTitle: { color: '#E2E8F0', fontSize: 13, fontWeight: '800', textAlign: 'right' },
  seekWrap: { gap: 4 },
  seekHitArea: { height: 32, justifyContent: 'center', width: '100%' },
  seekTrackBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#252E3E',
    position: 'relative',
    justifyContent: 'center',
  },
  seekTrackFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0EA5E9',
  },
  seekThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    top: -5,
  },
  seekThumbActive: { transform: [{ scale: 1.2 }] },
  seekTimesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    direction: 'ltr',
  },
  seekTimeTxt: { color: '#94A3B8', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  seekBtn: {
    paddingVertical: 10,
    paddingHorizontal: 9,
    borderRadius: 10,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#273142',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekBtnText: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' },
  playPauseBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  quickSkipRow: { flexDirection: 'row', gap: 8 },
  skipIntroBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: 'rgba(250, 204, 21, 0.14)',
    borderWidth: 1,
    borderColor: '#FACC15',
    alignItems: 'center',
  },
  skipIntroText: { color: '#FDE047', fontSize: 13, fontWeight: '800' },
  nextEpBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: '#10B981',
    alignItems: 'center',
  },
  nextEpBtnText: { color: '#6EE7B7', fontSize: 13, fontWeight: '800' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#273142',
  },
  chipBtnActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.2)',
    borderColor: '#38BDF8',
  },
  chipText: { color: '#CBD5E1', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#38BDF8' },
  aspectRow: { flexDirection: 'row', gap: 8 },
  aspectBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#273142',
    alignItems: 'center',
  },
  aspectBtnActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.2)',
    borderColor: '#38BDF8',
  },
  aspectBtnText: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' },
  volRow: { gap: 10 },
  volBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  volStepBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#273142',
    alignItems: 'center',
  },
  volStepText: { color: '#E2E8F0', fontSize: 13, fontWeight: '700' },
  muteBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#273142',
  },
  muteBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#EF4444',
  },
  muteBtnText: { color: '#F8FAFC', fontSize: 12, fontWeight: '700' },
  stopAllBtn: {
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderWidth: 1,
    borderColor: '#EF4444',
    alignItems: 'center',
  },
  stopAllBtnText: { color: '#FCA5A5', fontSize: 13, fontWeight: '800' },
  subHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  removeLink: { color: '#F87171', fontSize: 12, fontWeight: '700' },
  pickSubBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#2B3548',
  },
  pickSubBtnText: { color: '#E2E8F0', fontSize: 12, fontWeight: '700', textAlign: 'right' },
  subLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '700', textAlign: 'right' },
  stepControlRow: { flexDirection: 'row', gap: 8 },
  stepBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#273142',
    alignItems: 'center',
  },
  stepBtnText: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' },
  emptyHint: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#1E2532',
  },
  listItemInfo: { flex: 1, gap: 2 },
  listItemTitle: { color: '#F1F5F9', fontSize: 13, fontWeight: '700', textAlign: 'right' },
  listItemSub: { color: '#64748B', fontSize: 11, textAlign: 'left' },
  resumeTimeMeta: { color: '#38BDF8', fontSize: 11, fontWeight: '600', textAlign: 'right' },
  listItemBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playMiniBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#0EA5E9',
  },
  playMiniText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  delMiniBtn: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#1E2532',
  },
  delMiniText: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
  resumeCard: { gap: 6 },
  resumeProgressBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1E2532',
    overflow: 'hidden',
    direction: 'ltr',
  },
  resumeProgressFill: { height: 4, backgroundColor: '#10B981' },
});
