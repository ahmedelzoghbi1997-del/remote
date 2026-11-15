import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

/**
 * أيقونات هندسية دقيقة بإحداثيات مطلقة (direction-independent)
 * تضمن ثبات الرسم وعدم انقلابه في واجهة RTL على أندرويد والويب معاً
 */
function RemoteIcon({ name, color = colors.textPrimary, size = 22 }) {
  const s = size;
  const sw = Math.max(1.9, Math.round(s * 0.095 * 10) / 10);

  if (name === 'power') {
    const ring = Math.round(s * 0.78);
    const stemH = Math.round(s * 0.42);
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: sw,
            borderColor: color,
            borderTopColor: colors.transparent,
            left: (s - ring) / 2,
            bottom: Math.round(s * 0.08),
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: sw,
            height: stemH,
            borderRadius: sw,
            backgroundColor: color,
            left: (s - sw) / 2,
            top: Math.round(s * 0.06),
          }}
        />
      </View>
    );
  }

  if (name === 'volume') {
    const boxW = s * 0.16;
    const boxH = s * 0.28;
    const coneW = s * 0.24;
    const coneH = s * 0.27;
    const arc1 = s * 0.34;
    const arc2 = s * 0.54;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            left: s * 0.1,
            top: (s - boxH) / 2,
            width: boxW,
            height: boxH,
            backgroundColor: color,
            borderTopLeftRadius: 2,
            borderBottomLeftRadius: 2,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.2,
            top: (s - coneH * 2) / 2,
            width: 0,
            height: 0,
            borderTopWidth: coneH,
            borderBottomWidth: coneH,
            borderRightWidth: coneW,
            borderTopColor: colors.transparent,
            borderBottomColor: colors.transparent,
            borderRightColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.43,
            top: (s - arc1) / 2,
            width: arc1 * 0.46,
            height: arc1,
            borderRightWidth: sw,
            borderRightColor: color,
            borderTopRightRadius: arc1,
            borderBottomRightRadius: arc1,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.56,
            top: (s - arc2) / 2,
            width: arc2 * 0.44,
            height: arc2,
            borderRightWidth: sw,
            borderRightColor: color,
            borderTopRightRadius: arc2,
            borderBottomRightRadius: arc2,
          }}
        />
      </View>
    );
  }

  if (name === 'mute') {
    const boxW = s * 0.15;
    const boxH = s * 0.27;
    const coneW = s * 0.23;
    const coneH = s * 0.26;
    const xLen = s * 0.34;
    const xCenterLeft = s * 0.72;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            left: s * 0.08,
            top: (s - boxH) / 2,
            width: boxW,
            height: boxH,
            backgroundColor: color,
            borderTopLeftRadius: 2,
            borderBottomLeftRadius: 2,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.18,
            top: (s - coneH * 2) / 2,
            width: 0,
            height: 0,
            borderTopWidth: coneH,
            borderBottomWidth: coneH,
            borderRightWidth: coneW,
            borderTopColor: colors.transparent,
            borderBottomColor: colors.transparent,
            borderRightColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: xCenterLeft - xLen / 2,
            top: (s - sw) / 2,
            width: xLen,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: xCenterLeft - xLen / 2,
            top: (s - sw) / 2,
            width: xLen,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
            transform: [{ rotate: '-45deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'back') {
    const loopW = s * 0.56;
    const loopH = s * 0.42;
    const head = s * 0.24;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        {/* مسار رجوع منحنٍ أنيق */}
        <View
          style={{
            position: 'absolute',
            left: s * 0.22,
            top: s * 0.34,
            width: loopW,
            height: loopH,
            borderTopWidth: sw,
            borderRightWidth: sw,
            borderBottomWidth: sw,
            borderColor: color,
            borderTopRightRadius: loopH / 2,
            borderBottomRightRadius: loopH / 2,
          }}
        />
        {/* سهم البداية */}
        <View
          style={{
            position: 'absolute',
            left: s * 0.21,
            top: s * 0.34 - head / 2 + sw / 2,
            width: head,
            height: head,
            borderLeftWidth: sw,
            borderBottomWidth: sw,
            borderColor: color,
            borderBottomLeftRadius: 1,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'home') {
    const roofSize = s * 0.5;
    const bodyW = s * 0.56;
    const bodyH = s * 0.4;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            top: s * 0.2,
            left: (s - roofSize) / 2,
            width: roofSize,
            height: roofSize,
            borderTopWidth: sw,
            borderLeftWidth: sw,
            borderColor: color,
            borderTopLeftRadius: 2,
            transform: [{ rotate: '45deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: s * 0.14,
            left: (s - bodyW) / 2,
            width: bodyW,
            height: bodyH,
            borderLeftWidth: sw,
            borderRightWidth: sw,
            borderBottomWidth: sw,
            borderColor: color,
            borderBottomLeftRadius: 3,
            borderBottomRightRadius: 3,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: s * 0.14,
            left: (s - s * 0.18) / 2,
            width: s * 0.18,
            height: s * 0.22,
            borderTopWidth: sw * 0.85,
            borderLeftWidth: sw * 0.85,
            borderRightWidth: sw * 0.85,
            borderColor: color,
            borderTopLeftRadius: 3,
            borderTopRightRadius: 3,
          }}
        />
      </View>
    );
  }

  if (name === 'menu') {
    const bar1 = s * 0.68;
    const bar2 = s * 0.48;
    const bar3 = s * 0.6;
    const rightEdge = s * 0.84;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            top: s * 0.26,
            left: rightEdge - bar1,
            width: bar1,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: (s - sw) / 2,
            left: rightEdge - bar2,
            width: bar2,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: s * 0.26,
            left: rightEdge - bar3,
            width: bar3,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'channel' || name === 'tv') {
    const frameW = s * 0.84;
    const frameH = s * 0.56;
    const standW = s * 0.36;
    const dotSize = Math.max(3, Math.round(s * 0.14));
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            top: s * 0.16,
            left: (s - frameW) / 2,
            width: frameW,
            height: frameH,
            borderRadius: 4,
            borderWidth: sw,
            borderColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: s * 0.16 + (frameH - dotSize) / 2,
            left: (s - dotSize) / 2,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            opacity: 0.65,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: s * 0.14,
            left: (s - standW) / 2,
            width: standW,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'input') {
    const portW = s * 0.52;
    const portH = s * 0.66;
    const arrowLen = s * 0.44;
    const head = s * 0.22;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            right: s * 0.12,
            top: (s - portH) / 2,
            width: portW,
            height: portH,
            borderTopWidth: sw,
            borderRightWidth: sw,
            borderBottomWidth: sw,
            borderColor: color,
            borderTopRightRadius: 4,
            borderBottomRightRadius: 4,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.12,
            top: (s - sw) / 2,
            width: arrowLen,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.12 + arrowLen - head * 0.72,
            top: (s - head) / 2,
            width: head,
            height: head,
            borderTopWidth: sw,
            borderRightWidth: sw,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'ac') {
    const arm = s * 0.76;
    const hub = Math.max(4, Math.round(s * 0.22));
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        {[0, 60, -60].map((deg) => (
          <View
            key={deg}
            style={{
              position: 'absolute',
              left: (s - arm) / 2,
              top: (s - sw) / 2,
              width: arm,
              height: sw,
              borderRadius: sw,
              backgroundColor: color,
              transform: [{ rotate: `${deg}deg` }],
            }}
          />
        ))}
        <View
          style={{
            position: 'absolute',
            left: (s - hub) / 2,
            top: (s - hub) / 2,
            width: hub,
            height: hub,
            borderRadius: hub / 2,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'sliders') {
    const trackW = s * 0.72;
    const knob = Math.max(4.5, Math.round(s * 0.22));
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            top: s * 0.32,
            left: (s - trackW) / 2,
            width: trackW,
            height: sw * 0.85,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: s * 0.32 - knob / 2 + sw * 0.4,
            left: s * 0.56,
            width: knob,
            height: knob,
            borderRadius: knob / 2,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: s * 0.32,
            left: (s - trackW) / 2,
            width: trackW,
            height: sw * 0.85,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: s * 0.32 - knob / 2 + sw * 0.4,
            left: s * 0.24,
            width: knob,
            height: knob,
            borderRadius: knob / 2,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'plus') {
    const bar = s * 0.6;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            left: (s - bar) / 2,
            top: (s - sw) / 2,
            width: bar,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: (s - sw) / 2,
            top: (s - bar) / 2,
            width: sw,
            height: bar,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'minus') {
    const bar = s * 0.6;
    return (
      <View style={[styles.box, { width: s, height: s }]}>
        <View
          style={{
            position: 'absolute',
            left: (s - bar) / 2,
            top: (s - sw) / 2,
            width: bar,
            height: sw,
            borderRadius: sw,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  const armSize = Math.round(s * 0.44);
  const rotationMap = {
    chevron_up: '-45deg',
    chevron_right: '45deg',
    chevron_down: '135deg',
    chevron_left: '-135deg',
  };
  const offsetMap = {
    chevron_up: { top: (s - armSize) / 2 + s * 0.08, left: (s - armSize) / 2 },
    chevron_down: { top: (s - armSize) / 2 - s * 0.08, left: (s - armSize) / 2 },
    chevron_right: { top: (s - armSize) / 2, left: (s - armSize) / 2 - s * 0.08 },
    chevron_left: { top: (s - armSize) / 2, left: (s - armSize) / 2 + s * 0.08 },
  };
  const rotation = rotationMap[name] || '0deg';
  const offset = offsetMap[name] || { top: (s - armSize) / 2, left: (s - armSize) / 2 };

  return (
    <View style={[styles.box, { width: s, height: s }]}>
      <View
        style={{
          position: 'absolute',
          top: offset.top,
          left: offset.left,
          width: armSize,
          height: armSize,
          borderTopWidth: sw * 1.05,
          borderRightWidth: sw * 1.05,
          borderColor: color,
          borderTopRightRadius: 2,
          transform: [{ rotate: rotation }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'relative',
  },
});

export default RemoteIcon;
