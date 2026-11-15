import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AC_MODES, FAN_SPEEDS } from '../ir/encoders';
import { colors, fontSizes, radii, spacing } from '../theme';
import RemoteIcon from './RemoteIcon';

function AcRemote({ acBrand, setAcBrand, acState, updateAcAndTransmit }) {
  const currentModeObj = AC_MODES.find((m) => m.key === acState.mode);
  const currentModeLabel = currentModeObj ? currentModeObj.label : 'تبريد';

  const currentFanObj = FAN_SPEEDS.find((f) => f.key === acState.fanSpeed);
  const currentFanLabel = currentFanObj ? currentFanObj.label : 'تلقائي';

  return (
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
          ].map((b) => {
            const active = acBrand === b.key;
            return (
              <TouchableOpacity
                key={b.key}
                style={[styles.brandChip, active && styles.brandChipActive]}
                activeOpacity={0.55}
                accessibilityLabel={b.label}
                accessibilityRole="button"
                onPress={() => setAcBrand(b.key)}
              >
                <Text style={[styles.brandText, active && styles.brandTextActive]}>
                  {b.label}
                </Text>
              </TouchableOpacity>
            );
          })}
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

        {/* صف التحكم بالحرارة والطاقة: [−] [زر طاقة دائري 64px] [+] */}
        <View style={styles.powerRow}>
          <TouchableOpacity
            style={styles.tempStepBtn}
            activeOpacity={0.55}
            accessibilityLabel="خفض الحرارة"
            accessibilityRole="button"
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
            <RemoteIcon name="minus" color={colors.textPrimary} size={22} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.acPowerCircleBtn}
            activeOpacity={0.55}
            accessibilityLabel="الطاقة"
            accessibilityRole="button"
            onPress={() => {
              const nextPower = !acState.power;
              updateAcAndTransmit({ ...acState, power: nextPower });
            }}
          >
            <RemoteIcon name="power" color={colors.textPrimary} size={24} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tempStepBtn}
            activeOpacity={0.55}
            accessibilityLabel="رفع الحرارة"
            accessibilityRole="button"
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
            <RemoteIcon name="plus" color={colors.textPrimary} size={22} />
          </TouchableOpacity>
        </View>

        {/* شريط الأوضاع الأفقي الموحّد (Segment) */}
        <View style={styles.modeSection}>
          <Text style={styles.sectionCaption}>وضع التشغيل</Text>
          <View style={styles.modeSegmentBar}>
            {AC_MODES.map((m) => {
              const active = acState.mode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.modeSegmentItem, active && styles.modeSegmentItemActive]}
                  activeOpacity={0.55}
                  accessibilityLabel={m.label}
                  accessibilityRole="button"
                  onPress={() =>
                    updateAcAndTransmit({ ...acState, power: true, mode: m.key })
                  }
                >
                  <Text
                    style={[styles.modeSegmentText, active && styles.modeSegmentTextActive]}
                    numberOfLines={1}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.rowGap}>
          <TouchableOpacity
            style={styles.extraCard}
            activeOpacity={0.55}
            accessibilityLabel="سرعة المروحة"
            accessibilityRole="button"
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
            <Text style={styles.extraValue}>{currentFanLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.extraCard}
            activeOpacity={0.55}
            accessibilityLabel="تأرجح الريش"
            accessibilityRole="button"
            onPress={() => {
              const nextSwing = !acState.swing;
              updateAcAndTransmit({ ...acState, power: true, swing: nextSwing });
            }}
          >
            <Text style={styles.extraCaption}>تأرجح الريش</Text>
            <Text style={styles.extraValue}>
              {acState.swing ? 'يعمل' : 'متوقف'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollArea: { flex: 1, width: '100%' },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  sectionStack: { width: '100%', gap: spacing.lg },
  rowGap: { flexDirection: 'row', gap: spacing.sm },
  brandChip: {
    flex: 1,
    height: 38,
    borderRadius: radii.capsule,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandChipActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  brandText: {
    color: colors.textSecondary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  brandTextActive: {
    color: colors.textPrimary,
  },

  acLcd: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  acLcdOff: { opacity: 0.45 },
  acLcdTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },
  acMeta: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  acTemp: {
    color: colors.textPrimary,
    fontSize: fontSizes.temp,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },
  acFooter: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  powerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  tempStepBtn: {
    width: 64,
    height: 64,
    borderRadius: radii.capsule,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acPowerCircleBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },

  modeSection: { gap: spacing.xs },
  sectionCaption: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'right',
  },
  modeSegmentBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    padding: 3,
    gap: 3,
  },
  modeSegmentItem: {
    flex: 1,
    height: 40,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.transparent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeSegmentItemActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  modeSegmentText: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  modeSegmentTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },

  extraCard: {
    flex: 1,
    height: 62,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  extraCaption: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  extraValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
});

export default AcRemote;
