import React, { useEffect, useRef, useState } from 'react';

type AnyStyle = Record<string, any> | AnyStyle[] | null | undefined | false;

const UNITLESS_PROPS = new Set([
  'flexGrow',
  'flexShrink',
  'opacity',
  'zIndex',
  'fontWeight',
  'lineHeight',
  'aspectRatio',
]);

function flattenStyle(styleInput: AnyStyle): Record<string, any> {
  if (!styleInput) return {};
  if (Array.isArray(styleInput)) {
    return styleInput.reduce<Record<string, any>>((acc, item) => {
      return { ...acc, ...flattenStyle(item) };
    }, {});
  }
  return styleInput;
}

function px(val: any): any {
  return typeof val === 'number' ? `${val}px` : val;
}

function resolveAnimatedValue(val: any): any {
  if (val && typeof val === 'object' && '__isAnimatedValue' in val) {
    return val.__getValue();
  }
  return val;
}

function toCssStyle(styleInput: AnyStyle, baseStyle?: React.CSSProperties): React.CSSProperties {
  const flat = flattenStyle(styleInput);
  const out: Record<string, any> = { ...(baseStyle || {}) };
  let hasBorderWidth = false;

  for (const [key, originalVal] of Object.entries(flat)) {
    const rawVal = resolveAnimatedValue(originalVal);
    if (rawVal === undefined || rawVal === null) continue;

    if (
      key === 'shadowColor' ||
      key === 'shadowOffset' ||
      key === 'shadowOpacity' ||
      key === 'shadowRadius' ||
      key === 'elevation'
    ) {
      if (key === 'elevation' && typeof rawVal === 'number' && rawVal > 0 && !out.boxShadow) {
        const blur = Math.min(24, rawVal * 3);
        const y = Math.min(10, Math.max(2, Math.round(rawVal * 0.8)));
        out.boxShadow = `0 ${y}px ${blur}px rgba(0, 0, 0, 0.42)`;
      }
      continue;
    }

    if (key === 'flex') {
      if (typeof rawVal === 'number') {
        if (rawVal > 0) {
          out.flexGrow = rawVal;
          out.flexShrink = 1;
          out.flexBasis = '0%';
        } else {
          out.flexGrow = 0;
          out.flexShrink = 0;
          out.flexBasis = 'auto';
        }
      } else {
        out.flex = rawVal;
      }
      continue;
    }

    if (key === 'paddingHorizontal') {
      const v = px(rawVal);
      out.paddingLeft = v;
      out.paddingRight = v;
      continue;
    }
    if (key === 'paddingVertical') {
      const v = px(rawVal);
      out.paddingTop = v;
      out.paddingBottom = v;
      continue;
    }
    if (key === 'marginHorizontal') {
      const v = px(rawVal);
      out.marginLeft = v;
      out.marginRight = v;
      continue;
    }
    if (key === 'marginVertical') {
      const v = px(rawVal);
      out.marginTop = v;
      out.marginBottom = v;
      continue;
    }
    if (key === 'borderWidth') {
      const v = px(rawVal);
      out.borderTopWidth = v;
      out.borderRightWidth = v;
      out.borderBottomWidth = v;
      out.borderLeftWidth = v;
      hasBorderWidth = true;
      continue;
    }
    if (key === 'borderColor') {
      out.borderTopColor = rawVal;
      out.borderRightColor = rawVal;
      out.borderBottomColor = rawVal;
      out.borderLeftColor = rawVal;
      continue;
    }
    if (key === 'transform' && Array.isArray(rawVal)) {
      out.transform = rawVal
        .map((t) => {
          if (typeof t === 'string') return t;
          const [fn, rawArg] = Object.entries(t)[0] || [];
          if (!fn) return '';
          const arg = resolveAnimatedValue(rawArg);
          if (typeof arg === 'number' && fn !== 'scale' && fn !== 'scaleX' && fn !== 'scaleY') {
            return `${fn}(${arg}px)`;
          }
          return `${fn}(${arg})`;
        })
        .filter(Boolean)
        .join(' ');
      continue;
    }
    if (key === 'fontVariant' && Array.isArray(rawVal)) {
      out.fontVariantNumeric = rawVal.join(' ');
      continue;
    }
    if (
      key === 'borderTopWidth' ||
      key === 'borderBottomWidth' ||
      key === 'borderLeftWidth' ||
      key === 'borderRightWidth'
    ) {
      hasBorderWidth = true;
    }

    if (typeof rawVal === 'number' && !UNITLESS_PROPS.has(key)) {
      out[key] = `${rawVal}px`;
    } else {
      out[key] = rawVal;
    }
  }

  if (hasBorderWidth && !out.borderStyle) {
    out.borderStyle = 'solid';
  }

  return out as React.CSSProperties;
}

export const Platform = {
  OS: 'web' as const,
  Version: 1,
  select<T>(specifics: { web?: T; default?: T; android?: T; ios?: T }): T | undefined {
    return specifics.web !== undefined ? specifics.web : specifics.default;
  },
};

export const NativeModules: Record<string, any> = {};

export const I18nManager = {
  isRTL: true,
  allowRTL: () => {},
  forceRTL: () => {},
};

export const Vibration = {
  vibrate: (pattern?: number | number[]) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern || 10);
      }
    } catch (_) {
      // ignore on unsupported browsers
    }
  },
  cancel: () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(0);
      }
    } catch (_) {
      // ignore
    }
  },
};

class AnimatedValue {
  private _value: number;
  private _listeners: Set<(v: number) => void> = new Set();
  readonly __isAnimatedValue = true;

  constructor(initial: number) {
    this._value = initial;
  }

  __getValue(): number {
    return this._value;
  }

  setValue(next: number) {
    this._value = next;
    this._listeners.forEach((cb) => cb(next));
  }

  __subscribe(cb: (v: number) => void) {
    this._listeners.add(cb);
    return () => {
      this._listeners.delete(cb);
    };
  }

  interpolate(config: { inputRange: number[]; outputRange: (number | string)[] }) {
    const self = this;
    return {
      __isAnimatedValue: true,
      __getValue: () => {
        const val = self._value;
        const { inputRange, outputRange } = config;
        if (!inputRange.length) return outputRange[0];
        if (val <= inputRange[0]) return outputRange[0];
        if (val >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1];
        for (let i = 0; i < inputRange.length - 1; i++) {
          if (val >= inputRange[i] && val <= inputRange[i + 1]) {
            const ratio = (val - inputRange[i]) / (inputRange[i + 1] - inputRange[i] || 1);
            const a = outputRange[i];
            const b = outputRange[i + 1];
            if (typeof a === 'number' && typeof b === 'number') {
              return a + (b - a) * ratio;
            }
            return ratio < 0.5 ? a : b;
          }
        }
        return outputRange[0];
      },
      __subscribe: (cb: (v: number) => void) => self.__subscribe(cb),
    };
  }
}

function collectAnimatedDeps(styleInput: AnyStyle): any[] {
  const flat = flattenStyle(styleInput);
  const deps: any[] = [];
  for (const val of Object.values(flat)) {
    if (val && typeof val === 'object' && '__subscribe' in val) {
      deps.push(val);
    } else if (Array.isArray(val)) {
      val.forEach((item) => {
        if (item && typeof item === 'object') {
          Object.values(item).forEach((inner) => {
            if (inner && typeof inner === 'object' && '__subscribe' in inner) {
              deps.push(inner);
            }
          });
        }
      });
    }
  }
  return deps;
}

const AnimatedView: React.FC<any> = ({ style, pointerEvents, children, ...rest }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const deps = collectAnimatedDeps(style);
    if (deps.length === 0) return;
    const unsubs = deps.map((dep) => dep.__subscribe(() => setTick((t) => t + 1)));
    return () => unsubs.forEach((u) => u());
  }, [style]);

  const css = toCssStyle(style, {
    ...FLEX_BOX_BASE,
    transition: 'transform 130ms cubic-bezier(0.16, 1, 0.3, 1), opacity 130ms ease',
  });
  if (pointerEvents) {
    css.pointerEvents = pointerEvents;
  }
  return (
    <div style={css} {...rest}>
      {children}
    </div>
  );
};

export const Animated = {
  Value: AnimatedValue,
  View: AnimatedView,
  timing(value: AnimatedValue, config: { toValue: number; duration?: number }) {
    return {
      start(cb?: (res: { finished: boolean }) => void) {
        value.setValue(config.toValue);
        if (cb) cb({ finished: true });
      },
      stop() {},
    };
  },
  spring(value: AnimatedValue, config: { toValue: number }) {
    return {
      start(cb?: (res: { finished: boolean }) => void) {
        value.setValue(config.toValue);
        if (cb) cb({ finished: true });
      },
      stop() {},
    };
  },
  parallel(anims: any[]) {
    return {
      start(cb?: (res: { finished: boolean }) => void) {
        anims.forEach((a) => a && a.start && a.start());
        if (cb) cb({ finished: true });
      },
      stop() {},
    };
  },
  sequence(anims: any[]) {
    return {
      start(cb?: (res: { finished: boolean }) => void) {
        anims.forEach((a) => a && a.start && a.start());
        if (cb) cb({ finished: true });
      },
      stop() {},
    };
  },
};

export const StyleSheet = {
  create<T extends Record<string, Record<string, any>>>(styles: T): T {
    return styles;
  },
  flatten: flattenStyle,
};

export const StatusBar: React.FC<{
  barStyle?: string;
  backgroundColor?: string;
}> = () => null;

const FLEX_BOX_BASE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  boxSizing: 'border-box',
  position: 'relative',
  flexShrink: 0,
  minWidth: 0,
  minHeight: 0,
};

export const View: React.FC<any> = ({ style, pointerEvents, children, ...rest }) => {
  const css = toCssStyle(style, FLEX_BOX_BASE);
  if (pointerEvents) {
    css.pointerEvents = pointerEvents;
  }
  return (
    <div style={css} {...rest}>
      {children}
    </div>
  );
};

export const SafeAreaView: React.FC<any> = ({ style, children, ...rest }) => {
  return (
    <div
      dir="rtl"
      style={toCssStyle(style, {
        ...FLEX_BOX_BASE,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      })}
      {...rest}
    >
      {children}
    </div>
  );
};

export const Text: React.FC<any> = ({ style, numberOfLines, children, ...rest }) => {
  const clampStyle: React.CSSProperties =
    numberOfLines === 1
      ? {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }
      : numberOfLines && numberOfLines > 1
      ? {
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: numberOfLines,
          WebkitBoxOrient: 'vertical',
        }
      : {};

  return (
    <span
      style={toCssStyle(style, {
        boxSizing: 'border-box',
        margin: 0,
        padding: 0,
        display: 'block',
        flexShrink: 0,
        ...clampStyle,
      })}
      {...rest}
    >
      {children}
    </span>
  );
};

export const Pressable: React.FC<any> = ({
  style,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  accessibilityLabel,
  children,
}) => {
  const [pressed, setPressed] = useState(false);
  const pointerDownFiredRef = useRef(false);

  const resolvedStyle =
    typeof style === 'function' ? style({ pressed: pressed && !disabled }) : style;

  const css = toCssStyle(resolvedStyle, {
    ...FLEX_BOX_BASE,
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'opacity 120ms ease, transform 120ms cubic-bezier(0.16, 1, 0.3, 1), background-color 120ms ease',
  });

  const resolvedChildren =
    typeof children === 'function' ? children({ pressed: pressed && !disabled }) : children;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={accessibilityLabel}
      aria-disabled={Boolean(disabled)}
      style={css}
      onClick={(e) => {
        if (disabled) return;
        if (onPress) onPress(e);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onPress) onPress(e);
        }
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        pointerDownFiredRef.current = true;
        setPressed(true);
        if (onPressIn) onPressIn(e);
      }}
      onPointerUp={(e) => {
        if (pointerDownFiredRef.current) {
          pointerDownFiredRef.current = false;
          setPressed(false);
          if (onPressOut) onPressOut(e);
        }
      }}
      onPointerLeave={(e) => {
        if (pointerDownFiredRef.current) {
          pointerDownFiredRef.current = false;
          setPressed(false);
          if (onPressOut) onPressOut(e);
        }
      }}
      onPointerCancel={(e) => {
        if (pointerDownFiredRef.current) {
          pointerDownFiredRef.current = false;
          setPressed(false);
          if (onPressOut) onPressOut(e);
        }
      }}
    >
      {resolvedChildren}
    </div>
  );
};

export const TouchableOpacity: React.FC<any> = ({
  style,
  activeOpacity = 0.7,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  accessibilityLabel,
  children,
}) => {
  const [pressed, setPressed] = useState(false);

  const css = toCssStyle(style, {
    ...FLEX_BOX_BASE,
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'opacity 120ms ease, transform 120ms ease',
  });

  if (pressed && !disabled) {
    css.opacity = typeof css.opacity === 'number' ? css.opacity * activeOpacity : activeOpacity;
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={accessibilityLabel}
      aria-disabled={Boolean(disabled)}
      style={css}
      onClick={(e) => {
        if (disabled) return;
        if (onPress) onPress(e);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onPress) onPress(e);
        }
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        setPressed(true);
        if (onPressIn) onPressIn(e);
      }}
      onPointerUp={(e) => {
        setPressed(false);
        if (onPressOut) onPressOut(e);
      }}
      onPointerLeave={(e) => {
        if (pressed) {
          setPressed(false);
          if (onPressOut) onPressOut(e);
        }
      }}
      onPointerCancel={(e) => {
        setPressed(false);
        if (onPressOut) onPressOut(e);
      }}
    >
      {children}
    </div>
  );
};

export const ScrollView: React.FC<any> = ({
  style,
  contentContainerStyle,
  children,
}) => {
  return (
    <div
      style={toCssStyle(style, {
        ...FLEX_BOX_BASE,
        overflowY: 'auto',
        overflowX: 'hidden',
      })}
    >
      <div
        style={toCssStyle(contentContainerStyle, {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          boxSizing: 'border-box',
          width: '100%',
          flexShrink: 0,
        })}
      >
        {children}
      </div>
    </div>
  );
};

export const FlatList: React.FC<any> = ({
  data = [],
  renderItem,
  keyExtractor,
  ListHeaderComponent,
  ListEmptyComponent,
  ItemSeparatorComponent,
  style,
  contentContainerStyle,
  scrollEnabled = true,
}) => {
  const headerNode =
    typeof ListHeaderComponent === 'function' ? <ListHeaderComponent /> : ListHeaderComponent;
  const emptyNode =
    typeof ListEmptyComponent === 'function' ? <ListEmptyComponent /> : ListEmptyComponent;

  return (
    <div
      style={toCssStyle(style, {
        ...FLEX_BOX_BASE,
        overflowY: scrollEnabled ? 'auto' : 'visible',
        overflowX: 'hidden',
      })}
    >
      <div
        style={toCssStyle(contentContainerStyle, {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          boxSizing: 'border-box',
          width: '100%',
          flexShrink: 0,
        })}
      >
        {headerNode || null}
        {Array.isArray(data) && data.length > 0
          ? data.map((item, index) => {
              const key = keyExtractor ? keyExtractor(item, index) : String(index);
              return (
                <React.Fragment key={key}>
                  {renderItem ? renderItem({ item, index }) : null}
                  {ItemSeparatorComponent && index < data.length - 1 ? (
                    <ItemSeparatorComponent />
                  ) : null}
                </React.Fragment>
              );
            })
          : emptyNode || null}
      </div>
    </div>
  );
};

export const TextInput: React.FC<any> = ({
  style,
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  keyboardType,
  onSubmitEditing,
}) => {
  const css = toCssStyle(style, {
    boxSizing: 'border-box',
    outline: 'none',
    border: 'none',
    width: '100%',
    flexShrink: 0,
    backgroundColor: 'transparent',
  });

  return (
    <input
      type="text"
      inputMode={keyboardType === 'numeric' ? 'decimal' : 'text'}
      value={value || ''}
      placeholder={placeholder}
      style={{
        ...css,
        ...(placeholderTextColor ? ({ '--placeholder-color': placeholderTextColor } as any) : {}),
      }}
      onChange={(e) => onChangeText && onChangeText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onSubmitEditing) {
          onSubmitEditing();
        }
      }}
    />
  );
};

export const Image: React.FC<any> = ({ source, style, resizeMode = 'cover' }) => {
  const uri = typeof source === 'object' && source ? source.uri : source;
  return (
    <img
      src={uri}
      alt=""
      style={toCssStyle(style, {
        objectFit: resizeMode,
        display: 'block',
        flexShrink: 0,
      })}
    />
  );
};

export const Modal: React.FC<any> = ({ visible, children }) => {
  if (!visible) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
};

export const ActivityIndicator: React.FC<{ size?: string; color?: string }> = ({
  color = '#FFFFFF',
}) => (
  <span
    style={{
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: `2px solid ${color}33`,
      borderTopColor: color,
      borderRadius: '50%',
      animation: 'rn-spin 0.75s linear infinite',
      flexShrink: 0,
    }}
  />
);
