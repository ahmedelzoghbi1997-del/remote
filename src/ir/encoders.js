export const CARRIER_38KHZ = 38000;

export function pushByteLsbFirst(pattern, byteValue) {
  const b = byteValue & 0xff;
  for (let bit = 0; bit < 8; bit++) {
    const isOne = ((b >>> bit) & 1) === 1;
    pattern.push(560);
    pattern.push(isOne ? 1690 : 560);
  }
}

export function encodeSamsungDual0707(commandHex, addressHigh = 0x07, addressLow = 0x07) {
  const cmd = commandHex & 0xff;
  const cmdInv = ~cmd & 0xff;
  const pattern = [4500, 4500];
  pushByteLsbFirst(pattern, addressHigh);
  pushByteLsbFirst(pattern, addressLow);
  pushByteLsbFirst(pattern, cmd);
  pushByteLsbFirst(pattern, cmdInv);
  pattern.push(560);
  return pattern;
}

export function encodeNecToMicroseconds(addressHex, commandHex) {
  const addr = addressHex & 0xff;
  const addrInv = ~addr & 0xff;
  const cmd = commandHex & 0xff;
  const cmdInv = ~cmd & 0xff;

  const pattern = [9000, 4500];
  pushByteLsbFirst(pattern, addr);
  pushByteLsbFirst(pattern, addrInv);
  pushByteLsbFirst(pattern, cmd);
  pushByteLsbFirst(pattern, cmdInv);
  pattern.push(560);
  return pattern;
}

export const TV_IR_BRANDS = {
  samsung: {
    label: 'Samsung (0x0707)',
    protocol: 'samsung_dual',
    addressHigh: 0x07,
    addressLow: 0x07,
    commands: {
      POWER: 0x02,
      VOL_UP: 0x07,
      VOL_DOWN: 0x0b,
      MUTE: 0x0f,
      CH_UP: 0x12,
      CH_DOWN: 0x10,
      UP: 0x60,
      DOWN: 0x61,
      LEFT: 0x65,
      RIGHT: 0x62,
      OK: 0x68,
      BACK: 0x58,
      HOME: 0x79,
      MENU: 0x1a,
      INPUT: 0x01,
      YOUTUBE: 0x7c,
      NETFLIX: 0x34,
    },
  },
  lg: {
    label: 'LG TV (NEC)',
    protocol: 'nec',
    address: 0x04,
    commands: {
      POWER: 0x08,
      VOL_UP: 0x02,
      VOL_DOWN: 0x03,
      MUTE: 0x09,
      CH_UP: 0x00,
      CH_DOWN: 0x01,
      UP: 0x40,
      DOWN: 0x41,
      LEFT: 0x07,
      RIGHT: 0x06,
      OK: 0x44,
      BACK: 0x28,
      HOME: 0x7c,
      MENU: 0x43,
      INPUT: 0x0b,
    },
  },
};

export function buildAcIrPattern(brandKey, acState) {
  const brandAddress = brandKey === 'carrier' ? 0x4d : 0x58;
  const modeMap = { cool: 1, dry: 2, fan: 3, heat: 4, auto: 0 };
  const fanMap = { auto: 0, low: 1, medium: 2, high: 3 };
  const clampedTemp = Math.max(16, Math.min(30, acState.temperature));
  const tempOffset = clampedTemp - 16;

  const modeCode = modeMap[acState.mode] !== undefined ? modeMap[acState.mode] : 1;
  const fanCode = fanMap[acState.fanSpeed] !== undefined ? fanMap[acState.fanSpeed] : 0;

  const stateByte =
    ((acState.power ? 1 : 0) << 7) |
    (modeCode << 4) |
    (fanCode << 2) |
    (acState.swing ? 0x02 : 0x00);

  return [
    ...encodeNecToMicroseconds(brandAddress, stateByte),
    20000,
    ...encodeNecToMicroseconds(brandAddress ^ 0x0f, tempOffset),
  ];
}

export const AC_MODES = [
  { key: 'cool', label: 'تبريد' },
  { key: 'heat', label: 'تدفئة' },
  { key: 'dry', label: 'تجفيف' },
  { key: 'fan', label: 'مروحة' },
  { key: 'auto', label: 'تلقائي' },
];

export const FAN_SPEEDS = [
  { key: 'auto', label: 'تلقائي' },
  { key: 'low', label: 'منخفض' },
  { key: 'medium', label: 'متوسط' },
  { key: 'high', label: 'عالي' },
];
