import React from 'react';

export const Platform = {
  OS: 'web' as const,
  select<T>(specifics: { web?: T; android?: T; ios?: T; default?: T }): T | undefined {
    return specifics.web !== undefined ? specifics.web : specifics.default;
  },
};

export const NativeModules: Record<string, unknown> = {};

export const I18nManager = {
  isRTL: true,
  allowRTL: () => {},
  forceRTL: () => {},
};

export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
};

export const Dimensions = {
  get(_dim: 'window' | 'screen' = 'window') {
    if (typeof window === 'undefined') {
      return { width: 390, height: 780, scale: 2, fontScale: 1 };
    }
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio || 1,
      fontScale: 1,
    };
  },
};

export function useWindowDimensions() {
  const [dims, setDims] = React.useState(() => Dimensions.get('window'));
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setDims(Dimensions.get('window'));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return dims;
}

type RNStyle = Record<string, any> | false | null | undefined | RNStyle[];

function flattenStyle(style: RNStyle): Record<string, any> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<Record<string, any>>((acc, item) => {
      return Object.assign(acc, flattenStyle(item));
    }, {});
  }
  return { ...style };
}

function toWebStyle(
  style: RNStyle,
  extra: React.CSSProperties = {}
): React.CSSProperties {
  const flat = flattenStyle(style);
  const css: Record<string, any> = {};

  for (const [key, val] of Object.entries(flat)) {
    if (val === undefined || val === null) continue;

    switch (key) {
      case 'paddingHorizontal':
        css.paddingLeft = val;
        css.paddingRight = val;
        break;
      case 'paddingVertical':
        css.paddingTop = val;
        css.paddingBottom = val;
        break;
      case 'marginHorizontal':
        css.marginLeft = val;
        css.marginRight = val;
        break;
      case 'marginVertical':
        css.marginTop = val;
        css.marginBottom = val;
        break;
      case 'borderWidth':
        css.borderWidth = val;
        if (Number(val) > 0) css.borderStyle = 'solid';
        break;
      case 'borderTopWidth':
        css.borderTopWidth = val;
        if (Number(val) > 0) css.borderTopStyle = 'solid';
        break;
      case 'borderBottomWidth':
        css.borderBottomWidth = val;
        if (Number(val) > 0) css.borderBottomStyle = 'solid';
        break;
      case 'borderLeftWidth':
        css.borderLeftWidth = val;
        if (Number(val) > 0) css.borderLeftStyle = 'solid';
        break;
      case 'borderRightWidth':
        css.borderRightWidth = val;
        if (Number(val) > 0) css.borderRightStyle = 'solid';
        break;
      case 'flex':
        css.flex = val === 1 ? '1 1 0%' : val;
        if (val === 1) {
          css.minHeight = css.minHeight ?? 0;
          css.minWidth = css.minWidth ?? 0;
        }
        break;
      case 'fontVariant':
        if (Array.isArray(val) && val.includes('tabular-nums')) {
          css.fontVariantNumeric = 'tabular-nums';
        }
        break;
      case 'transform':
        if (Array.isArray(val)) {
          css.transform = val
            .map((t) => {
              if (!t || typeof t !== 'object') return '';
              return Object.entries(t)
                .map(([k, v]) => `${k}(${typeof v === 'number' && !k.includes('scale') ? `${v}px` : v})`)
                .join(' ');
            })
            .filter(Boolean)
            .join(' ');
        } else if (typeof val === 'string') {
          css.transform = val;
        }
        break;
      case 'textAlignVertical':
      case 'elevation':
      case 'shadowColor':
      case 'shadowOffset':
      case 'shadowOpacity':
      case 'shadowRadius':
        break;
      default:
        css[key] = val;
        break;
    }
  }

  return {
    boxSizing: 'border-box',
    ...css,
    ...extra,
  };
}

export const StyleSheet = {
  create<T extends Record<string, Record<string, any>>>(styles: T): T {
    return styles;
  },
  flatten: flattenStyle,
};

export function SafeAreaView({ style, children }: { style?: RNStyle; children?: React.ReactNode }) {
  return (
    <div
      dir="rtl"
      style={toWebStyle(style, {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      })}
    >
      {children}
    </div>
  );
}

export function StatusBar(_props: { barStyle?: string; backgroundColor?: string }) {
  return null;
}

export const PanResponder = {
  create(config: Record<string, any>) {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    let granted = false;

    const makeGestureState = (e: any) => {
      const ne = (e && e.nativeEvent) || {};
      const pageX = Number(ne.pageX ?? ne.locationX ?? 0);
      const pageY = Number(ne.pageY ?? ne.locationY ?? 0);
      const now = Date.now();
      const dt = Math.max(1, now - (lastTime || now));
      const vx = (pageX - lastX) / dt;
      const vy = (pageY - lastY) / dt;
      lastX = pageX;
      lastY = pageY;
      lastTime = now;

      return {
        stateID: 1,
        x0: startX,
        y0: startY,
        moveX: pageX,
        moveY: pageY,
        dx: pageX - startX,
        dy: pageY - startY,
        vx,
        vy,
        numberActiveTouches: granted ? 1 : 0,
      };
    };

    const panHandlers = {
      onStartShouldSetResponder: (e: any) => {
        if (typeof config.onStartShouldSetPanResponder === 'function') {
          const ne = (e && e.nativeEvent) || {};
          startX = Number(ne.pageX ?? ne.locationX ?? 0);
          startY = Number(ne.pageY ?? ne.locationY ?? 0);
          lastX = startX;
          lastY = startY;
          lastTime = Date.now();
          return Boolean(config.onStartShouldSetPanResponder(e, makeGestureState(e)));
        }
        return false;
      },
      onMoveShouldSetResponder: (e: any) => {
        if (typeof config.onMoveShouldSetPanResponder === 'function') {
          return Boolean(config.onMoveShouldSetPanResponder(e, makeGestureState(e)));
        }
        return false;
      },
      onResponderTerminationRequest: (e: any) => {
        if (typeof config.onPanResponderTerminationRequest === 'function') {
          return Boolean(config.onPanResponderTerminationRequest(e, makeGestureState(e)));
        }
        return true;
      },
      onResponderGrant: (e: any) => {
        const ne = (e && e.nativeEvent) || {};
        startX = Number(ne.pageX ?? ne.locationX ?? 0);
        startY = Number(ne.pageY ?? ne.locationY ?? 0);
        lastX = startX;
        lastY = startY;
        lastTime = Date.now();
        granted = true;
        if (typeof config.onPanResponderGrant === 'function') {
          config.onPanResponderGrant(e, makeGestureState(e));
        }
      },
      onResponderMove: (e: any) => {
        if (typeof config.onPanResponderMove === 'function') {
          config.onPanResponderMove(e, makeGestureState(e));
        }
      },
      onResponderRelease: (e: any) => {
        const gs = makeGestureState(e);
        granted = false;
        if (typeof config.onPanResponderRelease === 'function') {
          config.onPanResponderRelease(e, gs);
        }
      },
      onResponderTerminate: (e: any) => {
        const gs = makeGestureState(e);
        granted = false;
        if (typeof config.onPanResponderTerminate === 'function') {
          config.onPanResponderTerminate(e, gs);
        } else if (typeof config.onPanResponderRelease === 'function') {
          config.onPanResponderRelease(e, gs);
        }
      },
    };

    return { panHandlers };
  },
};

export function View({
  style,
  pointerEvents,
  onLayout,
  onStartShouldSetResponder,
  onMoveShouldSetResponder,
  onResponderGrant,
  onResponderMove,
  onResponderRelease,
  onResponderTerminate,
  children,
}: {
  style?: RNStyle;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  onLayout?: (e: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => void;
  onStartShouldSetResponder?: (e: any) => boolean;
  onMoveShouldSetResponder?: (e: any) => boolean;
  onResponderGrant?: (e: any) => void;
  onResponderMove?: (e: any) => void;
  onResponderRelease?: (e: any) => void;
  onResponderTerminate?: (e: any) => void;
  onResponderTerminationRequest?: (e: any) => boolean;
  children?: React.ReactNode;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const latestOnLayoutRef = React.useRef(onLayout);
  latestOnLayoutRef.current = onLayout;
  const activePointerRef = React.useRef<number | null>(null);
  const trackingPointerRef = React.useRef<boolean>(false);
  const hasResponder = Boolean(
    onStartShouldSetResponder ||
      onMoveShouldSetResponder ||
      onResponderGrant ||
      onResponderMove ||
      onResponderRelease
  );

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el || !latestOnLayoutRef.current) return undefined;
    const emit = () => {
      if (!latestOnLayoutRef.current) return;
      const rect = el.getBoundingClientRect();
      latestOnLayoutRef.current({
        nativeEvent: {
          layout: {
            x: rect.left,
            y: rect.top,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        },
      });
    };
    emit();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => emit());
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [Boolean(onLayout)]);

  const buildNativeEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      nativeEvent: {
        locationX: e.clientX - rect.left,
        locationY: e.clientY - rect.top,
        pageX: e.pageX,
        pageY: e.pageY,
      },
    };
  };

  return (
    <div
      ref={hostRef}
      onPointerDown={
        hasResponder
          ? (e) => {
              const synth = buildNativeEvent(e);
              trackingPointerRef.current = true;
              if (onStartShouldSetResponder && !onStartShouldSetResponder(synth)) {
                return;
              }
              activePointerRef.current = e.pointerId;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (_) {
                // ignore
              }
              if (onResponderGrant) onResponderGrant(synth);
            }
          : undefined
      }
      onPointerMove={
        hasResponder
          ? (e) => {
              const synth = buildNativeEvent(e);
              if (activePointerRef.current !== e.pointerId) {
                if (
                  trackingPointerRef.current &&
                  onMoveShouldSetResponder &&
                  onMoveShouldSetResponder(synth)
                ) {
                  activePointerRef.current = e.pointerId;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch (_) {
                    // ignore
                  }
                  if (onResponderGrant) onResponderGrant(synth);
                }
                return;
              }
              if (onResponderMove) onResponderMove(synth);
            }
          : undefined
      }
      onPointerUp={
        hasResponder
          ? (e) => {
              trackingPointerRef.current = false;
              if (activePointerRef.current !== e.pointerId) return;
              activePointerRef.current = null;
              if (onResponderRelease) onResponderRelease(buildNativeEvent(e));
            }
          : undefined
      }
      onPointerCancel={
        hasResponder
          ? (e) => {
              trackingPointerRef.current = false;
              if (activePointerRef.current !== e.pointerId) return;
              activePointerRef.current = null;
              if (onResponderTerminate) {
                onResponderTerminate(buildNativeEvent(e));
              } else if (onResponderRelease) {
                onResponderRelease(buildNativeEvent(e));
              }
            }
          : undefined
      }
      style={toWebStyle(style, {
        display: 'flex',
        flexDirection: flattenStyle(style).flexDirection || 'column',
        ...(pointerEvents === 'none' ? { pointerEvents: 'none' } : {}),
        ...(hasResponder ? { cursor: 'pointer', touchAction: 'none', userSelect: 'none' } : {}),
      })}
    >
      {children}
    </div>
  );
}

export function Text({
  style,
  numberOfLines,
  children,
}: {
  style?: RNStyle;
  numberOfLines?: number;
  children?: React.ReactNode;
}) {
  const clampStyle: React.CSSProperties =
    numberOfLines && numberOfLines > 0
      ? {
          display: '-webkit-box',
          WebkitLineClamp: numberOfLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }
      : {};

  return (
    <span
      style={toWebStyle(style, {
        margin: 0,
        lineHeight: 1.35,
        ...clampStyle,
      })}
    >
      {children}
    </span>
  );
}

export function TouchableOpacity({
  style,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  activeOpacity = 0.75,
  accessibilityLabel,
  children,
}: {
  style?: RNStyle;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
  activeOpacity?: number;
  accessibilityLabel?: string;
  hitSlop?: unknown;
  children?: React.ReactNode;
}) {
  const [pressed, setPressed] = React.useState(false);
  const flat = flattenStyle(style);

  return (
    <button
      type="button"
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled && onPress) onPress();
      }}
      onPointerDown={() => {
        if (disabled) return;
        setPressed(true);
        if (onPressIn) onPressIn();
      }}
      onPointerUp={() => {
        setPressed(false);
        if (onPressOut) onPressOut();
      }}
      onPointerLeave={() => {
        if (pressed) {
          setPressed(false);
          if (onPressOut) onPressOut();
        }
      }}
      onPointerCancel={() => {
        setPressed(false);
        if (onPressOut) onPressOut();
      }}
      style={toWebStyle(style, {
        display: 'flex',
        flexDirection: flat.flexDirection || 'column',
        ...(flat.borderWidth === undefined &&
        flat.borderTopWidth === undefined &&
        flat.borderBottomWidth === undefined &&
        flat.borderLeftWidth === undefined &&
        flat.borderRightWidth === undefined
          ? { borderWidth: 0, borderStyle: 'none' }
          : {}),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : pressed ? activeOpacity : 1,
        transition: 'opacity 100ms ease, transform 80ms ease, background-color 120ms ease',
        ...(activeOpacity < 1 && !flat.transform
          ? { transform: pressed && !disabled ? 'scale(0.98)' : 'none' }
          : {}),
        outline: 'none',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      })}
    >
      {children}
    </button>
  );
}

export function ScrollView({
  style,
  contentContainerStyle,
  scrollEnabled = true,
  onLayout,
  children,
}: {
  style?: RNStyle;
  contentContainerStyle?: RNStyle;
  showsVerticalScrollIndicator?: boolean;
  scrollEnabled?: boolean;
  nestedScrollEnabled?: boolean;
  keyboardShouldPersistTaps?: string;
  onLayout?: (e: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => void;
  children?: React.ReactNode;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const latestOnLayoutRef = React.useRef(onLayout);
  latestOnLayoutRef.current = onLayout;

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el || !latestOnLayoutRef.current) return undefined;
    const emit = () => {
      if (!latestOnLayoutRef.current) return;
      const rect = el.getBoundingClientRect();
      latestOnLayoutRef.current({
        nativeEvent: {
          layout: {
            x: rect.left,
            y: rect.top,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        },
      });
    };
    emit();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => emit());
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [Boolean(onLayout)]);

  return (
    <div
      ref={hostRef}
      style={toWebStyle(style, {
        overflowY: scrollEnabled ? 'auto' : 'hidden',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      })}
    >
      <div
        style={toWebStyle(contentContainerStyle, {
          display: 'flex',
          flexDirection: 'column',
        })}
      >
        {children}
      </div>
    </div>
  );
}

export function FlatList<T>({
  style,
  contentContainerStyle,
  data = [],
  keyExtractor,
  renderItem,
  ListHeaderComponent,
  ItemSeparatorComponent,
}: {
  style?: RNStyle;
  contentContainerStyle?: RNStyle;
  data?: T[];
  keyExtractor?: (item: T, index: number) => string;
  renderItem: (info: { item: T; index: number }) => React.ReactNode;
  ListHeaderComponent?: React.ReactNode | React.ComponentType;
  ItemSeparatorComponent?: React.ComponentType;
  keyboardShouldPersistTaps?: string;
  showsVerticalScrollIndicator?: boolean;
}) {
  const headerNode =
    typeof ListHeaderComponent === 'function' ? (
      <ListHeaderComponent />
    ) : (
      ListHeaderComponent || null
    );

  return (
    <div
      style={toWebStyle(style, {
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      })}
    >
      <div
        style={toWebStyle(contentContainerStyle, {
          display: 'flex',
          flexDirection: 'column',
        })}
      >
        {headerNode}
        {data.map((item, index) => {
          const key = keyExtractor ? keyExtractor(item, index) : String(index);
          return (
            <React.Fragment key={key}>
              {index > 0 && ItemSeparatorComponent ? <ItemSeparatorComponent /> : null}
              {renderItem({ item, index })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function TextInput({
  style,
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  onSubmitEditing,
  keyboardType,
  autoFocus,
}: {
  style?: RNStyle;
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  returnKeyType?: string;
  onSubmitEditing?: () => void;
  keyboardType?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      autoFocus={Boolean(autoFocus)}
      inputMode={keyboardType === 'numeric' ? 'decimal' : 'text'}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChangeText && onChangeText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onSubmitEditing) {
          onSubmitEditing();
        }
      }}
      style={toWebStyle(style, {
        outline: 'none',
        width: '100%',
        ['--placeholder-color' as any]: placeholderTextColor || '#64748B',
      })}
    />
  );
}

export function Image({
  source,
  style,
  resizeMode = 'cover',
}: {
  source?: { uri?: string } | string;
  style?: RNStyle;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
}) {
  const src = typeof source === 'string' ? source : source?.uri || '';
  return (
    <img
      src={src}
      alt=""
      style={toWebStyle(style, {
        objectFit: resizeMode === 'stretch' ? 'fill' : resizeMode === 'center' ? 'none' : resizeMode,
        display: 'block',
        flexShrink: 0,
      })}
    />
  );
}

export function ActivityIndicator({
  color = '#0EA5E9',
  size = 'small',
}: {
  color?: string;
  size?: 'small' | 'large' | number;
}) {
  const px = size === 'large' ? 24 : typeof size === 'number' ? size : 16;
  return (
    <span
      style={{
        display: 'inline-block',
        width: px,
        height: px,
        borderRadius: '50%',
        borderWidth: 2,
        borderStyle: 'solid',
        borderTopColor: color,
        borderRightColor: `${color}33`,
        borderBottomColor: `${color}33`,
        borderLeftColor: `${color}33`,
        animation: 'rn-spin 0.7s linear infinite',
      }}
    />
  );
}

export function Modal({
  visible,
  children,
}: {
  visible?: boolean;
  transparent?: boolean;
  animationType?: string;
  children?: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <div
      dir="rtl"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}
