import React from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { TV_IR_BRANDS } from '../ir/encoders';
import { colors, fontSizes, radii, spacing } from '../theme';
import RemoteIcon from './RemoteIcon';
import RepeatableButton from './RepeatableButton';

function TvRemote({
  tvTransport,
  setTvTransport,
  tvBrand,
  setTvBrand,
  wifiProtocol,
  tvIp,
  tvPort,
  wifiStatus,
  isDiscovering,
  discoveredTvs,
  hasScannedOnce,
  onOpenSettings,
  onScanSmartTvs,
  onSelectDiscoveredTv,
  onTvCommand,
  onLaunchYouTube,
  isLaunchingYouTube,
  searchQuery,
  setSearchQuery,
  onSearchYouTube,
  isSearching,
  hasSearchedOnce,
  searchResults,
  castingVideoId,
  onCastVideo,
}) {
  const protocolDisplayLabel =
    wifiProtocol === 'samsung_tizen'
      ? 'Samsung Tizen'
      : wifiProtocol === 'roku'
      ? 'Roku ECP'
      : 'Android TV';

  const renderRemoteControls = () => (
    <>
      {/* [ب] شريط الوضع (IR / Wi-Fi) — كبسولة مزدوجة ارتفاع 38 */}
      <View style={styles.modeCapsule}>
        <TouchableOpacity
          style={[styles.modeBtn, tvTransport === 'ir' && styles.modeBtnActive]}
          activeOpacity={0.55}
          accessibilityLabel="وضع الأشعة تحت الحمراء"
          accessibilityRole="button"
          onPress={() => setTvTransport('ir')}
        >
          <Text style={[styles.modeText, tvTransport === 'ir' && styles.modeTextActive]}>
            IR
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, tvTransport === 'wifi' && styles.modeBtnActive]}
          activeOpacity={0.55}
          accessibilityLabel="وضع الواي فاي"
          accessibilityRole="button"
          onPress={() => setTvTransport('wifi')}
        >
          <Text style={[styles.modeText, tvTransport === 'wifi' && styles.modeTextActive]}>
            Wi-Fi
          </Text>
        </TouchableOpacity>
      </View>

      {/* [ج] صف الماركة أو الجهاز — ارتفاع 36 فقط */}
      {tvTransport === 'ir' ? (
        <View style={styles.brandRow}>
          {['samsung', 'lg'].map((key) => {
            const active = tvBrand === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.brandCapsule, active && styles.brandCapsuleActive]}
                activeOpacity={0.55}
                accessibilityLabel={TV_IR_BRANDS[key].label}
                accessibilityRole="button"
                onPress={() => setTvBrand(key)}
              >
                <Text style={[styles.brandText, active && styles.brandTextActive]}>
                  {key === 'samsung' ? 'Samsung' : 'LG'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <TouchableOpacity
          style={styles.wifiDeviceCapsule}
          activeOpacity={0.55}
          accessibilityLabel="إعدادات الشاشة المتصلة"
          accessibilityRole="button"
          onPress={onOpenSettings}
        >
          <View
            style={[
              styles.wifiDot,
              wifiStatus.isConnected ? styles.wifiDotActive : styles.wifiDotIdle,
            ]}
          />
          <Text style={styles.wifiDeviceText} numberOfLines={1}>
            {tvIp}:{tvPort} · {wifiStatus.deviceName || protocolDisplayLabel}
          </Text>
          <Text style={styles.wifiSettingsLink}>إعداد</Text>
        </TouchableOpacity>
      )}

      {/* [د] الكتلة المركزية: [كبسولة صوت 60×186] [D-Pad 200×200] [كبسولة قناة 60×186] */}
      <View style={styles.centerClusterRow}>
        {/* كبسولة الصوت (يمين في RTL) */}
        <View style={styles.rockerColumn}>
          <Text style={styles.rockerLabel}>صوت</Text>
          <View style={styles.verticalCapsule}>
            <RepeatableButton
              style={styles.capsuleHalfBtn}
              initialDelayMs={260}
              repeatIntervalMs={150}
              activeOpacity={0.55}
              accessibilityLabel="رفع الصوت"
              onAction={() => onTvCommand('VOL_UP')}
            >
              <RemoteIcon name="plus" color={colors.textPrimary} size={18} />
            </RepeatableButton>

            <View style={styles.capsuleCenterIcon} pointerEvents="none">
              <RemoteIcon name="volume" color={colors.textTertiary} size={20} />
            </View>

            <RepeatableButton
              style={styles.capsuleHalfBtn}
              initialDelayMs={260}
              repeatIntervalMs={150}
              activeOpacity={0.55}
              accessibilityLabel="خفض الصوت"
              onAction={() => onTvCommand('VOL_DOWN')}
            >
              <RemoteIcon name="minus" color={colors.textPrimary} size={18} />
            </RepeatableButton>
          </View>
        </View>

        {/* دائرة D-Pad 200×200 */}
        <View style={styles.dpadColumn}>
          <Text style={styles.rockerSpacer}> </Text>
          <View style={styles.dpadCircle}>
            <RepeatableButton
              style={styles.dpadZoneVertical}
              initialDelayMs={260}
              repeatIntervalMs={150}
              activeOpacity={0.55}
              accessibilityLabel="أعلى"
              onAction={() => onTvCommand('UP')}
            >
              <RemoteIcon name="chevron_up" color={colors.textSecondary} size={20} />
            </RepeatableButton>

            <View style={styles.dpadMiddleRow}>
              <RepeatableButton
                style={styles.dpadZoneHorizontal}
                initialDelayMs={260}
                repeatIntervalMs={150}
                activeOpacity={0.55}
                accessibilityLabel="يمين"
                onAction={() => onTvCommand('RIGHT')}
              >
                <RemoteIcon name="chevron_right" color={colors.textSecondary} size={20} />
              </RepeatableButton>

              <TouchableOpacity
                style={styles.okCircle}
                activeOpacity={0.55}
                accessibilityLabel="موافق"
                accessibilityRole="button"
                onPress={() => onTvCommand('OK')}
              >
                <Text style={styles.okText}>OK</Text>
              </TouchableOpacity>

              <RepeatableButton
                style={styles.dpadZoneHorizontal}
                initialDelayMs={260}
                repeatIntervalMs={150}
                activeOpacity={0.55}
                accessibilityLabel="يسار"
                onAction={() => onTvCommand('LEFT')}
              >
                <RemoteIcon name="chevron_left" color={colors.textSecondary} size={20} />
              </RepeatableButton>
            </View>

            <RepeatableButton
              style={styles.dpadZoneVertical}
              initialDelayMs={260}
              repeatIntervalMs={150}
              activeOpacity={0.55}
              accessibilityLabel="أسفل"
              onAction={() => onTvCommand('DOWN')}
            >
              <RemoteIcon name="chevron_down" color={colors.textSecondary} size={20} />
            </RepeatableButton>
          </View>
        </View>

        {/* كبسولة القناة (يسار في RTL) */}
        <View style={styles.rockerColumn}>
          <Text style={styles.rockerLabel}>قناة</Text>
          <View style={styles.verticalCapsule}>
            <RepeatableButton
              style={styles.capsuleHalfBtn}
              initialDelayMs={260}
              repeatIntervalMs={150}
              activeOpacity={0.55}
              accessibilityLabel="قناة أعلى"
              onAction={() => onTvCommand('CH_UP')}
            >
              <RemoteIcon name="chevron_up" color={colors.textPrimary} size={18} />
            </RepeatableButton>

            <View style={styles.capsuleCenterIcon} pointerEvents="none">
              <RemoteIcon name="channel" color={colors.textTertiary} size={20} />
            </View>

            <RepeatableButton
              style={styles.capsuleHalfBtn}
              initialDelayMs={260}
              repeatIntervalMs={150}
              activeOpacity={0.55}
              accessibilityLabel="قناة أسفل"
              onAction={() => onTvCommand('CH_DOWN')}
            >
              <RemoteIcon name="chevron_down" color={colors.textPrimary} size={18} />
            </RepeatableButton>
          </View>
        </View>
      </View>

      {/* [هـ] شريط سفلي واحد — 4 أزرار دائرية 52×52 */}
      <View style={styles.bottomActionsRow}>
        <TouchableOpacity
          style={styles.circleActionBtn}
          activeOpacity={0.55}
          accessibilityLabel="رجوع"
          accessibilityRole="button"
          onPress={() => onTvCommand('BACK')}
        >
          <RemoteIcon name="back" color={colors.textPrimary} size={20} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.circleActionBtn}
          activeOpacity={0.55}
          accessibilityLabel="الرئيسية"
          accessibilityRole="button"
          onPress={() => onTvCommand('HOME')}
        >
          <RemoteIcon name="home" color={colors.textPrimary} size={20} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.circleActionBtn}
          activeOpacity={0.55}
          accessibilityLabel="القائمة"
          accessibilityRole="button"
          onPress={() => onTvCommand('MENU')}
        >
          <RemoteIcon name="menu" color={colors.textPrimary} size={20} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.circleActionBtn}
          activeOpacity={0.55}
          accessibilityLabel="المصدر"
          accessibilityRole="button"
          onPress={() => onTvCommand('INPUT')}
        >
          <RemoteIcon name="input" color={colors.textPrimary} size={20} />
        </TouchableOpacity>
      </View>
    </>
  );

  if (tvTransport === 'ir') {
    return <View style={styles.irRoot}>{renderRemoteControls()}</View>;
  }

  return (
    <ScrollView
      style={styles.wifiScroll}
      contentContainerStyle={styles.wifiScrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.wifiRemoteSection}>{renderRemoteControls()}</View>

      {/* أدوات الواي فاي السريعة (كتم، نتفلكس، بحث عن الشاشات) */}
      <View style={styles.wifiPanel}>
        <View style={styles.wifiQuickRow}>
          <TouchableOpacity
            style={styles.quickRectBtn}
            activeOpacity={0.55}
            accessibilityLabel="كتم الصوت"
            accessibilityRole="button"
            onPress={() => onTvCommand('MUTE')}
          >
            <RemoteIcon name="mute" color={colors.textPrimary} size={18} />
            <Text style={styles.quickRectText}>كتم</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickRectBtn}
            activeOpacity={0.55}
            accessibilityLabel="Netflix"
            accessibilityRole="button"
            onPress={() => onTvCommand('NETFLIX')}
          >
            <Text style={styles.quickRectText}>Netflix</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickRectBtn, isDiscovering && styles.quickRectBtnActive]}
            activeOpacity={0.55}
            accessibilityLabel="البحث عن الشاشات"
            accessibilityRole="button"
            onPress={() => onScanSmartTvs()}
          >
            {isDiscovering ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.quickRectText}>بحث الشاشات</Text>
            )}
          </TouchableOpacity>
        </View>

        {hasScannedOnce && discoveredTvs.length > 0 ? (
          <View style={styles.discoveredList}>
            {discoveredTvs.map((device) => {
              const selected = device.ip === tvIp;
              return (
                <TouchableOpacity
                  key={`${device.ip}-${device.protocol}`}
                  style={[styles.discoveredRow, selected && styles.discoveredRowActive]}
                  activeOpacity={0.55}
                  onPress={() => onSelectDiscoveredTv(device)}
                >
                  <View style={styles.discoveredMeta}>
                    <Text style={styles.discoveredTitle} numberOfLines={1}>
                      {device.name}
                    </Text>
                    <Text style={styles.discoveredSub}>
                      {device.ip}:{device.port}
                    </Text>
                  </View>
                  <Text style={styles.discoveredTag}>
                    {selected && wifiStatus.isConnected ? 'متصل' : 'اتصال'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>

      {/* لوحة البحث والبث على الشاشة (YouTube Cast) */}
      <View style={styles.wifiPanel}>
        <View style={styles.castHeaderRow}>
          <Text style={styles.panelTitle}>البث والبحث (YouTube Cast)</Text>
          <TouchableOpacity
            style={styles.ytLaunchBtn}
            activeOpacity={0.55}
            onPress={onLaunchYouTube}
            disabled={isLaunchingYouTube}
          >
            {isLaunchingYouTube ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.ytLaunchText}>فتح يوتيوب</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="ابحث عن فيديو للبث..."
            placeholderTextColor={colors.textTertiary}
            onSubmitEditing={onSearchYouTube}
          />
          <TouchableOpacity
            style={styles.searchSubmitBtn}
            activeOpacity={0.55}
            onPress={onSearchYouTube}
            disabled={isSearching}
          >
            {isSearching ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.searchSubmitText}>بحث</Text>
            )}
          </TouchableOpacity>
        </View>

        {hasSearchedOnce && searchResults.length === 0 && !isSearching ? (
          <Text style={styles.emptyText}>لا توجد نتائج مطابقة للبحث.</Text>
        ) : null}

        {searchResults.length > 0 ? (
          <View style={styles.resultsList}>
            {searchResults.map((item) => {
              const isCasting = castingVideoId === item.videoId;
              return (
                <TouchableOpacity
                  key={item.videoId}
                  style={[styles.videoRow, isCasting && styles.videoRowActive]}
                  activeOpacity={0.55}
                  disabled={Boolean(castingVideoId)}
                  onPress={() => onCastVideo(item)}
                >
                  <Image
                    source={{ uri: item.thumbnailUrl }}
                    style={styles.videoThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.videoInfo}>
                    <Text style={styles.videoTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.videoMeta} numberOfLines={1}>
                      {item.channelTitle}
                      {item.durationText ? ` · ${item.durationText}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.videoAction}>
                    {isCasting ? 'جاري البث' : 'بث'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  irRoot: {
    flex: 1,
    width: '100%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wifiScroll: {
    flex: 1,
    width: '100%',
  },
  wifiScrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  wifiRemoteSection: {
    width: '100%',
    gap: spacing.lg,
    alignItems: 'center',
  },

  // [ب] شريط الوضع (IR / Wi-Fi)
  modeCapsule: {
    width: '100%',
    height: 38,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.capsule,
    padding: 3,
    gap: spacing.xs,
  },
  modeBtn: {
    flex: 1,
    borderRadius: radii.capsule,
    borderWidth: 1,
    borderColor: colors.transparent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  modeText: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  modeTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },

  // [ج] صف الماركة / الجهاز (ارتفاع 36)
  brandRow: {
    width: '100%',
    height: 36,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  brandCapsule: {
    flex: 1,
    height: 36,
    borderRadius: radii.capsule,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandCapsuleActive: {
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
  wifiDeviceCapsule: {
    width: '100%',
    height: 36,
    borderRadius: radii.capsule,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  wifiDot: {
    width: 6,
    height: 6,
    borderRadius: radii.capsule,
  },
  wifiDotActive: {
    backgroundColor: colors.accent,
  },
  wifiDotIdle: {
    backgroundColor: colors.textTertiary,
  },
  wifiDeviceText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'right',
  },
  wifiSettingsLink: {
    color: colors.accent,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // [د] الكتلة المركزية: صوت 60×186 | D-Pad 200×200 | قناة 60×186
  centerClusterRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  rockerColumn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  dpadColumn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  rockerLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.micro,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  rockerSpacer: {
    fontSize: fontSizes.micro,
  },
  verticalCapsule: {
    width: 60,
    height: 186,
    borderRadius: 30,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  capsuleHalfBtn: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  capsuleCenterIcon: {
    height: 24,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },

  dpadCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  dpadZoneVertical: {
    width: 88,
    height: 62,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadMiddleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpadZoneHorizontal: {
    width: 62,
    height: 88,
    justifyContent: 'center',
    alignItems: 'center',
  },
  okCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  okText: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '800',
  },

  // [هـ] الشريط السفلي: 4 أزرار دائرية 52×52
  bottomActionsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
  },
  circleActionBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // لوحات Wi-Fi والبحث والبث
  wifiPanel: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    padding: spacing.md,
    gap: spacing.md,
  },
  wifiQuickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickRectBtn: {
    flex: 1,
    height: 44,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickRectBtnActive: {
    backgroundColor: colors.accentSegment,
    borderColor: colors.accent,
  },
  quickRectText: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  discoveredList: {
    gap: spacing.sm,
  },
  discoveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  discoveredRowActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  discoveredMeta: {
    flex: 1,
    gap: 2,
  },
  discoveredTitle: {
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
  discoveredTag: {
    color: colors.accent,
    fontSize: fontSizes.label,
    fontWeight: '600',
  },
  castHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  ytLaunchBtn: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ytLaunchText: {
    color: colors.textPrimary,
    fontSize: fontSizes.label,
    fontWeight: '600',
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    textAlign: 'right',
  },
  searchSubmitBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchSubmitText: {
    color: colors.textPrimary,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  resultsList: {
    gap: spacing.sm,
  },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    padding: spacing.sm,
  },
  videoRowActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  videoThumb: {
    width: 72,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  videoInfo: {
    flex: 1,
    gap: 2,
  },
  videoTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.label,
    fontWeight: '600',
    textAlign: 'right',
  },
  videoMeta: {
    color: colors.textSecondary,
    fontSize: fontSizes.micro,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'right',
  },
  videoAction: {
    color: colors.accent,
    fontSize: fontSizes.label,
    fontWeight: '600',
  },
});

export default TvRemote;
