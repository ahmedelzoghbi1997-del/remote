import React, { useState } from 'react';

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

function toCssStyle(styleInput: AnyStyle, baseStyle?: React.CSSProperties): React.CSSProperties {
  const flat = flattenStyle(styleInput);
  const out: Record<string, any> = { ...(baseStyle || {}) };
  let hasBorderWidth = false;

  for (const [key, rawVal] of Object.entries(flat)) {
    if (rawVal === undefined || rawVal === null) continue;

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
          const [fn, arg] = Object.entries(t)[0] || [];
          if (!fn) return '';
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
    if (key === 'elevation') {
      continue;
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
  vibrate: () => {},
  cancel: () => {},
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

export const TouchableOpacity: React.FC<any> = ({
  style,
  activeOpacity = 0.55,
  disabled,
  accessibilityLabel,
  accessibilityRole = 'button',
  onPress,
  onPressIn,
  onPressOut,
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
    css.transform = css.transform ? `${css.transform} scale(0.96)` : 'scale(0.96)';
  }

  return (
    <div
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      tabIndex={disabled ? -1 : 0}
      aria-disabled={Boolean(disabled)}
      style={css}
      onClick={(e) => {
        if (disabled) return;
        if (onPress) onPress(e);
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
