import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DlnaCastService, {
  formatFileSize,
  formatSecondsHms,
  inferMediaTitle,
} from '../services/DlnaCastService';
import HapticsManager, { HAPTIC_PATTERNS } from '../services/HapticsManager';

function SeekSlider({
  positionSec,
  durationSec,
  isSeekable,
  transportState,
  onSeek,
}) {
  const [barWidth, setBarWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [dragSec, setDragSec] = useState(0);
  const lastHapticBucketRef = useRef(-1);
  const latestDurationRef = useRef(durationSec);
  const latestDragSecRef = useRef(0);
  latestDurationRef.current = durationSec;

  const canSeek =
    Boolean(isSeekable) &&
    durationSec > 0 &&
    transportState !== 'TRANSITIONING';

  const displayedPos = isDragging ? dragSec : Math.min(positionSec, durationSec || positionSec);
  const progress =
    canSeek && durationSec > 0
      ? Math.max(0, Math.min(1, displayedPos / durationSec))
      : 0;

  const computeSecondsFromEvent = (event) => {
    const x = Number(event && event.nativeEvent ? event.nativeEvent.locationX : 0);
    const width = Math.max(40, barWidth);
    const ratio = Math.max(0, Math.min(1, x / width));
    const dur = Math.max(0, Number(latestDurationRef.current) || 0);
    const maxSafeSec = dur > 2 ? dur - 2 : dur;
    const rawSec = Math.round(ratio * dur);
    return {
      ratio,
      seconds: Math.max(0, Math.min(maxSafeSec, rawSec)),
    };
  };

  const handleGrant = (event) => {
    if (!canSeek) {
      HapticsManager.trigger(HAPTIC_PATTERNS.AC_LIMIT_HIT);
      return;
    }
    const { ratio, seconds } = computeSecondsFromEvent(event);
    latestDragSecRef.current = seconds;
    lastHapticBucketRef.current = Math.round(ratio * 24);
    setDragSec(seconds);
    setIsDragging(true);
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
  };

  const handleMove = (event) => {
    if (!canSeek || !isDragging) return;
    const { ratio, seconds } = computeSecondsFromEvent(event);
    latestDragSecRef.current = seconds;
    setDragSec(seconds);
    const bucket = Math.round(ratio * 24);
    if (bucket !== lastHapticBucketRef.current) {
      lastHapticBucketRef.current = bucket;
      HapticsManager.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
    }
  };

  const handleRelease = () => {
    if (!canSeek || !isDragging) {
      setIsDragging(false);
      return;
    }
    const targetSec = latestDragSecRef.current;
    setIsDragging(false);
    lastHapticBucketRef.current = -1;
    HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    if (onSeek) {
      onSeek(targetSec);
    }
  };

  return (
    <View style={styles.seekWrap}>
      <View
        style={[styles.seekTrackHitArea, !canSeek && { opacity: 0.65 }]}
        onLayout={(e) => {
          const w = e && e.nativeEvent && e.nativeEvent.layout ? e.nativeEvent.layout.width : 0;
          if (w > 20) setBarWidth(w);
        }}
        pointerEvents="box-only"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => canSeek}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={handleRelease}
        onResponderTerminate={() => setIsDragging(false)}
      >
        <View style={[styles.seekTrackBg, !canSeek && styles.seekTrackBgLive]}>
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
                {
                  left: Math.max(0, Math.min(barWidth - 16, Math.round(progress * barWidth) - 8)),
                },
                isDragging && styles.seekThumbActive,
              ]}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.seekTimeRow}>
        <Text style={styles.seekTimeText}>{formatSecondsHms(displayedPos)}</Text>
        {!canSeek ? (
          <View style={styles.liveTagRow}>
            <View style={styles.livePulseDot} />
            <Text style={styles.liveTag}>
              {transportState === 'TRANSITIONING' ? 'جاري التحميل...' : 'بث مباشر'}
            </Text>
          </View>
        ) : (
          <Text style={styles.seekTimeText}>{formatSecondsHms(durationSec)}</Text>
        )}
      </View>
    </View>
  );
}

function VolumeBar({ volume, muted, onChangeVolume, onToggleMute }) {
  const [barWidth, setBarWidth] = useState(180);
  const lastStepRef = useRef(-1);

  const computeVol = (event) => {
    const x = Number(event && event.nativeEvent ? event.nativeEvent.locationX : 0);
    const ratio = Math.max(0, Math.min(1, x / Math.max(40, barWidth)));
    return Math.round(ratio * 100);
  };

  return (
    <View style={styles.volumeBox}>
      <View style={styles.volumeTopRow}>
        <TouchableOpacity
          style={[styles.muteChip, muted && styles.muteChipActive]}
          activeOpacity={0.75}
          onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM)}
          onPress={() => onToggleMute && onToggleMute(!muted)}
        >
          <Text style={styles.muteChipText}>{muted ? 'إلغاء الكتم' : 'كتم'}</Text>
        </TouchableOpacity>
        <Text style={styles.volumeValueText}>
          صوت الشاشة: {muted ? 'مكتوم' : `${volume}%`}
        </Text>
      </View>

      <View style={styles.volumeSliderRow}>
        <TouchableOpacity
          style={styles.volStepBtn}
          activeOpacity={0.75}
          onPressIn={() =>
            HapticsManager.trigger(
              volume <= 0 ? HAPTIC_PATTERNS.AC_LIMIT_HIT : HAPTIC_PATTERNS.AC_TEMP_DOWN
            )
          }
          onPress={() => onChangeVolume && onChangeVolume(Math.max(0, volume - 5))}
        >
          <Text style={styles.volStepGlyph}>−</Text>
        </TouchableOpacity>

        <View
          style={styles.volTrackHit}
          onLayout={(e) => {
            const w = e && e.nativeEvent && e.nativeEvent.layout ? e.nativeEvent.layout.width : 0;
            if (w > 20) setBarWidth(w);
          }}
          pointerEvents="box-only"
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            const next = computeVol(e);
            lastStepRef.current = Math.round(next / 5);
            HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
            onChangeVolume && onChangeVolume(next);
          }}
          onResponderMove={(e) => {
            const next = computeVol(e);
            const step = Math.round(next / 5);
            if (step !== lastStepRef.current) {
              lastStepRef.current = step;
              HapticsManager.trigger(HAPTIC_PATTERNS.NAV_REPEAT);
              onChangeVolume && onChangeVolume(next);
            }
          }}
          onResponderRelease={(e) => {
            lastStepRef.current = -1;
            const next = computeVol(e);
            HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
            onChangeVolume && onChangeVolume(next);
          }}
        >
          <View style={styles.volTrackBg}>
            <View
              style={[
                styles.volTrackFill,
                { width: `${muted ? 0 : Math.max(0, Math.min(100, volume))}%` },
              ]}
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.volStepBtn}
          activeOpacity={0.75}
          onPressIn={() =>
            HapticsManager.trigger(
              volume >= 100 ? HAPTIC_PATTERNS.AC_LIMIT_HIT : HAPTIC_PATTERNS.AC_TEMP_UP
            )
          }
          onPress={() => onChangeVolume && onChangeVolume(Math.min(100, volume + 5))}
        >
          <Text style={styles.volStepGlyph}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function DlnaCastModal({
  visible,
  onClose,
  defaultTvIp,
  playbackState,
  incomingIntent,
  onClearIncomingIntent,
  onErrorBanner,
}) {
  const [sourceTab, setSourceTab] = useState('local'); // 'local' | 'url'
  const [renderers, setRenderers] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const [pickedLocalFile, setPickedLocalFile] = useState(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteTitle, setRemoteTitle] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [pinHighestQuality, setPinHighestQuality] = useState(true);
  const [showHeadersPanel, setShowHeadersPanel] = useState(false);
  const [headerReferer, setHeaderReferer] = useState('');
  const [headerOrigin, setHeaderOrigin] = useState('');
  const [headerUserAgent, setHeaderUserAgent] = useState('');
  const [headerCookie, setHeaderCookie] = useState('');
  const [extraHeaders, setExtraHeaders] = useState({});

  const [selectedSubtitle, setSelectedSubtitle] = useState(null);
  const [subtitleOffsetSec, setSubtitleOffsetSec] = useState(0);
  const [isSniffing, setIsSniffing] = useState(false);
  const [sharedWebpageUrl, setSharedWebpageUrl] = useState('');
  const [isRecastingSub, setIsRecastingSub] = useState(false);

  const [isStartingCast, setIsStartingCast] = useState(false);
  const [castError, setCastError] = useState('');

  const isDirectMediaUrl = (rawUrl) => {
    const clean = String(rawUrl || '').trim().split('?')[0].split('#')[0].toLowerCase();
    return /\.(m3u8|m3u|mp4|mkv|ts|webm|mov|avi|m4v)$/.test(clean);
  };

  const buildFallbackDevice = (ip) => {
    const cleanIp = String(ip || '').trim();
    if (!cleanIp) return null;
    return {
      udn: `manual:${cleanIp}`,
      name: `Samsung TV (${cleanIp})`,
      manufacturer: 'Samsung Electronics',
      modelName: 'DLNA DMR :9197',
      ip: cleanIp,
      port: 9197,
      location: `http://${cleanIp}:9197/dmr`,
      avTransportControlUrl: `http://${cleanIp}:9197/upnp/control/AVTransport1`,
      renderingControlUrl: `http://${cleanIp}:9197/upnp/control/RenderingControl1`,
    };
  };

  const runDiscover = async () => {
    setIsDiscovering(true);
    setCastError('');
    try {
      const found = await DlnaCastService.discoverRenderers(defaultTvIp);
      const list = Array.isArray(found) ? found : [];
      if (list.length > 0) {
        setRenderers(list);
        setSelectedDevice((prev) => {
          if (prev && list.some((d) => d.ip === prev.ip)) {
            return list.find((d) => d.ip === prev.ip);
          }
          return list[0];
        });
      } else {
        const fallback = buildFallbackDevice(defaultTvIp);
        setRenderers(fallback ? [fallback] : []);
        if (fallback && !selectedDevice) {
          setSelectedDevice(fallback);
        }
      }
    } catch (err) {
      setCastError(err && err.message ? err.message : 'تعذر البحث عن شاشات DLNA');
      const fallback = buildFallbackDevice(defaultTvIp);
      if (fallback && renderers.length === 0) {
        setRenderers([fallback]);
        setSelectedDevice((prev) => prev || fallback);
      }
    } finally {
      setIsDiscovering(false);
    }
  };

  useEffect(() => {
    if (visible && renderers.length === 0 && !isDiscovering) {
      runDiscover();
    }
  }, [visible]);

  useEffect(() => {
    if (!incomingIntent) return;
    setCastError('');
    if (incomingIntent.isLocalUri) {
      setSharedWebpageUrl('');
      setSourceTab('local');
      setPickedLocalFile({
        uri: incomingIntent.url,
        name: incomingIntent.title || inferMediaTitle(incomingIntent.url, 'فيديو مشارك'),
        sizeBytes: 0,
        mimeType: incomingIntent.mimeType || 'video/mp4',
      });
    } else {
      const incomingUrl = String(incomingIntent.url || '').trim();
      setSourceTab('url');
      setRemoteUrl(incomingUrl);
      setRemoteTitle(incomingIntent.title || '');
      const incomingAction = String(incomingIntent.action || '');
      const isSharedWebpage =
        /^https?:\/\//i.test(incomingUrl) &&
        !isDirectMediaUrl(incomingUrl) &&
        (incomingAction === 'android.intent.action.SEND' ||
          String(incomingIntent.mimeType || '').toLowerCase() === 'text/plain');
      setSharedWebpageUrl(isSharedWebpage ? incomingUrl : '');

      const h = incomingIntent.headers || {};
      const ref = h.Referer || h.referer || '';
      const org = h.Origin || h.origin || '';
      const ua = h['User-Agent'] || h['user-agent'] || '';
      const ck = h.Cookie || h.cookie || '';
      const rem = {};
      Object.keys(h).forEach((k) => {
        const lk = k.toLowerCase();
        if (lk !== 'referer' && lk !== 'origin' && lk !== 'user-agent' && lk !== 'cookie' && h[k]) {
          rem[k] = h[k];
        }
      });
      setHeaderReferer(ref);
      setHeaderOrigin(org);
      setHeaderUserAgent(ua);
      setHeaderCookie(ck);
      setExtraHeaders(rem);
      if (ref || org || ua || ck || Object.keys(rem).length > 0) {
        setShowHeadersPanel(true);
        setUseProxy(true);
      }
    }
    if (onClearIncomingIntent) {
      onClearIncomingIntent();
    }
  }, [incomingIntent]);

  const buildSubtitlePayload = () => {
    if (!selectedSubtitle || !selectedSubtitle.uriOrUrl) return null;
    return {
      ...selectedSubtitle,
      offsetSec: Math.round(Number(subtitleOffsetSec) || 0),
    };
  };

  const handlePickVideo = async () => {
    setCastError('');
    try {
      const picked = await DlnaCastService.pickLocalVideo();
      if (picked && picked.uri) {
        setPickedLocalFile(picked);
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      }
    } catch (err) {
      if (err && err.code === 'PICK_CANCELLED') return;
      setCastError(err && err.message ? err.message : 'تعذر اختيار الفيديو');
    }
  };

  const handlePickSubtitle = async () => {
    setCastError('');
    try {
      const picked = await DlnaCastService.pickLocalSubtitle();
      if (picked && picked.uri) {
        setSelectedSubtitle({
          uriOrUrl: picked.uri,
          isLocal: true,
          title: picked.name || 'ترجمة محلية (.srt)',
          headers: {},
        });
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      }
    } catch (err) {
      if (err && err.code === 'PICK_CANCELLED') return;
      setCastError(err && err.message ? err.message : 'تعذر اختيار ملف الترجمة');
    }
  };

  const handleOpenSniffer = async (overrideUrl) => {
    const startUrl = typeof overrideUrl === 'string' && overrideUrl.trim() ? overrideUrl.trim() : remoteUrl;
    setCastError('');
    setIsSniffing(true);
    try {
      const res = await DlnaCastService.openMediaSniffer(startUrl);
      if (res && res.video && res.video.url) {
        setSharedWebpageUrl('');
        setSourceTab('url');
        setRemoteUrl(res.video.url);
        if (res.video.title) {
          setRemoteTitle(res.video.title);
        }
        setUseProxy(true);
        const h = res.video.headers || {};
        const ref = h.Referer || h.referer || '';
        const org = h.Origin || h.origin || '';
        const ua = h['User-Agent'] || h['user-agent'] || '';
        const ck = h.Cookie || h.cookie || '';
        const rem = {};
        Object.keys(h).forEach((k) => {
          const lk = k.toLowerCase();
          if (lk !== 'referer' && lk !== 'origin' && lk !== 'user-agent' && lk !== 'cookie' && h[k]) {
            rem[k] = h[k];
          }
        });
        setHeaderReferer(ref);
        setHeaderOrigin(org);
        setHeaderUserAgent(ua);
        setHeaderCookie(ck);
        setExtraHeaders(rem);
        if (ref || org || ua || ck || Object.keys(rem).length > 0) {
          setShowHeadersPanel(true);
        }
        if (res.subtitle && res.subtitle.url) {
          setSelectedSubtitle({
            uriOrUrl: res.subtitle.url,
            isLocal: false,
            title: res.subtitle.title || 'ترجمة المقطع الملتقطة',
            headers: res.subtitle.headers || {},
          });
        }
        HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
      }
    } catch (err) {
      if (err && err.code === 'SNIFFER_CANCELLED') return;
      setCastError(err && err.message ? err.message : 'تعذر تشغيل المتصفح المدمج لالتقاط الروابط');
    } finally {
      setIsSniffing(false);
    }
  };

  const handleStepSubtitleOffset = (delta) => {
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    setSubtitleOffsetSec((prev) => Math.max(-300, Math.min(300, prev + delta)));
  };

  const handleResetSubtitleOffset = () => {
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    setSubtitleOffsetSec(0);
  };

  const handleClearSubtitle = () => {
    HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP);
    setSelectedSubtitle(null);
    setSubtitleOffsetSec(0);
  };

  const handleRecastWithSubtitle = async (forceClear = false) => {
    setCastError('');
    if (onErrorBanner) onErrorBanner('');
    setIsRecastingSub(true);
    try {
      const subPayload = forceClear ? null : buildSubtitlePayload();
      await DlnaCastService.recastWithSubtitle(subPayload);
      if (forceClear) {
        setSelectedSubtitle(null);
        setSubtitleOffsetSec(0);
      }
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    } catch (err) {
      const msg = err && err.message ? err.message : 'تعذر إعادة الإرسال مع الترجمة';
      setCastError(msg);
      if (onErrorBanner) onErrorBanner(msg);
    } finally {
      setIsRecastingSub(false);
    }
  };

  const handleStartCast = async () => {
    setCastError('');
    if (onErrorBanner) onErrorBanner('');

    const targetDevice = selectedDevice || buildFallbackDevice(defaultTvIp);
    if (!targetDevice) {
      setCastError('يرجى البحث واختيار شاشة DLNA أولاً.');
      return;
    }

    const subtitlePayload = buildSubtitlePayload();
    setIsStartingCast(true);
    try {
      if (sourceTab === 'local') {
        if (!pickedLocalFile || !pickedLocalFile.uri) {
          throw new Error('اختر ملف فيديو من الهاتف أولاً.');
        }
        await DlnaCastService.castLocalFile(targetDevice, pickedLocalFile, subtitlePayload);
      } else {
        const headers = { ...extraHeaders };
        if (headerReferer.trim()) headers.Referer = headerReferer.trim();
        if (headerOrigin.trim()) headers.Origin = headerOrigin.trim();
        if (headerUserAgent.trim()) headers['User-Agent'] = headerUserAgent.trim();
        if (headerCookie.trim()) headers.Cookie = headerCookie.trim();
        await DlnaCastService.castRemoteUrl(targetDevice, {
          url: remoteUrl,
          title: remoteTitle,
          useProxy,
          pinHighestQuality,
          headers,
          subtitle: subtitlePayload,
        });
      }
      HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM);
    } catch (err) {
      const msg = err && err.message ? err.message : 'تعذر بدء البث إلى الشاشة';
      setCastError(msg);
      if (onErrorBanner) onErrorBanner(msg);
    } finally {
      setIsStartingCast(false);
    }
  };

  const handleControlAction = async (fn, haptic = HAPTIC_PATTERNS.NAV_TAP) => {
    HapticsManager.trigger(haptic);
    try {
      await fn();
    } catch (err) {
      setCastError(err && err.message ? err.message : 'تعذر تنفيذ أمر التحكم بالبث');
    }
  };

  const isPlaying =
    playbackState.transportState === 'PLAYING' ||
    playbackState.transportState === 'TRANSITIONING';

  const statusBadgeText =
    playbackState.transportState === 'PLAYING'
      ? 'جاري البث'
      : playbackState.transportState === 'PAUSED_PLAYBACK'
      ? 'متوقف مؤقتاً'
      : playbackState.transportState === 'TRANSITIONING'
      ? 'جاري التحضير...'
      : 'متوقف';

  return (
    <Modal visible={visible} transparent={false} animationType="slide">
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeBtn}
            activeOpacity={0.75}
            onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
            onPress={onClose}
            accessibilityLabel="إغلاق نافذة البث"
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.headerTitle}>البث المباشر DLNA / 4K</Text>
            <Text style={styles.headerSub}>Samsung AU7000 & UPnP MediaRenderer</Text>
          </View>
          <TouchableOpacity
            style={styles.scanChipBtn}
            activeOpacity={0.75}
            onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
            onPress={runDiscover}
            disabled={isDiscovering}
          >
            {isDiscovering ? (
              <ActivityIndicator size="small" color="#38BDF8" />
            ) : (
              <Text style={styles.scanChipText}>تحديث SSDP</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {castError || playbackState.error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{castError || playbackState.error}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>1. الشاشة المستهدفة (DLNA DMR)</Text>
              {isDiscovering ? <ActivityIndicator size="small" color="#0EA5E9" /> : null}
            </View>
            {renderers.length === 0 ? (
              <Text style={styles.mutedHint}>
                لم يتم العثور على شاشة DLNA بعد. تأكد من تشغيل التلفاز والاتصال بنفس شبكة الواي فاي.
              </Text>
            ) : (
              <View style={styles.deviceList}>
                {renderers.map((dev) => {
                  const isSel = selectedDevice && selectedDevice.ip === dev.ip;
                  return (
                    <TouchableOpacity
                      key={`${dev.ip}-${dev.udn || dev.port}`}
                      style={[styles.deviceItem, isSel && styles.deviceItemActive]}
                      activeOpacity={0.75}
                      onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                      onPress={() => setSelectedDevice(dev)}
                    >
                      <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName} numberOfLines={1}>
                          {dev.name}
                        </Text>
                        <Text style={styles.deviceMeta} numberOfLines={1}>
                          {dev.modelName ? `${dev.modelName} · ` : ''}
                          {dev.ip}:{dev.port}
                        </Text>
                      </View>
                      <Text style={styles.deviceBadge}>{isSel ? 'مختارة ✓' : 'اختيار'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {playbackState.active ? (
            <View style={[styles.card, styles.playerCard]}>
              <View style={styles.playerTopRow}>
                <View style={styles.liveDotBadge}>
                  <View
                    style={[
                      styles.liveDot,
                      isPlaying ? styles.liveDotPlaying : styles.liveDotPaused,
                    ]}
                  />
                  <Text style={styles.liveStatusText}>{statusBadgeText}</Text>
                </View>
                <Text style={styles.sourceModeTag}>
                  {playbackState.sourceMode === 'LOCAL_HTTP_206'
                    ? 'HTTP 206 محلي'
                    : playbackState.sourceMode === 'LOCAL_PROXY'
                    ? 'Local Proxy'
                    : 'Direct URL'}
                </Text>
              </View>

              <Text style={styles.nowPlayingTitle} numberOfLines={2}>
                {playbackState.title || 'فيديو قيد التشغيل'}
              </Text>
              <Text style={styles.nowPlayingDevice} numberOfLines={1}>
                على: {playbackState.deviceName} ({playbackState.deviceIp})
              </Text>

              <SeekSlider
                positionSec={playbackState.positionSec}
                durationSec={playbackState.durationSec}
                isSeekable={playbackState.isSeekable}
                transportState={playbackState.transportState}
                onSeek={(sec) => DlnaCastService.seek(sec)}
              />

              <View style={styles.transportRow}>
                <TouchableOpacity
                  style={styles.transportBtn}
                  activeOpacity={0.75}
                  disabled={!playbackState.isSeekable || playbackState.durationSec <= 0}
                  onPress={() =>
                    handleControlAction(() =>
                      DlnaCastService.seek(Math.max(0, (playbackState.positionSec || 0) - 15))
                    )
                  }
                >
                  <Text style={styles.transportText}>-15 ث</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.transportPrimaryBtn}
                  activeOpacity={0.8}
                  onPress={() =>
                    handleControlAction(
                      () => (isPlaying ? DlnaCastService.pause() : DlnaCastService.play()),
                      HAPTIC_PATTERNS.OK_CONFIRM
                    )
                  }
                >
                  <Text style={styles.transportPrimaryText}>
                    {isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.transportBtn}
                  activeOpacity={0.75}
                  disabled={!playbackState.isSeekable || playbackState.durationSec <= 0}
                  onPress={() =>
                    handleControlAction(() => {
                      const maxSafe = Math.max(0, (playbackState.durationSec || 0) - 2);
                      const nextTarget = Math.max(
                        0,
                        Math.min(maxSafe, (playbackState.positionSec || 0) + 15)
                      );
                      return DlnaCastService.seek(nextTarget);
                    })
                  }
                >
                  <Text style={styles.transportText}>+15 ث</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.transportStopBtn}
                  activeOpacity={0.8}
                  onPress={() =>
                    handleControlAction(() => DlnaCastService.stop(), HAPTIC_PATTERNS.POWER_TV)
                  }
                >
                  <Text style={styles.transportPrimaryText}>إيقاف</Text>
                </TouchableOpacity>
              </View>

              {(playbackState.hasSubtitle || selectedSubtitle) ? (
                <View style={styles.playerSubtitleBar}>
                  <View style={styles.playerSubtitleInfo}>
                    <Text style={styles.playerSubtitleLabel} numberOfLines={1}>
                      {playbackState.hasSubtitle
                        ? `الترجمة النشطة: ${playbackState.subtitleTitle || 'ملف SRT'} (${playbackState.subtitleOffsetSec >= 0 ? `+${playbackState.subtitleOffsetSec}` : playbackState.subtitleOffsetSec} ث)`
                        : `الترجمة المحددة: ${selectedSubtitle ? selectedSubtitle.title : ''}`}
                    </Text>
                    <View style={styles.subSyncMiniRow}>
                      <TouchableOpacity
                        style={styles.subSyncMiniBtn}
                        activeOpacity={0.75}
                        onPress={() => handleStepSubtitleOffset(-1)}
                      >
                        <Text style={styles.subSyncMiniText}>-1 ث</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.subSyncMiniBtn}
                        activeOpacity={0.75}
                        onPress={handleResetSubtitleOffset}
                      >
                        <Text style={styles.subSyncMiniText}>
                          توقيت: {subtitleOffsetSec > 0 ? `+${subtitleOffsetSec}` : subtitleOffsetSec} ث
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.subSyncMiniBtn}
                        activeOpacity={0.75}
                        onPress={() => handleStepSubtitleOffset(1)}
                      >
                        <Text style={styles.subSyncMiniText}>+1 ث</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.playerSubtitleActions}>
                    {selectedSubtitle ? (
                      <TouchableOpacity
                        style={[styles.recastSubBtn, isRecastingSub && { opacity: 0.65 }]}
                        activeOpacity={0.8}
                        disabled={isRecastingSub}
                        onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                        onPress={() => handleRecastWithSubtitle(false)}
                      >
                        {isRecastingSub ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.recastSubBtnText}>إعادة إرسال مع الترجمة</Text>
                        )}
                      </TouchableOpacity>
                    ) : null}

                    {playbackState.hasSubtitle ? (
                      <TouchableOpacity
                        style={styles.clearActiveSubBtn}
                        activeOpacity={0.8}
                        disabled={isRecastingSub}
                        onPress={() => handleRecastWithSubtitle(true)}
                      >
                        <Text style={styles.clearActiveSubText}>إزالة</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <VolumeBar
                volume={playbackState.volume || 0}
                muted={Boolean(playbackState.muted)}
                onChangeVolume={(v) => DlnaCastService.setVolume(v)}
                onToggleMute={(nextMuted) => DlnaCastService.setMute(nextMuted)}
              />
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>2. مصدر الفيديو للبث</Text>

            <View style={styles.segmentBox}>
              <TouchableOpacity
                style={[styles.segmentBtn, sourceTab === 'local' && styles.segmentActive]}
                activeOpacity={0.8}
                onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                onPress={() => setSourceTab('local')}
              >
                <Text style={styles.segmentText}>ملف محلي (4K Range)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, sourceTab === 'url' && styles.segmentActive]}
                activeOpacity={0.8}
                onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                onPress={() => setSourceTab('url')}
              >
                <Text style={styles.segmentText}>رابط مباشر / HLS .m3u8</Text>
              </TouchableOpacity>
            </View>

            {sourceTab === 'local' ? (
              <View style={styles.sourceSection}>
                <TouchableOpacity
                  style={styles.pickFileBtn}
                  activeOpacity={0.8}
                  onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                  onPress={handlePickVideo}
                >
                  <Text style={styles.pickFileBtnText}>
                    {pickedLocalFile ? 'تغيير ملف الفيديو من الهاتف' : 'اختيار فيديو من الهاتف (MP4 / MKV / 4K)'}
                  </Text>
                </TouchableOpacity>

                {pickedLocalFile ? (
                  <View style={styles.filePreviewBox}>
                    <Text style={styles.fileNameText} numberOfLines={2}>
                      {pickedLocalFile.name}
                    </Text>
                    <Text style={styles.fileMetaText}>
                      {pickedLocalFile.mimeType}
                      {pickedLocalFile.sizeBytes > 0
                        ? ` · ${formatFileSize(pickedLocalFile.sizeBytes)}`
                        : ''}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.mutedHint}>
                    يتم بث الملفات الكبيرة مباشرة بنظام HTTP 206 Partial Content دون تحميلها في الذاكرة، لتسريع التقديم والتأخير على شاشة التلفاز.
                  </Text>
                )}
              </View>
            ) : (
              <View style={styles.sourceSection}>
                {sharedWebpageUrl ? (
                  <View style={styles.sharedWebpageBanner}>
                    <Text style={styles.sharedWebpageTitle}>
                      تمت مشاركة رابط صفحة موقع (ليس رابط فيديو مباشر)
                    </Text>
                    <Text style={styles.sharedWebpageUrl} numberOfLines={2}>
                      {sharedWebpageUrl}
                    </Text>
                    <TouchableOpacity
                      style={[styles.sharedWebpageBtn, isSniffing && { opacity: 0.7 }]}
                      activeOpacity={0.82}
                      disabled={isSniffing}
                      onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.OK_CONFIRM)}
                      onPress={() => handleOpenSniffer(sharedWebpageUrl)}
                    >
                      {isSniffing ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.sharedWebpageBtnText}>
                          فتح الرابط في صائد الفيديو المدمج لالتقاط البث
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.snifferLaunchBtn, isSniffing && { opacity: 0.7 }]}
                  activeOpacity={0.82}
                  disabled={isSniffing}
                  onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                  onPress={() => handleOpenSniffer()}
                >
                  {isSniffing ? (
                    <ActivityIndicator size="small" color="#38BDF8" />
                  ) : (
                    <>
                      <Text style={styles.snifferLaunchTitle}>
                        المتصفح المدمج لالتقاط الفيديو والترجمة (Web Sniffer)
                      </Text>
                      <Text style={styles.snifferLaunchSub}>
                        تصفح الموقع وشغّل الفيديو لالتقاط رابط MP4/M3U8 والترجمة تلقائياً مع الكوكيز
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <Text style={styles.inputLabel}>رابط الفيديو أو البث (MP4 / MKV / TS / M3U8)</Text>
                <TextInput
                  style={styles.urlInput}
                  value={remoteUrl}
                  onChangeText={(txt) => {
                    setRemoteUrl(txt);
                    if (isDirectMediaUrl(txt) || !txt.trim()) {
                      setSharedWebpageUrl('');
                    }
                  }}
                  placeholder="https://example.com/stream.m3u8"
                  placeholderTextColor="#64748B"
                />

                <Text style={styles.inputLabel}>عنوان العرض على الشاشة (اختياري)</Text>
                <TextInput
                  style={styles.titleInput}
                  value={remoteTitle}
                  onChangeText={setRemoteTitle}
                  placeholder="مثال: مباراة مباشرة أو فيلم 4K"
                  placeholderTextColor="#64748B"
                />

                <View style={styles.proxyToggleRow}>
                  <TouchableOpacity
                    style={[styles.proxyChip, useProxy && styles.proxyChipActive]}
                    activeOpacity={0.8}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                    onPress={() => setUseProxy(true)}
                  >
                    <Text style={styles.proxyChipTitle}>البروكسي المحلي (Proxy)</Text>
                    <Text style={styles.proxyChipSub}>يمرر الترويسات ويعيد كتابة M3U8</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.proxyChip, !useProxy && styles.proxyChipActive]}
                    activeOpacity={0.8}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                    onPress={() => setUseProxy(false)}
                  >
                    <Text style={styles.proxyChipTitle}>مباشر للشاشة (Direct)</Text>
                    <Text style={styles.proxyChipSub}>لروابط http:// المباشرة فقط</Text>
                  </TouchableOpacity>
                </View>

                {!useProxy && (/^https:\/\//i.test(remoteUrl.trim()) || selectedSubtitle) ? (
                  <Text style={styles.httpsAutoHint}>
                    ملاحظة: يتم التمرير تلقائياً عبر البروكسي المحلي عند استخدام HTTPS أو إرفاق ترجمة عربية (CaptionInfo.sec).
                  </Text>
                ) : null}

                {useProxy || /^https:\/\//i.test(remoteUrl.trim()) ? (
                  <TouchableOpacity
                    style={styles.hlsPinRow}
                    activeOpacity={0.8}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                    onPress={() => setPinHighestQuality((prev) => !prev)}
                  >
                    <View
                      style={[
                        styles.hlsPinCheck,
                        pinHighestQuality && styles.hlsPinCheckActive,
                      ]}
                    >
                      <Text style={styles.hlsPinCheckMark}>
                        {pinHighestQuality ? '✓' : ''}
                      </Text>
                    </View>
                    <Text style={styles.hlsPinText}>
                      تثبيت أعلى جودة HLS (يمنع تقطيع الصوت عند التبديل التلقائي)
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.headersToggleBtn}
                  activeOpacity={0.75}
                  onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                  onPress={() => setShowHeadersPanel((prev) => !prev)}
                >
                  <Text style={styles.headersToggleText}>
                    {showHeadersPanel
                      ? '▲ إخفاء ترويسات HTTP المخصصة'
                      : '▼ ترويسات HTTP مخصصة (Referer / Origin / UA / Cookie)'}
                  </Text>
                </TouchableOpacity>

                {showHeadersPanel ? (
                  <View style={styles.headersBox}>
                    <Text style={styles.inputLabel}>Referer</Text>
                    <TextInput
                      style={styles.urlInput}
                      value={headerReferer}
                      onChangeText={setHeaderReferer}
                      placeholder="https://site.example/"
                      placeholderTextColor="#64748B"
                    />
                    <Text style={styles.inputLabel}>Origin</Text>
                    <TextInput
                      style={styles.urlInput}
                      value={headerOrigin}
                      onChangeText={setHeaderOrigin}
                      placeholder="https://site.example"
                      placeholderTextColor="#64748B"
                    />
                    <Text style={styles.inputLabel}>User-Agent</Text>
                    <TextInput
                      style={styles.urlInput}
                      value={headerUserAgent}
                      onChangeText={setHeaderUserAgent}
                      placeholder="Mozilla/5.0 ..."
                      placeholderTextColor="#64748B"
                    />
                    <Text style={styles.inputLabel}>Cookie</Text>
                    <TextInput
                      style={styles.urlInput}
                      value={headerCookie}
                      onChangeText={setHeaderCookie}
                      placeholder="session=..."
                      placeholderTextColor="#64748B"
                    />
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.subtitleCard}>
              <View style={styles.subtitleTopRow}>
                <Text style={styles.subtitleCardTitle}>الترجمة العربية (.SRT / .VTT)</Text>
                <View style={styles.subtitleBtnRow}>
                  {selectedSubtitle ? (
                    <TouchableOpacity
                      style={styles.clearSubChip}
                      activeOpacity={0.75}
                      onPress={handleClearSubtitle}
                    >
                      <Text style={styles.clearSubChipText}>مسح</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.pickSubChip}
                    activeOpacity={0.8}
                    onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
                    onPress={handlePickSubtitle}
                  >
                    <Text style={styles.pickSubChipText}>
                      {selectedSubtitle ? 'تغيير ملف الترجمة' : 'اختيار ملف ترجمة'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {selectedSubtitle ? (
                <>
                  <Text style={styles.subtitleFileName} numberOfLines={2}>
                    {selectedSubtitle.isLocal ? 'ملف محلي: ' : 'رابط ملتقط: '}
                    {selectedSubtitle.title}
                  </Text>
                  <Text style={styles.subtitleFormatNote}>
                    تحويل تلقائي من Windows-1256 / WebVTT إلى UTF-8 BOM متوافق مع Samsung AU7000
                  </Text>
                  <View style={styles.subtitleOffsetRow}>
                    <TouchableOpacity
                      style={styles.offsetStepBtn}
                      activeOpacity={0.75}
                      onPress={() => handleStepSubtitleOffset(-1)}
                    >
                      <Text style={styles.offsetStepText}>-1 ث</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.offsetReadoutBtn}
                      activeOpacity={0.75}
                      onPress={handleResetSubtitleOffset}
                    >
                      <Text style={styles.offsetReadoutText}>
                        مزامنة التوقيت: {subtitleOffsetSec > 0 ? `+${subtitleOffsetSec}` : subtitleOffsetSec} ث
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.offsetStepBtn}
                      activeOpacity={0.75}
                      onPress={() => handleStepSubtitleOffset(1)}
                    >
                      <Text style={styles.offsetStepText}>+1 ث</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <Text style={styles.subtitleEmptyHint}>
                  اختياري: أضف ملف ترجمة من الهاتف أو التقطها تلقائياً من المتصفح المدمج لعرضها مع الفيديو على التلفاز.
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.castSubmitBtn,
                isStartingCast && { opacity: 0.7 },
              ]}
              activeOpacity={0.82}
              disabled={isStartingCast}
              onPressIn={() => HapticsManager.trigger(HAPTIC_PATTERNS.NAV_TAP)}
              onPress={handleStartCast}
            >
              {isStartingCast ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.castSubmitText}>
                  {selectedSubtitle ? 'بدء البث على التلفاز مع الترجمة' : 'بدء البث على التلفاز الآن'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0D11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 58,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2532',
    gap: 10,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
  },
  headerTitleGroup: {
    flex: 1,
    alignItems: 'flex-start',
  },
  headerTitle: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 11,
  },
  scanChipBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#252E3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanChipText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 14,
    gap: 12,
    paddingBottom: 28,
  },
  errorBanner: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  card: {
    backgroundColor: '#131720',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 14,
    gap: 10,
  },
  playerCard: {
    borderColor: 'rgba(14,165,233,0.45)',
    backgroundColor: '#111827',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#F1F5F9',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  mutedHint: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  deviceList: {
    gap: 8,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B0D11',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  deviceItemActive: {
    borderColor: '#0EA5E9',
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  deviceInfo: {
    flex: 1,
    gap: 2,
  },
  deviceName: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  deviceMeta: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'right',
  },
  deviceBadge: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  playerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveDotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveDotPlaying: {
    backgroundColor: '#22C55E',
  },
  liveDotPaused: {
    backgroundColor: '#F59E0B',
  },
  liveStatusText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
  },
  sourceModeTag: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  nowPlayingTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  nowPlayingDevice: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'right',
  },
  seekWrap: {
    gap: 4,
    marginTop: 4,
  },
  seekTrackHitArea: {
    height: 30,
    justifyContent: 'center',
    direction: 'ltr',
  },
  seekTrackBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    position: 'relative',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  seekTrackBgLive: {
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    backgroundColor: 'rgba(245,158,11,0.1)',
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
    backgroundColor: '#F1F5F9',
    borderWidth: 2,
    borderColor: '#0EA5E9',
    top: -5,
  },
  seekThumbActive: {
    transform: [{ scale: 1.2 }],
    backgroundColor: '#38BDF8',
  },
  seekTimeRow: {
    flexDirection: 'row',
    direction: 'ltr',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seekTimeText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  liveTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  liveTag: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
  transportRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  transportBtn: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transportPrimaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transportStopBtn: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transportText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
  },
  transportPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  volumeBox: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E2532',
    gap: 8,
  },
  volumeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  volumeValueText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  muteChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
  },
  muteChipActive: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245,158,11,0.16)',
  },
  muteChipText: {
    color: '#F1F5F9',
    fontSize: 11,
    fontWeight: '700',
  },
  volumeSliderRow: {
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    gap: 10,
  },
  volStepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volStepGlyph: {
    color: '#F1F5F9',
    fontSize: 17,
    fontWeight: '700',
  },
  volTrackHit: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  volTrackBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  volTrackFill: {
    height: 6,
    backgroundColor: '#38BDF8',
  },
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: '#0B0D11',
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
    paddingHorizontal: 6,
  },
  segmentActive: {
    backgroundColor: '#0EA5E9',
  },
  segmentText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  sourceSection: {
    gap: 8,
  },
  pickFileBtn: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#38BDF8',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  pickFileBtnText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  filePreviewBox: {
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 12,
    gap: 4,
  },
  fileNameText: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  fileMetaText: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'right',
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'right',
  },
  urlInput: {
    minHeight: 42,
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#F1F5F9',
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'left',
  },
  titleInput: {
    minHeight: 42,
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#1E2532',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#F1F5F9',
    fontSize: 13,
    textAlign: 'right',
  },
  proxyToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  proxyChip: {
    flex: 1,
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 10,
    gap: 3,
    alignItems: 'center',
  },
  proxyChipActive: {
    borderColor: '#0EA5E9',
    backgroundColor: 'rgba(14,165,233,0.14)',
  },
  proxyChipTitle: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  proxyChipSub: {
    color: '#94A3B8',
    fontSize: 10,
    textAlign: 'center',
  },
  httpsAutoHint: {
    color: '#38BDF8',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'right',
    backgroundColor: 'rgba(14,165,233,0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hlsPinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B0D11',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2532',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  hlsPinCheck: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#131720',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hlsPinCheckActive: {
    borderColor: '#0EA5E9',
    backgroundColor: '#0EA5E9',
  },
  hlsPinCheckMark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  hlsPinText: {
    flex: 1,
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  headersToggleBtn: {
    paddingVertical: 6,
    alignItems: 'flex-end',
  },
  headersToggleText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  headersBox: {
    backgroundColor: '#0B0D11',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 10,
    gap: 6,
  },
  castSubmitBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  castSubmitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  sharedWebpageBanner: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22C55E',
    padding: 12,
    gap: 6,
  },
  sharedWebpageTitle: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  sharedWebpageUrl: {
    color: '#CBD5E1',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  sharedWebpageBtn: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#16A34A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginTop: 2,
  },
  sharedWebpageBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  snifferLaunchBtn: {
    backgroundColor: 'rgba(14,165,233,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0EA5E9',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 3,
    alignItems: 'center',
  },
  snifferLaunchTitle: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  snifferLaunchSub: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  subtitleCard: {
    backgroundColor: '#0B0D11',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2532',
    padding: 11,
    gap: 8,
  },
  subtitleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  subtitleCardTitle: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
    flex: 1,
  },
  subtitleBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickSubChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  pickSubChipText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  clearSubChip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  clearSubChipText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
  },
  subtitleFileName: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  subtitleFormatNote: {
    color: '#94A3B8',
    fontSize: 10,
    textAlign: 'right',
  },
  subtitleEmptyHint: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'right',
  },
  subtitleOffsetRow: {
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    gap: 8,
  },
  offsetStepBtn: {
    minWidth: 52,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#252E3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offsetStepText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '700',
  },
  offsetReadoutBtn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#1E2532',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offsetReadoutText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  playerSubtitleBar: {
    backgroundColor: '#0B0D11',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.35)',
    padding: 10,
    gap: 8,
    marginTop: 4,
  },
  playerSubtitleInfo: {
    gap: 6,
  },
  playerSubtitleLabel: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  subSyncMiniRow: {
    flexDirection: 'row',
    direction: 'ltr',
    alignItems: 'center',
    gap: 6,
  },
  subSyncMiniBtn: {
    flex: 1,
    height: 30,
    borderRadius: 7,
    backgroundColor: '#131720',
    borderWidth: 1,
    borderColor: '#252E3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subSyncMiniText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
  },
  playerSubtitleActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  recastSubBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 9,
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  recastSubBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  clearActiveSubBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: '#1A202C',
    borderWidth: 1,
    borderColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearActiveSubText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
});
