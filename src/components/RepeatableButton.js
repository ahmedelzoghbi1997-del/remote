import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, Vibration } from 'react-native';

function triggerHaptic(durationMs = 10) {
  if (Platform.OS === 'web') return;
  try {
    Vibration.vibrate(durationMs);
  } catch (_) {
    // ignore if vibration permission is unavailable
  }
}

function RepeatableButton({
  onAction,
  repeatIntervalMs = 130,
  initialDelayMs = 220,
  style,
  pressedScale = 0.92,
  hapticMs = 10,
  hitSlop,
  accessibilityLabel,
  children,
}) {
  const holdTimerRef = useRef(null);
  const repeatTimerRef = useRef(null);
  const latestActionRef = useRef(onAction);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  latestActionRef.current = onAction;

  const clearTimers = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const animateTo = (toValue) => {
    Animated.spring(scaleAnim, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  };

  const handlePressIn = () => {
    clearTimers();
    animateTo(pressedScale);
    if (hapticMs > 0) {
      triggerHaptic(hapticMs);
    }
    if (latestActionRef.current) {
      latestActionRef.current();
    }
    if (repeatIntervalMs > 0) {
      holdTimerRef.current = setTimeout(() => {
        repeatTimerRef.current = setInterval(() => {
          if (hapticMs > 0) {
            triggerHaptic(Math.max(6, Math.round(hapticMs * 0.7)));
          }
          if (latestActionRef.current) {
            latestActionRef.current();
          }
        }, repeatIntervalMs);
      }, initialDelayMs);
    }
  };

  const handlePressOut = () => {
    clearTimers();
    animateTo(1);
  };

  return (
    <Pressable
      style={({ pressed }) => [style, pressed && { opacity: 0.86 }]}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export default RepeatableButton;
