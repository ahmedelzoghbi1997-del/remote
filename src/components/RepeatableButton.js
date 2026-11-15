import React, { useEffect, useRef } from 'react';
import { TouchableOpacity } from 'react-native';

function RepeatableButton({
  onAction,
  repeatIntervalMs = 150,
  initialDelayMs = 260,
  style,
  activeOpacity = 0.55,
  hitSlop,
  accessibilityLabel,
  accessibilityRole = 'button',
  children,
}) {
  const holdTimerRef = useRef(null);
  const repeatTimerRef = useRef(null);
  const latestActionRef = useRef(onAction);

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

  const handlePressIn = () => {
    clearTimers();
    if (latestActionRef.current) {
      latestActionRef.current();
    }
    holdTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = setInterval(() => {
        if (latestActionRef.current) {
          latestActionRef.current();
        }
      }, repeatIntervalMs);
    }, initialDelayMs);
  };

  return (
    <TouchableOpacity
      style={style}
      activeOpacity={activeOpacity}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      onPressIn={handlePressIn}
      onPressOut={clearTimers}
    >
      {children}
    </TouchableOpacity>
  );
}

export default RepeatableButton;
