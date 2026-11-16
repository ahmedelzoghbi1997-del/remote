// بروتوكول تشفير تكييف Midea بالأشعة تحت الحمراء (48-bit / 38kHz)
// متوافق مع المواصفة القياسية لبروتوكول Midea / Coolix (A, ~A, B, ~B, C, ~C)

export const MIDEA_CARRIER_HZ = 38000;
export const MIDEA_MIN_TEMP = 17;
export const MIDEA_MAX_TEMP = 30;

// توقيتات النبضات بالميكروثانية (مضبوطة لمعايرة AGC واستقبال أقوى)
const HDR_MARK = 4500;
const HDR_SPACE = 4400;
const BIT_MARK = 560;
const ONE_SPACE = 1690;
const ZERO_SPACE = 560;
const GAP_SPACE = 5200;

// جدول ترميز الحرارة (Gray-Code) من 17°C إلى 30°C (مطابق لـ IRremoteESP8266 kCoolixTempMap)
const MIDEA_TEMP_GRAY_TABLE = [
  0x0, // 17°C (0b0000)
  0x1, // 18°C (0b0001)
  0x3, // 19°C (0b0011)
  0x2, // 20°C (0b0010)
  0x6, // 21°C (0b0110)
  0x7, // 22°C (0b0111)
  0x5, // 23°C (0b0101)
  0x4, // 24°C (0b0100)
  0xc, // 25°C (0b1100)
  0xd, // 26°C (0b1101)
  0x9, // 27°C (0b1001)
  0x8, // 28°C (0b1000)
  0xa, // 29°C (0b1010)
  0xb, // 30°C (0b1011)
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

// أوامر Midea المستقلة الثابتة (48-bit بصيغة B0, ~B0, B2, ~B2, B4, ~B4)
export const MIDEA_SPECIAL_FRAMES = {
  power_off: [0xb2, 0x4d, 0x7b, 0x84, 0xe0, 0x1f], // 0xB27BE0
  swing: [0xb2, 0x4d, 0x6b, 0x94, 0xe0, 0x1f],     // 0xB26BE0
  sleep: [0xb2, 0x4d, 0xe0, 0x1f, 0x03, 0xfc],     // 0xB2E003
  turbo: [0xb5, 0x4a, 0xf5, 0x0a, 0xa2, 0x5d],     // 0xB5F5A2
  led: [0xb5, 0x4a, 0xf5, 0x0a, 0xa5, 0x5a],       // 0xB5F5A5
  clean: [0xb5, 0x4a, 0xf5, 0x0a, 0xaa, 0x55],     // 0xB5F5AA
};

const TOGGLE_SPECIAL_COMMANDS = new Set(['swing', 'sleep', 'turbo', 'led', 'clean']);

function resolveTempAndModeByte4Base(acState) {
  const modeKey = (acState && acState.mode) || 'cool';
  if (modeKey === 'fan') {
    // وضع المروحة فقط في Midea يرسل Temp=0xE مع Mode=0b01
    return (0x0e << 4) | (MIDEA_MODE_BITS.dry << 2);
  }
  const rawTemp = Number(acState && acState.temperature);
  const clampedTemp = Math.max(
    MIDEA_MIN_TEMP,
    Math.min(MIDEA_MAX_TEMP, Number.isFinite(rawTemp) ? Math.round(rawTemp) : 22)
  );
  const tempNibble = MIDEA_TEMP_GRAY_TABLE[clampedTemp - MIDEA_MIN_TEMP];
  const modeBits =
    MIDEA_MODE_BITS[modeKey] !== undefined ? MIDEA_MODE_BITS[modeKey] : MIDEA_MODE_BITS.cool;
  return ((tempNibble & 0x0f) << 4) | ((modeBits & 0x03) << 2);
}

function resolveFanBits(acState, allowAutoDryFanBits = false) {
  const modeKey = (acState && acState.mode) || 'cool';
  const isFixedFanMode = modeKey === 'auto' || modeKey === 'dry';
  if (isFixedFanMode && !allowAutoDryFanBits) {
    return null;
  }
  const fanKey = acState && acState.fanSpeed;
  return MIDEA_FAN_BITS[fanKey] !== undefined ? MIDEA_FAN_BITS[fanKey] : MIDEA_FAN_BITS.auto;
}

// تشفير مؤقت المكيف العتادي بصيغة COOLIX48 (من 30 دقيقة حتى 24 ساعة)
// مطابق لمتجهات IRremoteESP8266: مثل 0xB24DA15E607F (21°C Cool 0.5h) و 0xB24DA15E90FF (27°C Cool 0.5h)
export function buildMideaTimerBytes(acState, timerMinutes, timerAction = 'off') {
  const safeMinutes = Math.max(30, Math.min(1440, Math.round(Number(timerMinutes) || 30)));
  const halfHours = Math.max(1, Math.min(48, Math.round(safeMinutes / 30)));
  const blockIndex = Math.floor((halfHours - 1) / 16); // 0: 0.5-8h, 1: 8.5-16h, 2: 16.5-24h
  const stepInBlock = (halfHours - 1) % 16;
  const timerLow5 = (0x01 + stepInBlock * 2) & 0x1f;

  const byte0 = 0xb2;
  const byte1 = 0x4d;

  const activeFanBits = resolveFanBits(acState, true);
  const fanBits = timerAction === 'on' && (!acState || !acState.power) ? MIDEA_FAN_BITS.auto : activeFanBits;
  const byte2 = ((fanBits & 0x07) << 5) | timerLow5;
  const byte3 = (~byte2) & 0xff;

  const byte4 = (resolveTempAndModeByte4Base(acState) & 0xfc) | (blockIndex & 0x03);
  const byte5 = (byte4 & 0x80) | 0x7f;

  return [byte0, byte1, byte2, byte3, byte4, byte5];
}

export function buildMideaAcBytes(acState, options = {}) {
  const {
    isSwingToggle = false,
    specialCommand = null,
    timerMinutes = 0,
    timerAction = 'off',
  } = options;

  if (specialCommand && MIDEA_SPECIAL_FRAMES[specialCommand]) {
    return [...MIDEA_SPECIAL_FRAMES[specialCommand]];
  }

  if (isSwingToggle) {
    return [...MIDEA_SPECIAL_FRAMES.swing];
  }

  if (Number(timerMinutes) >= 30) {
    return buildMideaTimerBytes(acState, timerMinutes, timerAction);
  }

  if (!acState || !acState.power) {
    return [...MIDEA_SPECIAL_FRAMES.power_off];
  }

  const byte0 = 0xb2;
  const byte1 = (~byte0) & 0xff; // 0x4D

  const fanBits = resolveFanBits(acState, false);
  const byte2 = fanBits === null ? 0x1f : ((fanBits & 0x07) << 5) | 0x1f;
  const byte3 = (~byte2) & 0xff;

  const byte4 = resolveTempAndModeByte4Base(acState);
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
  const { invertRepeat = false, repeatCount, isSwingToggle = false, specialCommand = null } = options;
  const primaryBytes = buildMideaAcBytes(acState, options);
  const repeatBytes = invertRepeat
    ? primaryBytes.map((b) => (~b) & 0xff)
    : primaryBytes;

  // أوامر التبديل (مثل Sleep/Swing/Turbo/LED/Clean) تتطلب إطارين فقط (kCoolixDefaultRepeat) لمنع التفعيل ثم الإلغاء
  const isToggle = isSwingToggle || (specialCommand && TOGGLE_SPECIAL_COMMANDS.has(specialCommand));
  const defaultRepeats = isToggle ? 2 : 3;
  const totalFrames = Math.max(2, Math.min(4, Number(repeatCount) || defaultRepeats));

  const pattern = [];
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx += 1) {
    if (frameIdx > 0) {
      pattern.push(GAP_SPACE);
    }
    const frameBytes = frameIdx === 1 && invertRepeat ? repeatBytes : primaryBytes;
    appendFramePulses(pattern, frameBytes);
  }
  return pattern;
}

export function encodeMideaTimerPattern(acState, timerMinutes, timerAction = 'off', options = {}) {
  return encodeMideaAcPattern(acState, {
    ...options,
    timerMinutes,
    timerAction,
  });
}

export function formatMideaBytesHex(bytes) {
  return (
    '0x' +
    bytes
      .map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, '0'))
      .join('')
  );
}
