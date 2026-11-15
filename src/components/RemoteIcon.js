import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

function RemoteIcon({ name, color = colors.textPrimary, size = 20 }) {
  if (name === 'power') {
    const ringSize = Math.round(size * 0.84);
    const stemH = Math.round(size * 0.42);
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: 2,
            borderColor: color,
            borderTopColor: colors.transparent,
            position: 'absolute',
            bottom: 1,
          }}
        />
        <View
          style={{
            width: 2,
            height: stemH,
            borderRadius: 1,
            backgroundColor: color,
            position: 'absolute',
            top: 1,
          }}
        />
      </View>
    );
  }

  if (name === 'mute') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={iconStyles.row}>
          <View
            style={{
              width: 5,
              height: 8,
              backgroundColor: color,
              borderTopLeftRadius: 1.5,
              borderBottomLeftRadius: 1.5,
            }}
          />
          <View
            style={{
              width: 0,
              height: 0,
              borderTopWidth: 7,
              borderBottomWidth: 7,
              borderRightWidth: 6,
              borderTopColor: colors.transparent,
              borderBottomColor: colors.transparent,
              borderRightColor: color,
              marginLeft: -1,
            }}
          />
        </View>
        <View
          style={{
            position: 'absolute',
            width: size * 0.88,
            height: 2,
            borderRadius: 1,
            backgroundColor: color,
            transform: [{ rotate: '-42deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'volume') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={iconStyles.row}>
          <View
            style={{
              width: 4,
              height: 7,
              backgroundColor: color,
              borderTopLeftRadius: 1.5,
              borderBottomLeftRadius: 1.5,
            }}
          />
          <View
            style={{
              width: 0,
              height: 0,
              borderTopWidth: 6,
              borderBottomWidth: 6,
              borderRightWidth: 5,
              borderTopColor: colors.transparent,
              borderBottomColor: colors.transparent,
              borderRightColor: color,
              marginLeft: -1,
            }}
          />
          <View
            style={{
              width: 4,
              height: 9,
              borderRightWidth: 1.8,
              borderTopRightRadius: 5,
              borderBottomRightRadius: 5,
              borderColor: color,
              marginLeft: 2,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'channel') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.84,
            height: size * 0.58,
            borderRadius: 3.5,
            borderWidth: 1.8,
            borderColor: color,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: color,
            }}
          />
        </View>
        <View
          style={{
            width: size * 0.36,
            height: 1.8,
            backgroundColor: color,
            borderRadius: 1,
            marginTop: 2,
          }}
        />
      </View>
    );
  }

  if (name === 'input') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.84,
            height: size * 0.62,
            borderRadius: 3.5,
            borderWidth: 2,
            borderColor: color,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderTopWidth: 2,
              borderRightWidth: 2,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              marginLeft: -2,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'home') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View
          style={{
            width: 10,
            height: 10,
            borderTopWidth: 2,
            borderLeftWidth: 2,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
            marginBottom: -4,
          }}
        />
        <View
          style={{
            width: 12,
            height: 9,
            borderLeftWidth: 2,
            borderRightWidth: 2,
            borderBottomWidth: 2,
            borderBottomLeftRadius: 2,
            borderBottomRightRadius: 2,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              width: 4,
              height: 4,
              backgroundColor: color,
              borderTopLeftRadius: 1,
              borderTopRightRadius: 1,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'back') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={iconStyles.row}>
          <View
            style={{
              width: 7,
              height: 7,
              borderBottomWidth: 2,
              borderLeftWidth: 2,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              marginRight: -4,
            }}
          />
          <View
            style={{
              width: 11,
              height: 2,
              backgroundColor: color,
              borderRadius: 1,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'menu') {
    return (
      <View style={[iconStyles.box, { width: size, height: size, gap: 4 }]}>
        <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />
        <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />
        <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />
      </View>
    );
  }

  if (name === 'plus') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={{ width: 13, height: 2, borderRadius: 1, backgroundColor: color }} />
        <View
          style={{
            position: 'absolute',
            width: 2,
            height: 13,
            borderRadius: 1,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'minus') {
    return (
      <View style={[iconStyles.box, { width: size, height: size }]}>
        <View style={{ width: 13, height: 2, borderRadius: 1, backgroundColor: color }} />
      </View>
    );
  }

  const rotationMap = {
    chevron_up: '-45deg',
    chevron_right: '45deg',
    chevron_down: '135deg',
    chevron_left: '-135deg',
  };
  const rotation = rotationMap[name] || '0deg';
  const armSize = Math.round(size * 0.44);

  return (
    <View style={[iconStyles.box, { width: size, height: size }]}>
      <View
        style={{
          width: armSize,
          height: armSize,
          borderTopWidth: 2,
          borderRightWidth: 2,
          borderColor: color,
          borderTopRightRadius: 1,
          transform: [{ rotate: rotation }],
        }}
      />
    </View>
  );
}

const iconStyles = StyleSheet.create({
  box: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default RemoteIcon;
