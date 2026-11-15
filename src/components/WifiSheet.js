import React from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { TV_IR_BRANDS } from '../ir/encoders';
import { colors, fontSizes, radii, spacing } from '../theme';

function WifiSheet({
  visible,
  onClose,
  tvTransport,
  setTvTransport,
  tvBrand,
  setTvBrand,
  wifiProtocol,
  setWifiProtocol,
  tvPort,
  setTvPort,
  dialPort,
  setDialPort,
  subnetPrefix,
  setSubnetPrefix,
  isDiscovering,
  scanProgress,
  hasScannedOnce,
  isConnectingWifi,
  discoveredTvs,
  tvIp,
  setTvIp,
  wifiStatus,
  getSubnetFromIp,
  onScanSmartTvs,
  onSelectDiscoveredTv,
  onClearSavedToken,
  onSaveWifi,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalTitle}>إعدادات الشاشة والاتصال</Text>

            <View style={styles.segmentBox}>
              <TouchableOpacity
                style={[styles.segmentBtn, tvTransport === 'ir' && styles.segmentActive]}
                activeOpacity={0.55}
                onPress={() => setTvTransport('ir')}
              >
                <Text
                  style={[
                    styles.segmentText,
                    tvTransport === 'ir' && styles.segmentTextActive,
                  ]}
                >
                  أشعة IR
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, tvTransport === 'wifi' && styles.segmentActive]}
                activeOpacity={0.55}
                onPress={() => setTvTransport('wifi')}
              >
                <Text
                  style={[
                    styles.segmentText,
                    tvTransport === 'wifi' && styles.segmentTextActive,
                  ]}
                >
                  واي فاي (Wi-Fi)
                </Text>
              </TouchableOpacity>
            </View>

            {tvTransport === 'ir' ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.inputLabel}>اختر ماركة الشاشة (IR 38kHz)</Text>
                <View style={styles.rowGap}>
                  {['samsung', 'lg'].map((key) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.chipBtn, tvBrand === key && styles.chipBtnActive]}
                      activeOpacity={0.55}
                      onPress={() => setTvBrand(key)}
                    >
                      <Text
                        style={[styles.chipText, tvBrand === key && styles.chipTextActive]}
                      >
                        {TV_IR_BRANDS[key].label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity style={styles.doneBtn} activeOpacity={0.55} onPress={onClose}>
                  <Text style={styles.btnTextBold}>تم</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.sectionBlock}>
                <View style={styles.rowGap}>
                  <TouchableOpacity
                    style={[
                      styles.chipBtn,
                      wifiProtocol === 'samsung_tizen' && styles.chipBtnActive,
                    ]}
                    activeOpacity={0.55}
                    onPress={() => {
                      setWifiProtocol('samsung_tizen');
                      setTvPort('8002');
                      setDialPort('8080');
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        wifiProtocol === 'samsung_tizen' && styles.chipTextActive,
                      ]}
                    >
                      Samsung Tizen
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.chipBtn,
                      wifiProtocol === 'android_tv' && styles.chipBtnActive,
                    ]}
                    activeOpacity={0.55}
                    onPress={() => {
                      setWifiProtocol('android_tv');
                      setTvPort('8080');
                      setDialPort('8008');
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        wifiProtocol === 'android_tv' && styles.chipTextActive,
                      ]}
                    >
                      Android TV
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chipBtn, wifiProtocol === 'roku' && styles.chipBtnActive]}
                    activeOpacity={0.55}
                    onPress={() => {
                      setWifiProtocol('roku');
                      setTvPort('8060');
                      setDialPort('8060');
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        wifiProtocol === 'roku' && styles.chipTextActive,
                      ]}
                    >
                      Roku ECP
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modalScanRow}>
                  <View style={styles.portField}>
                    <Text style={styles.inputLabel}>نطاق الشبكة (Subnet)</Text>
                    <TextInput
                      style={styles.input}
                      value={subnetPrefix}
                      onChangeText={setSubnetPrefix}
                      keyboardType="numeric"
                      placeholder="192.168.1"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.modalScanBtn, isDiscovering && styles.scanBtnActive]}
                    activeOpacity={0.55}
                    onPress={() => onScanSmartTvs()}
                  >
                    {isDiscovering ? (
                      <View style={styles.scanBtnInner}>
                        <ActivityIndicator size="small" color={colors.textPrimary} />
                        <Text style={styles.btnTextBold}>إيقاف</Text>
                      </View>
                    ) : (
                      <Text style={styles.btnTextBold}>البحث عن الشاشات</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {isConnectingWifi ? (
                  <View style={styles.statusCard}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.statusText}>
                      جاري الاقتران والاتصال بـ {tvIp}:{tvPort}...
                    </Text>
                  </View>
                ) : null}

                {isDiscovering ? (
                  <Text style={styles.scanProgressText}>
                    جاري فحص الشبكة ({subnetPrefix}.1 - 254)... {scanProgress.scanned}/
                    {scanProgress.total}
                  </Text>
                ) : null}

                {discoveredTvs.length > 0 ? (
                  <View style={styles.modalDiscoveryList}>
                    {discoveredTvs.map((device) => {
                      const isSelected = device.ip === tvIp;
                      return (
                        <TouchableOpacity
                          key={`modal-${device.ip}-${device.protocol}`}
                          style={[
                            styles.discoveredItem,
                            isSelected && styles.discoveredItemActive,
                          ]}
                          activeOpacity={0.55}
                          onPress={() => onSelectDiscoveredTv(device)}
                        >
                          <View style={styles.discoveredMeta}>
                            <Text style={styles.discoveredName}>{device.name}</Text>
                            <Text style={styles.discoveredSub}>
                              {device.modelName} · {device.ip}:{device.port}
                            </Text>
                          </View>
                          <Text style={styles.discoveredConnectTag}>
                            {isSelected && wifiStatus.isConnected ? 'متصل' : 'اتصال'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : !isDiscovering && hasScannedOnce ? (
                  <Text style={styles.emptySearchText}>
                    لم يتم العثور على شاشات على النطاق {subnetPrefix}.x
                  </Text>
                ) : null}

                <View>
                  <Text style={styles.inputLabel}>عنوان IP المحلي للشاشة</Text>
                  <TextInput
                    style={styles.input}
                    value={tvIp}
                    onChangeText={(val) => {
                      setTvIp(val);
                      const detectedSubnet = getSubnetFromIp(val);
                      if (detectedSubnet !== subnetPrefix && val.split('.').length >= 3) {
                        setSubnetPrefix(detectedSubnet);
                      }
                    }}
                    keyboardType="numeric"
                    placeholder="192.168.1.50"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>

                <View style={styles.rowGap}>
                  <View style={styles.portField}>
                    <Text style={styles.inputLabel}>منفذ التحكم (8002 / 8001)</Text>
                    <TextInput
                      style={styles.input}
                      value={tvPort}
                      onChangeText={setTvPort}
                      keyboardType="numeric"
                      placeholder="8002"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                  <View style={styles.portField}>
                    <Text style={styles.inputLabel}>منفذ DIAL Cast</Text>
                    <TextInput
                      style={styles.input}
                      value={dialPort}
                      onChangeText={setDialPort}
                      keyboardType="numeric"
                      placeholder="8080"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                </View>

                {wifiProtocol === 'samsung_tizen' ? (
                  <View style={styles.tokenStatusBox}>
                    <Text style={styles.tokenStatusLabel}>
                      حالة الاقتران:{' '}
                      {wifiStatus.hasSavedToken
                        ? 'Token محفوظ محلياً'
                        : 'سيتم طلب الموافقة عند أول اتصال'}
                    </Text>
                    {wifiStatus.hasSavedToken ? (
                      <TouchableOpacity
                        style={styles.clearTokenBtn}
                        activeOpacity={0.55}
                        onPress={onClearSavedToken}
                      >
                        <Text style={styles.clearTokenText}>مسح التوكن</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.rowGap}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    activeOpacity={0.55}
                    onPress={onClose}
                  >
                    <Text style={styles.btnText}>إلغاء</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalCancelBtn, styles.modalSaveBtn]}
                    activeOpacity={0.55}
                    onPress={onSaveWifi}
                  >
                    <Text style={styles.btnTextBold}>حفظ واتصال</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  modalScroll: {
    width: '100%',
  },
  modalScrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.title,
    fontWeight: '700',
    textAlign: 'right',
  },
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.capsule,
    padding: 3,
    gap: spacing.xs,
  },
  segmentBtn: {
    flex: 1,
    height: 40,
    borderRadius: radii.capsule,
    borderWidth: 1,
    borderColor: colors.transparent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.textPrimary,
  },

  sectionBlock: {
    gap: spacing.md,
  },
  rowGap: { flexDirection: 'row', gap: spacing.sm },
  chipBtn: {
    flex: 1,
    height: 44,
    borderRadius: radii.capsule,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  chipBtnActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  chipTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },

  doneBtn: {
    height: 46,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },

  scanBtnActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  scanBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    padding: spacing.md,
  },
  statusText: {
    color: colors.textPrimary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  scanProgressText: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'right',
  },
  emptySearchText: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'center',
    paddingVertical: spacing.xs,
  },

  discoveredItem: {
    minHeight: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  discoveredItemActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  discoveredMeta: { flex: 1, gap: 2 },
  discoveredName: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '600',
    textAlign: 'right',
  },
  discoveredSub: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'right',
  },
  discoveredConnectTag: {
    color: colors.accent,
    fontSize: fontSizes.label,
    fontWeight: '600',
  },

  btnText: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  btnTextBold: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },

  inputLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'right',
    marginBottom: spacing.xs,
  },
  portField: { flex: 1 },
  input: {
    height: 44,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  modalScanRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  modalScanBtn: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalDiscoveryList: {
    gap: spacing.xs,
  },
  tokenStatusBox: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
  },
  tokenStatusLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    flex: 1,
    textAlign: 'right',
  },
  clearTokenBtn: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  clearTokenText: {
    color: colors.accent,
    fontSize: fontSizes.label,
    fontWeight: '600',
  },
  modalCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSaveBtn: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
});

export default WifiSheet;
