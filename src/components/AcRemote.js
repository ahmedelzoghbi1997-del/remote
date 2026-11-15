import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { AC_MODES, FAN_SPEEDS } from '../ir/encoders';
import { colors, fontSizes, radii, spacing } from '../theme';
import RemoteIcon from './RemoteIcon';

function fireHaptic(ms = 10) {
  if (Platform.OS === 'web') return;
  try {
    Vibration.vibrate(ms);
  } catch (_) {
    // ignore
  }
}

function AcRemote({ acBrand, setAcBrand, acState, updateAcAndTransmit }) {
  const currentModeObj = AC_MODES.find((m) => m.key === acState.mode);
  const currentModeLabel = currentModeObj ? currentModeObj.label : 'تبريد';

  const currentFanObj = FAN_SPEEDS.find((f) => f.key === acState.fanSpeed);
  const currentFanLabel = currentFanObj ? currentFanObj.label : 'تلقائي';

  return (
    <View style={styles.container}>
      {/* اختيار الشركة المصنعة */}
      <View style={styles.rowGap}>
        {[
          { key: 'gree', label: 'Gree AC' },
          { key: 'carrier', label: 'Carrier AC' },
        ].map((b) => (
          <Pressable
            key={b.key}
            style={({ pressed }) => [
              styles.chipBtn,
              acBrand === b.key && styles.chipBtnActive,
              pressed && styles.pressedScale,
            ]}
            onPress={() => {
              fireHaptic(8);
              setAcBrand(b.key);
            }}
          >
            <Text style={[styles.chipText, acBrand === b.key && styles.chipTextActive]}>
              {b.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* شاشة عرض التكييف الرقمية */}
      <View style={[styles.acLcd, !acState.power && styles.acLcdOff]}>
        <View style={styles.acLcdTop}>
          <Text style={styles.acMeta}>الوضع: {currentModeLabel}</Text>
          <Text style={styles.acMeta}>المروحة: {currentFanLabel}</Text>
        </View>
        <View style={styles.lcdDivider} />
        <Text style={styles.acTemp}>
          {acState.power ? `${acState.temperature}°C` : 'OFF'}
        </Text>
        <Text style={styles.acFooter}>
          توجيه الهواء: {acState.swing ? 'متحرك' : 'ثابت'} · IR 38kHz
        </Text>
      </View>

      {/* مفاتيح الحرارة والطاقة */}
      <View style={styles.rowGap}>
        <Pressable
          accessibilityLabel="خفض درجة الحرارة"
          style={({ pressed }) => [styles.tempStepBtn, pressed && styles.pressedKey]}
          onPress={() => {
            fireHaptic(12);
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
          <RemoteIcon name="minus" color={colors.textPrimary} size={20} />
        </Pressable>

        <Pressable
          accessibilityLabel={acState.power ? 'إطفاء المكيف' : 'تشغيل المكيف'}
          style={({ pressed }) => [
            styles.acPowerBtn,
            acState.power ? styles.acPowerOn : styles.acPowerOff,
            pressed && styles.pressedScale,
          ]}
          onPress={() => {
            fireHaptic(16);
            const nextPower = !acState.power;
            updateAcAndTransmit({ ...acState, power: nextPower });
          }}
        >
          <RemoteIcon name="power" color={colors.white} size={22} />
        </Pressable>

        <Pressable
          accessibilityLabel="رفع درجة الحرارة"
          style={({ pressed }) => [styles.tempStepBtn, pressed && styles.pressedKey]}
          onPress={() => {
            fireHaptic(12);
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
          <RemoteIcon name="plus" color={colors.textPrimary} size={20} />
        </Pressable>
      </View>

      {/* أوضاع التشغيل */}
      <View style={styles.modesSection}>
        <Text style={styles.sectionCaption}>وضع التشغيل</Text>
        <View style={styles.modesWrap}>
          {AC_MODES.map((m) => {
            const active = acState.mode === m.key;
            return (
              <Pressable
                key={m.key}
                style={({ pressed }) => [
                  styles.modeChip,
                  active && styles.modeChipActive,
                  pressed && styles.pressedScale,
                ]}
                onPress={() => {
                  fireHaptic(10);
                  updateAcAndTransmit({ ...acState, power: true, mode: m.key });
                }}
              >
                <Text style={[styles.btnText, active && styles.btnTextBold]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* المروحة والتأرجح */}
      <View style={styles.rowGap}>
        <Pressable
          style={({ pressed }) => [styles.extraCard, pressed && styles.pressedKey]}
          onPress={() => {
            fireHaptic(10);
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
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.extraCard, pressed && styles.pressedKey]}
          onPress={() => {
            fireHaptic(10);
            const nextSwing = !acState.swing;
            updateAcAndTransmit({ ...acState, power: true, swing: nextSwing });
          }}
        >
          <Text style={styles.extraCaption}>تأرجح الريش</Text>
          <Text style={styles.btnTextBold}>
            {acState.swing ? 'يعمل' : 'متوقف'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    justifyContent: 'space-between',
  },
  rowGap: { flexDirection: 'row', gap: 10 },
  chipBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderBright,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  chipBtnActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  chipTextActive: { color: colors.white, fontWeight: '700' },

  acLcd: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderBright,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 6,
    elevation: 4,
  },
  acLcdOff: { opacity: 0.45 },
  acLcdTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },
  lcdDivider: {
    width: '100%',
    height: 1,
    backgroundColor: colors.border,
  },
  acMeta: { color: colors.textSecondary, fontSize: fontSizes.md, fontWeight: '600' },
  acTemp: {
    color: colors.textPrimary,
    fontSize: fontSizes.temp,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    paddingVertical: 2,
  },
  acFooter: { color: colors.accent, fontSize: fontSizes.sm, fontWeight: '600' },

  tempStepBtn: {
    width: 72,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.borderBright,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  acPowerBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  acPowerOn: {
    backgroundColor: colors.danger,
    borderWidth: 1,
    borderColor: colors.dangerBorderSoft,
  },
  acPowerOff: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  modesSection: {
    gap: spacing.sm,
  },
  sectionCaption: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: '600',
    textAlign: 'right',
  },
  modesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  modeChip: {
    width: '31%',
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  extraCard: {
    flex: 1,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderBright,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  extraCaption: { color: colors.textSecondary, fontSize: fontSizes.xs },
  btnText: { color: colors.textPrimary, fontSize: fontSizes.md, fontWeight: '600' },
  btnTextBold: { color: colors.white, fontSize: fontSizes.base, fontWeight: '700' },
  pressedScale: {
    opacity: 0.9,
    transform: [{ scale: 0.96 }],
  },
  pressedKey: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: 0.96 }],
  },
});

export default AcRemote;
