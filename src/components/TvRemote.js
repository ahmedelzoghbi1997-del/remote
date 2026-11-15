import React from 'react';
import { Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { TV_IR_BRANDS } from '../ir/encoders';
import { colors, fontSizes, radii, spacing } from '../theme';
import RemoteIcon from './RemoteIcon';
import RepeatableButton from './RepeatableButton';

function fireHaptic(ms = 12) {
  if (Platform.OS === 'web') return;
  try {
    Vibration.vibrate(ms);
  } catch (_) {
    // ignore
  }
}

function TactileCircleKey({ icon, label, onPress, accessibilityLabel }) {
  return (
    <View style={styles.utilityItem}>
      <Pressable
        accessibilityLabel={accessibilityLabel || label}
        style={({ pressed }) => [
          styles.utilityCircleBtn,
          pressed && styles.keyPressed,
        ]}
        onPress={() => {
          fireHaptic(10);
          onPress();
        }}
      >
        <RemoteIcon name={icon} color={colors.iconLight} size={19} />
      </Pressable>
      <Text style={styles.keyMicroLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function TvRemote({
  tvTransport,
  tvBrand,
  wifiProtocol,
  wifiStatus,
  hasIrHardware,
  onOpenSettings,
  onTvCommand,
}) {
  const protocolDisplayLabel =
    wifiProtocol === 'samsung_tizen'
      ? 'Samsung Tizen'
      : wifiProtocol === 'roku'
      ? 'Roku ECP'
      : 'Android TV';

  const deviceLabel =
    tvTransport === 'wifi'
      ? wifiStatus.deviceName || protocolDisplayLabel
      : (TV_IR_BRANDS[tvBrand] && TV_IR_BRANDS[tvBrand].label) || 'Samsung (0x0707)';

  const isConnected =
    tvTransport === 'wifi' ? Boolean(wifiStatus.isConnected) : Boolean(hasIrHardware);

  return (
    <View style={styles.container}>
      {/* 1) الهيدر: كبسولة الجهاز + أيقونة الإعدادات + زر الطاقة */}
      <View style={styles.headerRow}>
        <View style={styles.deviceGroup}>
          <Pressable
            accessibilityLabel="إعدادات الشاشة والاتصال"
            style={({ pressed }) => [
              styles.devicePill,
              pressed && styles.devicePillPressed,
            ]}
            onPress={() => {
              fireHaptic(8);
              onOpenSettings();
            }}
          >
            <View
              style={[
                styles.statusDot,
                isConnected ? styles.statusDotOn : styles.statusDotIdle,
              ]}
            />
            <Text style={styles.devicePillText} numberOfLines={1}>
              {deviceLabel}
            </Text>
            <RemoteIcon name="sliders" color={colors.textSecondary} size={16} />
          </Pressable>
          <Text style={styles.transportLabel}>
            {tvTransport === 'ir' ? 'IR' : 'Wi-Fi'}
          </Text>
        </View>

        <Pressable
          accessibilityLabel="تشغيل أو إيقاف الشاشة"
          style={({ pressed }) => [
            styles.powerCircleBtn,
            pressed && styles.powerPressed,
          ]}
          onPress={() => {
            fireHaptic(18);
            onTvCommand('POWER');
          }}
        >
          <RemoteIcon name="power" color={colors.white} size={22} />
        </Pressable>
      </View>

      {/* 2) الوسط: قرص التنقل الدائري المتوازن (204px) مع حلقة داخلية وزر OK */}
      <View style={styles.dpadOuterContainer}>
        <View style={styles.dpadSurface}>
          <View style={styles.dpadInnerTrack} pointerEvents="none" />

          <RepeatableButton
            accessibilityLabel="أعلى"
            style={styles.dpadTouchZoneTopBottom}
            repeatIntervalMs={130}
            onAction={() => onTvCommand('UP')}
          >
            <RemoteIcon name="chevron_up" color={colors.iconLight} size={19} />
          </RepeatableButton>

          <View style={styles.dpadMiddleBand}>
            <RepeatableButton
              accessibilityLabel="يمين"
              style={styles.dpadTouchZoneSide}
              repeatIntervalMs={130}
              onAction={() => onTvCommand('RIGHT')}
            >
              <RemoteIcon name="chevron_right" color={colors.iconLight} size={19} />
            </RepeatableButton>

            <Pressable
              accessibilityLabel="موافق"
              style={({ pressed }) => [
                styles.dpadOkCircle,
                pressed && styles.okPressed,
              ]}
              onPress={() => {
                fireHaptic(14);
                onTvCommand('OK');
              }}
            >
              <Text style={styles.dpadOkText}>OK</Text>
            </Pressable>

            <RepeatableButton
              accessibilityLabel="يسار"
              style={styles.dpadTouchZoneSide}
              repeatIntervalMs={130}
              onAction={() => onTvCommand('LEFT')}
            >
              <RemoteIcon name="chevron_left" color={colors.iconLight} size={19} />
            </RepeatableButton>
          </View>

          <RepeatableButton
            accessibilityLabel="أسفل"
            style={styles.dpadTouchZoneTopBottom}
            repeatIntervalMs={130}
            onAction={() => onTvCommand('DOWN')}
          >
            <RemoteIcon name="chevron_down" color={colors.iconLight} size={19} />
          </RepeatableButton>
        </View>
      </View>

      {/* 3) صف الاختصارات السريعة (4 أزرار دائرية 48px) */}
      <View style={styles.utilityRow}>
        <TactileCircleKey
          icon="back"
          label="رجوع"
          onPress={() => onTvCommand('BACK')}
        />
        <TactileCircleKey
          icon="home"
          label="رئيسية"
          onPress={() => onTvCommand('HOME')}
        />
        <TactileCircleKey
          icon="menu"
          label="قائمة"
          onPress={() => onTvCommand('MENU')}
        />
        <TactileCircleKey
          icon="mute"
          label="كتم"
          onPress={() => onTvCommand('MUTE')}
        />
      </View>

      {/* 4) الأسفل: ذراعا الصوت (يمين) والقنوات (يسار) مع زر المصدر في المنتصف */}
      <View style={styles.rockersRow}>
        <View style={styles.verticalPill}>
          <RepeatableButton
            accessibilityLabel="رفع الصوت"
            style={styles.pillHalfBtn}
            repeatIntervalMs={120}
            onAction={() => onTvCommand('VOL_UP')}
          >
            <RemoteIcon name="plus" color={colors.textPrimary} size={18} />
          </RepeatableButton>

          <View style={styles.pillCenterBadge} pointerEvents="none">
            <View style={styles.pillDivider} />
            <RemoteIcon name="volume" color={colors.textSecondary} size={16} />
            <Text style={styles.pillCenterText}>الصوت</Text>
            <View style={styles.pillDivider} />
          </View>

          <RepeatableButton
            accessibilityLabel="خفض الصوت"
            style={styles.pillHalfBtn}
            repeatIntervalMs={120}
            onAction={() => onTvCommand('VOL_DOWN')}
          >
            <RemoteIcon name="minus" color={colors.textPrimary} size={18} />
          </RepeatableButton>
        </View>

        <TactileCircleKey
          icon="input"
          label="المصدر"
          accessibilityLabel="تبديل مصدر الإدخال HDMI"
          onPress={() => onTvCommand('INPUT')}
        />

        <View style={styles.verticalPill}>
          <RepeatableButton
            accessibilityLabel="القناة التالية"
            style={styles.pillHalfBtn}
            repeatIntervalMs={150}
            onAction={() => onTvCommand('CH_UP')}
          >
            <RemoteIcon name="chevron_up" color={colors.textPrimary} size={18} />
          </RepeatableButton>

          <View style={styles.pillCenterBadge} pointerEvents="none">
            <View style={styles.pillDivider} />
            <RemoteIcon name="channel" color={colors.textSecondary} size={16} />
            <Text style={styles.pillCenterText}>القنوات</Text>
            <View style={styles.pillDivider} />
          </View>

          <RepeatableButton
            accessibilityLabel="القناة السابقة"
            style={styles.pillHalfBtn}
            repeatIntervalMs={150}
            onAction={() => onTvCommand('CH_DOWN')}
          >
            <RemoteIcon name="chevron_down" color={colors.textPrimary} size={18} />
          </RepeatableButton>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    paddingHorizontal: spacing.xl,
    paddingTop: 2,
    paddingBottom: 6,
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // 1) الهيدر العلوي
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    flexShrink: 0,
  },
  deviceGroup: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 2,
  },
  devicePill: {
    minHeight: 48,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderBright,
  },
  devicePillPressed: {
    backgroundColor: colors.surfaceHigh,
    transform: [{ scale: 0.98 }],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    flexShrink: 0,
  },
  statusDotOn: { backgroundColor: colors.success },
  statusDotIdle: { backgroundColor: colors.mutedDark },
  devicePillText: {
    color: colors.textPrimary,
    fontSize: fontSizes.base,
    fontWeight: '600',
    flexShrink: 1,
  },
  transportLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
  },
  powerCircleBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.danger,
    borderWidth: 1,
    borderColor: colors.dangerBorderSoft,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    flexShrink: 0,
  },
  powerPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.92 }],
  },

  // 2) قرص التنقل الدائري (204px)
  dpadOuterContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dpadSurface: {
    width: 204,
    height: 204,
    minHeight: 204,
    borderRadius: 102,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderBright,
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
    padding: 4,
    elevation: 6,
    flexShrink: 0,
  },
  dpadInnerTrack: {
    position: 'absolute',
    top: 30,
    left: 30,
    width: 141,
    height: 141,
    borderRadius: 71,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dpadTouchZoneTopBottom: {
    flex: 1,
    minHeight: 54,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadMiddleBand: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  dpadTouchZoneSide: {
    flex: 1,
    minWidth: 48,
    minHeight: 54,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadOkCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    flexShrink: 0,
  },
  okPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.93 }],
  },
  dpadOkText: {
    color: colors.white,
    fontSize: fontSizes.base,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  // 3) صف الاختصارات السريعة
  utilityRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    flexShrink: 0,
  },
  utilityItem: {
    alignItems: 'center',
    gap: 3,
  },
  utilityCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.borderBright,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    flexShrink: 0,
  },
  keyPressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: 0.92 }],
  },
  keyMicroLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: '600',
    textAlign: 'center',
  },

  // 4) ذراعا الصوت والقنوات وزر المصدر
  rockersRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    flexShrink: 0,
  },
  verticalPill: {
    width: 72,
    height: 140,
    minHeight: 140,
    borderRadius: 36,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.borderBright,
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    paddingVertical: 2,
    elevation: 4,
    flexShrink: 0,
  },
  pillHalfBtn: {
    flex: 1,
    minHeight: 50,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillCenterBadge: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 1,
    flexShrink: 0,
  },
  pillDivider: {
    width: 26,
    height: 1,
    backgroundColor: colors.border,
  },
  pillCenterText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
});

export default TvRemote;
