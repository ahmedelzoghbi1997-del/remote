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

export function View({ style, children }: { style?: RNStyle; children?: React.ReactNode }) {
  return (
    <div
      style={toWebStyle(style, {
        display: 'flex',
        flexDirection: flattenStyle(style).flexDirection || 'column',
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
  children,
}: {
  style?: RNStyle;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
  activeOpacity?: number;
  hitSlop?: unknown;
  children?: React.ReactNode;
}) {
  const [pressed, setPressed] = React.useState(false);
  const flat = flattenStyle(style);

  return (
    <button
      type="button"
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
        border: flat.borderWidth ? undefined : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : pressed ? activeOpacity : 1,
        transition: 'opacity 100ms ease, transform 80ms ease',
        transform: pressed && !disabled ? 'scale(0.98)' : 'none',
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
  children,
}: {
  style?: RNStyle;
  contentContainerStyle?: RNStyle;
  showsVerticalScrollIndicator?: boolean;
  children?: React.ReactNode;
}) {
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
}: {
  style?: RNStyle;
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  returnKeyType?: string;
  onSubmitEditing?: () => void;
  keyboardType?: string;
}) {
  return (
    <input
      type="text"
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
        border: `2px solid ${color}33`,
        borderTopColor: color,
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
