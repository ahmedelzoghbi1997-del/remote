// بروتوكول تشفير تكييف Midea بالأشعة تحت الحمراء (48-bit / 38kHz)
// متوافق مع المواصفة القياسية لبروتوكول Midea (A, ~A, B, ~B, C, ~C)

export const MIDEA_CARRIER_HZ = 38000;
export const MIDEA_MIN_TEMP = 17;
export const MIDEA_MAX_TEMP = 30;

// توقيتات النبضات بالميكروثانية
const HDR_MARK = 4400;
const HDR_SPACE = 4400;
const BIT_MARK = 550;
const ONE_SPACE = 1650;
const ZERO_SPACE = 550;
const GAP_SPACE = 5200;

// جدول ترميز الحرارة (Gray-Code) من 17°C إلى 30°C
const MIDEA_TEMP_GRAY_TABLE = [
  0x0, // 17°C
  0x1, // 18°C
  0x3, // 19°C
  0x2, // 20°C
  0x6, // 21°C
  0x7, // 22°C
  0x5, // 23°C
  0x4, // 24°C
  0xc, // 25°C
  0xd, // 26°C
  0xf, // 27°C
  0xe, // 28°C
  0xa, // 29°C
  0xb, // 30°C
];

const MIDEA_MODE_BITS = {
  cool: 0b00,
  dry: 0b01,
  auto: 0b10,
  heat: 0b11,
};

const MIDEA_FAN_BITS = {
  auto: 0b101,
  low: 0b100,
  medium: 0b010,
  high: 0b001,
};

// أوامر Midea المستقلة الثابتة (48-bit)
const MIDEA_POWER_OFF_BYTES = [0xb2, 0x4d, 0x7b, 0x84, 0xe0, 0x1f];
const MIDEA_SWING_TOGGLE_BYTES = [0xb2, 0x4d, 0x6b, 0x94, 0xe0, 0x1f];

export function buildMideaAcBytes(acState, options = {}) {
  const { isSwingToggle = false } = options;

  if (isSwingToggle) {
    return [...MIDEA_SWING_TOGGLE_BYTES];
  }

  if (!acState || !acState.power) {
    return [...MIDEA_POWER_OFF_BYTES];
  }

  const byte0 = 0xb2;
  const byte1 = (~byte0) & 0xff; // 0x4D

  const modeKey = acState.mode || 'cool';
  const isFanOnly = modeKey === 'fan';
  const isFixedFanMode = modeKey === 'auto' || modeKey === 'dry';

  let byte2;
  if (isFixedFanMode) {
    byte2 = 0x1f;
  } else {
    const fanBits =
      MIDEA_FAN_BITS[acState.fanSpeed] !== undefined
        ? MIDEA_FAN_BITS[acState.fanSpeed]
        : MIDEA_FAN_BITS.auto;
    byte2 = ((fanBits & 0x07) << 5) | 0x1f;
  }
  const byte3 = (~byte2) & 0xff;

  let byte4;
  if (isFanOnly) {
    // وضع المروحة فقط في Midea يرسل Temp=0xE مع Mode=0b01
    byte4 = (0x0e << 4) | (MIDEA_MODE_BITS.dry << 2);
  } else {
    const rawTemp = Number(acState.temperature);
    const clampedTemp = Math.max(
      MIDEA_MIN_TEMP,
      Math.min(MIDEA_MAX_TEMP, Number.isFinite(rawTemp) ? Math.round(rawTemp) : 22)
    );
    const tempNibble = MIDEA_TEMP_GRAY_TABLE[clampedTemp - MIDEA_MIN_TEMP];
    const modeBits =
      MIDEA_MODE_BITS[modeKey] !== undefined ? MIDEA_MODE_BITS[modeKey] : MIDEA_MODE_BITS.cool;
    byte4 = ((tempNibble & 0x0f) << 4) | ((modeBits & 0x03) << 2);
  }
  const byte5 = (~byte4) & 0xff;

  return [byte0, byte1, byte2, byte3, byte4, byte5];
}

function appendFramePulses(pattern, bytes) {
  pattern.push(HDR_MARK, HDR_SPACE);
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] & 0xff;
    // إرسال البتات بترتيب MSB-First
    for (let bit = 7; bit >= 0; bit -= 1) {
      const isOne = ((b >>> bit) & 1) === 1;
      pattern.push(BIT_MARK, isOne ? ONE_SPACE : ZERO_SPACE);
    }
  }
  pattern.push(BIT_MARK);
}

export function encodeMideaAcPattern(acState, options = {}) {
  const { invertRepeat = false } = options;
  const primaryBytes = buildMideaAcBytes(acState, options);
  const repeatBytes = invertRepeat
    ? primaryBytes.map((b) => (~b) & 0xff)
    : primaryBytes;

  const pattern = [];
  appendFramePulses(pattern, primaryBytes);
  pattern.push(GAP_SPACE);
  appendFramePulses(pattern, repeatBytes);
  return pattern;
}

export function formatMideaBytesHex(bytes) {
  return (
    '0x' +
    bytes
      .map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, '0'))
      .join('')
  );
}
