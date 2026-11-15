import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Code2,
  CornerUpLeft,
  Fan,
  Home,
  Menu,
  Minus,
  Plus,
  Power,
  Radio,
  Snowflake,
  Tv,
  Volume2,
  Wifi,
} from 'lucide-react';

interface PhoneRemoteSimulatorProps {
  onSelectSourceFile: (fileId: string) => void;
}

type RemoteTab = 'tv' | 'ac';
type TransportMode = 'ir' | 'wifi';
type TvIrBrand = 'samsung' | 'lg';
type WifiProtocol = 'roku' | 'android_tv';
type AcBrand = 'gree' | 'carrier';
type AcMode = 'cool' | 'heat' | 'dry' | 'fan' | 'auto';
type FanSpeed = 'auto' | 'low' | 'medium' | 'high';

interface SignalTransmission {
  id: number;
  transport: TransportMode;
  commandLabel: string;
  targetLabel: string;
  carrierHz?: number;
  pattern?: number[];
  wifiEndpointOrPayload?: string;
  timestamp: string;
}

const TV_COMMANDS: Record<TvIrBrand, { address: number; cmds: Record<string, number> }> = {
  samsung: {
    address: 0x07,
    cmds: {
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
    },
  },
  lg: {
    address: 0x04,
    cmds: {
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

const WIFI_MAP: Record<string, { roku: string; androidTv: string }> = {
  POWER: { roku: 'Power', androidTv: 'KEYCODE_POWER' },
  VOL_UP: { roku: 'VolumeUp', androidTv: 'KEYCODE_VOLUME_UP' },
  VOL_DOWN: { roku: 'VolumeDown', androidTv: 'KEYCODE_VOLUME_DOWN' },
  MUTE: { roku: 'VolumeMute', androidTv: 'KEYCODE_VOLUME_MUTE' },
  CH_UP: { roku: 'ChannelUp', androidTv: 'KEYCODE_CHANNEL_UP' },
  CH_DOWN: { roku: 'ChannelDown', androidTv: 'KEYCODE_CHANNEL_DOWN' },
  UP: { roku: 'Up', androidTv: 'KEYCODE_DPAD_UP' },
  DOWN: { roku: 'Down', androidTv: 'KEYCODE_DPAD_DOWN' },
  LEFT: { roku: 'Left', androidTv: 'KEYCODE_DPAD_LEFT' },
  RIGHT: { roku: 'Right', androidTv: 'KEYCODE_DPAD_RIGHT' },
  OK: { roku: 'Select', androidTv: 'KEYCODE_DPAD_CENTER' },
  BACK: { roku: 'Back', androidTv: 'KEYCODE_BACK' },
  HOME: { roku: 'Home', androidTv: 'KEYCODE_HOME' },
  MENU: { roku: 'Info', androidTv: 'KEYCODE_MENU' },
  INPUT: { roku: 'InputHDMI1', androidTv: 'KEYCODE_TV_INPUT' },
};

function encodeNecPattern(addressHex: number, commandHex: number): number[] {
  const addr = addressHex & 0xff;
  const addrInv = ~addr & 0xff;
  const cmd = commandHex & 0xff;
  const cmdInv = ~cmd & 0xff;
  const frame =
    ((addr << 24) >>> 0) | ((addrInv << 16) >>> 0) | ((cmd << 8) >>> 0) | (cmdInv >>> 0);
  const pattern = [9000, 4500];
  for (let bit = 31; bit >= 0; bit--) {
    const isOne = ((frame >>> bit) & 1) === 1;
    pattern.push(560, isOne ? 1690 : 560);
  }
  pattern.push(560);
  return pattern;
}

const INPUT_SOURCES = ['HDMI 1', 'HDMI 2', 'التلفاز الرقمي', 'البث الشبكي'];

const AC_MODES: { key: AcMode; label: string }[] = [
  { key: 'cool', label: 'تبريد' },
  { key: 'heat', label: 'تدفئة' },
  { key: 'dry', label: 'تجفيف' },
  { key: 'fan', label: 'مروحة' },
  { key: 'auto', label: 'تلقائي' },
];

const FAN_LABELS: Record<FanSpeed, string> = {
  auto: 'تلقائي',
  low: 'منخفض',
  medium: 'متوسط',
  high: 'عالي',
};

export default function PhoneRemoteSimulator({ onSelectSourceFile }: PhoneRemoteSimulatorProps) {
  const [activeTab, setActiveTab] = useState<RemoteTab>('tv');
  const [transport, setTransport] = useState<TransportMode>('ir');
  const [irBrand, setIrBrand] = useState<TvIrBrand>('samsung');
  const [wifiProtocol, setWifiProtocol] = useState<WifiProtocol>('roku');
  const [wifiIp, setWifiIp] = useState('192.168.1.50');
  const [acBrand, setAcBrand] = useState<AcBrand>('gree');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Simulated Virtual TV State
  const [tvState, setTvState] = useState({
    power: true,
    volume: 34,
    muted: false,
    channel: 12,
    inputIndex: 0,
    screenNotice: 'القناة 12 · البث المباشر',
  });

  // Simulated Virtual AC State
  const [acState, setAcState] = useState({
    power: true,
    temperature: 22,
    mode: 'cool' as AcMode,
    fanSpeed: 'auto' as FanSpeed,
    swing: true,
  });

  const [lastSignal, setLastSignal] = useState<SignalTransmission>(() => ({
    id: 1,
    transport: 'ir',
    commandLabel: 'جاهز للإرسال',
    targetLabel: 'Samsung TV · ConsumerIrManager',
    carrierHz: 38000,
    pattern: encodeNecPattern(0x07, 0x02),
    timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
  }));

  const [pulseFlash, setPulseFlash] = useState(false);

  const triggerFlash = () => {
    setPulseFlash(true);
    setTimeout(() => setPulseFlash(false), 180);
  };

  const sendTvCommand = (commandKey: string, labelAr: string) => {
    triggerFlash();

    setTvState((prev) => {
      if (commandKey === 'POWER') {
        const nextPower = !prev.power;
        return {
          ...prev,
          power: nextPower,
          screenNotice: nextPower ? `تم التشغيل · القناة ${prev.channel}` : 'الشاشة في وضع الاستعداد',
        };
      }
      if (!prev.power) {
        return { ...prev, screenNotice: 'الشاشة مطفأة — اضغط طاقة للتشغيل' };
      }
      switch (commandKey) {
        case 'VOL_UP':
          return {
            ...prev,
            muted: false,
            volume: Math.min(100, prev.volume + 4),
            screenNotice: `مستوى الصوت: ${Math.min(100, prev.volume + 4)}`,
          };
        case 'VOL_DOWN':
          return {
            ...prev,
            muted: false,
            volume: Math.max(0, prev.volume - 4),
            screenNotice: `مستوى الصوت: ${Math.max(0, prev.volume - 4)}`,
          };
        case 'MUTE':
          return {
            ...prev,
            muted: !prev.muted,
            screenNotice: !prev.muted ? 'تم كتم الصوت' : `إعادة الصوت (${prev.volume})`,
          };
        case 'CH_UP':
          return {
            ...prev,
            channel: prev.channel >= 999 ? 1 : prev.channel + 1,
            screenNotice: `القناة ${prev.channel >= 999 ? 1 : prev.channel + 1}`,
          };
        case 'CH_DOWN':
          return {
            ...prev,
            channel: prev.channel <= 1 ? 999 : prev.channel - 1,
            screenNotice: `القناة ${prev.channel <= 1 ? 999 : prev.channel - 1}`,
          };
        case 'INPUT': {
          const nextIdx = (prev.inputIndex + 1) % INPUT_SOURCES.length;
          return {
            ...prev,
            inputIndex: nextIdx,
            screenNotice: `المصدر: ${INPUT_SOURCES[nextIdx]}`,
          };
        }
        default:
          return { ...prev, screenNotice: `تنفيذ الأمر: ${labelAr}` };
      }
    });

    const nowTime = new Date().toLocaleTimeString('en-GB', { hour12: false });
    if (transport === 'ir') {
      const brandObj = TV_COMMANDS[irBrand];
      const cmdHex = brandObj.cmds[commandKey] ?? 0x02;
      const pattern = encodeNecPattern(brandObj.address, cmdHex);
      setLastSignal({
        id: Date.now(),
        transport: 'ir',
        commandLabel: labelAr,
        targetLabel: irBrand === 'samsung' ? 'Samsung TV (NEC 38kHz)' : 'LG TV (NEC 38kHz)',
        carrierHz: 38000,
        pattern,
        timestamp: nowTime,
      });
    } else {
      const mapped = WIFI_MAP[commandKey] || WIFI_MAP.OK;
      const payload =
        wifiProtocol === 'roku'
          ? `POST http://${wifiIp}:8060/keypress/${mapped.roku}`
          : `WS ws://${wifiIp}:8080/remote -> {"type":"KEY_EVENT","keyCode":"${mapped.androidTv}"}`;
      setLastSignal({
        id: Date.now(),
        transport: 'wifi',
        commandLabel: labelAr,
        targetLabel: wifiProtocol === 'roku' ? `Roku ECP (${wifiIp})` : `Android TV WS (${wifiIp})`,
        wifiEndpointOrPayload: payload,
        timestamp: nowTime,
      });
    }
  };

  const emitAcState = (next: typeof acState, labelAr: string) => {
    triggerFlash();
    setAcState(next);
    const modeMap: Record<AcMode, number> = { cool: 1, dry: 2, fan: 3, heat: 4, auto: 0 };
    const fanMap: Record<FanSpeed, number> = { auto: 0, low: 1, medium: 2, high: 3 };
    const addr = acBrand === 'carrier' ? 0x4d : 0x58;
    const stateByte =
      ((next.power ? 1 : 0) << 7) |
      (modeMap[next.mode] << 4) |
      (fanMap[next.fanSpeed] << 2) |
      (next.swing ? 0x02 : 0);
    const pattern = [
      ...encodeNecPattern(addr, stateByte),
      20000,
      ...encodeNecPattern(addr ^ 0x0f, next.temperature - 16),
    ];

    setLastSignal({
      id: Date.now(),
      transport: 'ir',
      commandLabel: `${labelAr} (${next.temperature}°C)`,
      targetLabel: acBrand === 'gree' ? 'Gree AC · ConsumerIrManager' : 'Carrier AC · ConsumerIrManager',
      carrierHz: 38000,
      pattern,
      timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    });
  };

  // Build clean SVG pulse points for the IR waveform oscilloscope
  const irWavePoints = useMemo(() => {
    const raw = lastSignal.pattern?.slice(0, 36) || [];
    if (raw.length === 0) return '';
    let x = 0;
    const total = raw.reduce((acc, v) => acc + Math.min(v, 4500), 0) || 1;
    const width = 320;
    const pts: string[] = [];
    raw.forEach((dur, idx) => {
      const clamped = Math.min(dur, 4500);
      const stepW = (clamped / total) * width;
      const isMark = idx % 2 === 0;
      const y = isMark ? 8 : 34;
      pts.push(`${x.toFixed(1)},${y}`);
      x += stepW;
      pts.push(`${x.toFixed(1)},${y}`);
    });
    return pts.join(' ');
  }, [lastSignal]);

  const currentAcModeLabel = AC_MODES.find((m) => m.key === acState.mode)?.label || 'تبريد';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* العمود الأول: جهاز الهاتف المحاكي التفاعلي */}
      <div className="lg:col-span-5 flex flex-col items-center">
        <div className="w-full max-w-[380px] rounded-[34px] bg-[#0F131B] border border-[#252E3E] p-3 shadow-2xl shadow-black/60">
          {/* مستشعر الـ IR أعلى إطار الهاتف */}
          <div className="flex items-center justify-between px-4 pt-1 pb-2.5">
            <span className="text-[11px] font-mono tabular-nums text-slate-400">11:45</span>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full transition-all duration-150 ${
                  pulseFlash
                    ? transport === 'ir' || activeTab === 'ac'
                      ? 'bg-red-500 scale-125 shadow-[0_0_12px_rgba(239,68,68,0.95)]'
                      : 'bg-sky-400 scale-125 shadow-[0_0_12px_rgba(14,165,233,0.95)]'
                    : 'bg-[#202736]'
                }`}
                title="باعث الأشعة تحت الحمراء"
              />
              <span className="h-1.5 w-12 rounded-full bg-[#1F2633]" />
            </div>
            <span className="text-[11px] text-slate-400">
              {activeTab === 'ac' || transport === 'ir' ? 'IR 38kHz' : 'Wi-Fi LAN'}
            </span>
          </div>

          {/* شاشة التطبيق داخل الهاتف */}
          <div className="rounded-[24px] bg-[#000000] border border-[#232326] overflow-hidden flex flex-col relative">
            {/* [أ] Header مدمج ارتفاع 44 */}
            <div className="h-[44px] flex items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="الطاقة"
                  onClick={() =>
                    activeTab === 'ac'
                      ? emitAcState(
                          { ...acState, power: !acState.power },
                          !acState.power ? 'تشغيل المكيف' : 'إطفاء المكيف'
                        )
                      : sendTvCommand('POWER', 'الطاقة')
                  }
                  className="w-[40px] h-[40px] rounded-full bg-[#FF453A] active:scale-95 active:opacity-55 text-white flex items-center justify-center shrink-0 transition-all"
                >
                  <Power className="w-[18px] h-[18px]" />
                </button>
                <span className="font-display font-bold text-[17px] text-white">ريموت</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={`w-[6px] h-[6px] rounded-full ${
                    transport === 'ir' || tvState.power ? 'bg-[#2C8EF8]' : 'bg-[#5A5A5E]'
                  }`}
                />
                <span className="text-[11px] font-medium tracking-[0.3px] text-[#8A8A8E]">
                  {transport === 'ir' ? 'IR جاهز' : tvState.power ? 'متصل Wi-Fi' : 'غير متصل'}
                </span>
              </div>
            </div>

            {/* شريط إشعار رفيع ارتفاع 28 */}
            <div className="h-[28px] px-3 flex items-center">
              <div className="w-full h-[24px] rounded-[14px] border border-[#2C8EF8] bg-[#2C8EF8]/12 px-3 flex items-center justify-center">
                <span className="text-[11px] font-medium text-white truncate">
                  {lastSignal.commandLabel}
                </span>
              </div>
            </div>

            {/* محتوى التبويب النشط */}
            {activeTab === 'tv' ? (
              <div className="px-3 pt-1 pb-3 flex flex-col justify-between gap-3.5">
                {/* [ب] شريط الوضع (IR / Wi-Fi) — كبسولة مزدوجة ارتفاع 38 */}
                <div className="h-[38px] rounded-full bg-[#0E0E10] border border-[#232326] p-[3px] grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    aria-label="وضع الأشعة تحت الحمراء"
                    onClick={() => setTransport('ir')}
                    className={`rounded-full text-[11px] tracking-[0.3px] border transition-all active:opacity-55 ${
                      transport === 'ir'
                        ? 'bg-[#2C8EF8]/15 border-[#2C8EF8] text-white font-semibold'
                        : 'border-transparent text-[#8A8A8E] font-medium'
                    }`}
                  >
                    IR
                  </button>
                  <button
                    type="button"
                    aria-label="وضع الواي فاي"
                    onClick={() => setTransport('wifi')}
                    className={`rounded-full text-[11px] tracking-[0.3px] border transition-all active:opacity-55 ${
                      transport === 'wifi'
                        ? 'bg-[#2C8EF8]/15 border-[#2C8EF8] text-white font-semibold'
                        : 'border-transparent text-[#8A8A8E] font-medium'
                    }`}
                  >
                    Wi-Fi
                  </button>
                </div>

                {/* [ج] صف الماركة أو الجهاز — ارتفاع 36 فقط */}
                {transport === 'ir' ? (
                  <div className="h-[36px] grid grid-cols-2 gap-2">
                    {(['samsung', 'lg'] as TvIrBrand[]).map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setIrBrand(b)}
                        className={`h-[36px] rounded-full border text-[14px] font-semibold transition-all active:opacity-55 ${
                          irBrand === b
                            ? 'bg-[#2C8EF8]/15 border-[#2C8EF8] text-white'
                            : 'bg-[#161618] border-[#232326] text-[#8A8A8E]'
                        }`}
                      >
                        {b === 'samsung' ? 'Samsung' : 'LG'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSettingsModal(true)}
                    className="h-[36px] w-full rounded-full bg-[#161618] border border-[#232326] px-3 flex items-center justify-between gap-2 transition-all active:opacity-55"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-[6px] h-[6px] rounded-full shrink-0 ${
                          tvState.power ? 'bg-[#2C8EF8]' : 'bg-[#5A5A5E]'
                        }`}
                      />
                      <span className="text-[11px] font-medium text-white truncate">
                        {wifiIp} · {wifiProtocol === 'roku' ? 'Roku ECP' : 'Android TV'}
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-[#2C8EF8] shrink-0">إعداد</span>
                  </button>
                )}

                {/* [د] الكتلة المركزية: [صوت 60×186] [D-Pad 200×200] [قناة 60×186] */}
                <div className="flex items-center justify-center gap-[12px]">
                  {/* كبسولة الصوت (يمين في RTL) */}
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-medium tracking-[0.3px] text-[#8A8A8E]">
                      صوت
                    </span>
                    <div className="w-[60px] h-[186px] rounded-[30px] bg-[#161618] border border-[#232326] flex flex-col items-center justify-between overflow-hidden">
                      <button
                        type="button"
                        aria-label="رفع الصوت"
                        onClick={() => sendTvCommand('VOL_UP', 'رفع الصوت')}
                        className="w-full flex-1 flex items-center justify-center text-white active:scale-95 active:opacity-55 transition-all"
                      >
                        <Plus className="w-[18px] h-[18px]" />
                      </button>
                      <Volume2 className="w-[20px] h-[20px] text-[#5A5A5E] pointer-events-none" />
                      <button
                        type="button"
                        aria-label="خفض الصوت"
                        onClick={() => sendTvCommand('VOL_DOWN', 'خفض الصوت')}
                        className="w-full flex-1 flex items-center justify-center text-white active:scale-95 active:opacity-55 transition-all"
                      >
                        <Minus className="w-[18px] h-[18px]" />
                      </button>
                    </div>
                  </div>

                  {/* دائرة D-Pad 200×200 */}
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] opacity-0 select-none">·</span>
                    <div className="w-[200px] h-[200px] rounded-full bg-[#161618] border border-[#232326] flex flex-col items-center justify-center overflow-hidden">
                      <button
                        type="button"
                        aria-label="أعلى"
                        onClick={() => sendTvCommand('UP', 'أعلى')}
                        className="w-[88px] h-[62px] flex items-center justify-center text-[#8A8A8E] hover:text-white active:scale-95 active:opacity-55 transition-all"
                      >
                        <ArrowUp className="w-5 h-5" />
                      </button>
                      <div className="flex items-center justify-center">
                        <button
                          type="button"
                          aria-label="يمين"
                          onClick={() => sendTvCommand('RIGHT', 'يمين')}
                          className="w-[62px] h-[88px] flex items-center justify-center text-[#8A8A8E] hover:text-white active:scale-95 active:opacity-55 transition-all"
                        >
                          <ArrowRight className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          aria-label="موافق"
                          onClick={() => sendTvCommand('OK', 'موافق')}
                          className="w-[72px] h-[72px] rounded-full bg-[#000000] border-[1.5px] border-[#2C8EF8] text-white font-extrabold text-[14px] shrink-0 active:scale-95 active:opacity-55 transition-all"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          aria-label="يسار"
                          onClick={() => sendTvCommand('LEFT', 'يسار')}
                          className="w-[62px] h-[88px] flex items-center justify-center text-[#8A8A8E] hover:text-white active:scale-95 active:opacity-55 transition-all"
                        >
                          <ArrowLeft className="w-5 h-5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label="أسفل"
                        onClick={() => sendTvCommand('DOWN', 'أسفل')}
                        className="w-[88px] h-[62px] flex items-center justify-center text-[#8A8A8E] hover:text-white active:scale-95 active:opacity-55 transition-all"
                      >
                        <ArrowDown className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* كبسولة القناة (يسار في RTL) */}
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-medium tracking-[0.3px] text-[#8A8A8E]">
                      قناة
                    </span>
                    <div className="w-[60px] h-[186px] rounded-[30px] bg-[#161618] border border-[#232326] flex flex-col items-center justify-between overflow-hidden">
                      <button
                        type="button"
                        aria-label="قناة أعلى"
                        onClick={() => sendTvCommand('CH_UP', 'قناة أعلى')}
                        className="w-full flex-1 flex items-center justify-center text-white active:scale-95 active:opacity-55 transition-all"
                      >
                        <ChevronUp className="w-[18px] h-[18px]" />
                      </button>
                      <Tv className="w-[20px] h-[20px] text-[#5A5A5E] pointer-events-none" />
                      <button
                        type="button"
                        aria-label="قناة أسفل"
                        onClick={() => sendTvCommand('CH_DOWN', 'قناة أسفل')}
                        className="w-full flex-1 flex items-center justify-center text-white active:scale-95 active:opacity-55 transition-all"
                      >
                        <ChevronDown className="w-[18px] h-[18px]" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* [هـ] شريط سفلي واحد — 4 أزرار دائرية 52×52 */}
                <div className="flex items-center justify-center gap-[20px]">
                  <button
                    type="button"
                    aria-label="رجوع"
                    onClick={() => sendTvCommand('BACK', 'رجوع')}
                    className="w-[52px] h-[52px] rounded-full bg-[#161618] border border-[#232326] text-white flex items-center justify-center active:scale-95 active:opacity-55 transition-all"
                  >
                    <CornerUpLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="الرئيسية"
                    onClick={() => sendTvCommand('HOME', 'الرئيسية')}
                    className="w-[52px] h-[52px] rounded-full bg-[#161618] border border-[#232326] text-white flex items-center justify-center active:scale-95 active:opacity-55 transition-all"
                  >
                    <Home className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="القائمة"
                    onClick={() => sendTvCommand('MENU', 'القائمة')}
                    className="w-[52px] h-[52px] rounded-full bg-[#161618] border border-[#232326] text-white flex items-center justify-center active:scale-95 active:opacity-55 transition-all"
                  >
                    <Menu className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="المصدر"
                    onClick={() => sendTvCommand('INPUT', 'المصدر')}
                    className="w-[52px] h-[52px] rounded-full bg-[#161618] border border-[#232326] text-white flex items-center justify-center active:scale-95 active:opacity-55 transition-all"
                  >
                    <Radio className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3 space-y-3.5">
                {/* ماركة المكيف */}
                <div className="grid grid-cols-2 gap-2">
                  {(['gree', 'carrier'] as AcBrand[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setAcBrand(b)}
                      className={`h-[38px] rounded-full border text-[14px] font-semibold transition-all active:opacity-55 ${
                        acBrand === b
                          ? 'border-[#2C8EF8] bg-[#2C8EF8]/15 text-white'
                          : 'border-[#232326] bg-[#161618] text-[#8A8A8E]'
                      }`}
                    >
                      {b === 'gree' ? 'Gree AC' : 'Carrier AC'}
                    </button>
                  ))}
                </div>

                {/* شاشة التكييف الرقمية */}
                <div
                  className={`rounded-[18px] bg-[#0E0E10] border border-[#232326] p-4 text-center space-y-1.5 transition-opacity ${
                    acState.power ? 'opacity-100' : 'opacity-45'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-[#8A8A8E]">
                    <span>الوضع: {currentAcModeLabel}</span>
                    <span>المروحة: {FAN_LABELS[acState.fanSpeed]}</span>
                  </div>
                  <div className="text-[64px] leading-none font-light tabular-nums text-white py-1">
                    {acState.power ? `${acState.temperature}°C` : 'OFF'}
                  </div>
                  <div className="text-[11px] font-medium text-[#8A8A8E]">
                    توجيه الهواء: {acState.swing ? 'متحرك' : 'ثابت'} · IR 38kHz
                  </div>
                </div>

                {/* صف الطاقة والحرارة: [−] [زر دائري 64px] [+] */}
                <div className="flex items-center justify-center gap-4">
                  <button
                    type="button"
                    aria-label="خفض الحرارة"
                    onClick={() => {
                      const nextTemp = Math.max(16, acState.temperature - 1);
                      if (nextTemp !== acState.temperature) {
                        emitAcState(
                          { ...acState, power: true, temperature: nextTemp },
                          'خفض الحرارة'
                        );
                      }
                    }}
                    className="w-[64px] h-[64px] rounded-full bg-[#161618] border border-[#232326] text-white flex items-center justify-center active:scale-95 active:opacity-55 transition-all"
                  >
                    <Minus className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    aria-label="الطاقة"
                    onClick={() => {
                      const nextPower = !acState.power;
                      emitAcState(
                        { ...acState, power: nextPower },
                        nextPower ? 'تشغيل المكيف' : 'إطفاء المكيف'
                      );
                    }}
                    className="w-[64px] h-[64px] rounded-full bg-[#FF453A] text-white flex items-center justify-center active:scale-95 active:opacity-55 transition-all"
                  >
                    <Power className="w-6 h-6" />
                  </button>

                  <button
                    type="button"
                    aria-label="رفع الحرارة"
                    onClick={() => {
                      const nextTemp = Math.min(30, acState.temperature + 1);
                      if (nextTemp !== acState.temperature) {
                        emitAcState(
                          { ...acState, power: true, temperature: nextTemp },
                          'رفع الحرارة'
                        );
                      }
                    }}
                    className="w-[64px] h-[64px] rounded-full bg-[#161618] border border-[#232326] text-white flex items-center justify-center active:scale-95 active:opacity-55 transition-all"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {/* شريط أوضاع التشغيل الأفقي الموحّد */}
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-[#8A8A8E]">وضع التشغيل</div>
                  <div className="flex bg-[#0E0E10] border border-[#232326] rounded-[14px] p-[3px] gap-[3px]">
                    {AC_MODES.map((m) => {
                      const active = acState.mode === m.key;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() =>
                            emitAcState({ ...acState, power: true, mode: m.key }, `وضع ${m.label}`)
                          }
                          className={`flex-1 h-[40px] rounded-[11px] border text-[11px] flex items-center justify-center transition-all active:opacity-55 ${
                            active
                              ? 'border-[#2C8EF8] bg-[#2C8EF8]/15 text-white font-semibold'
                              : 'border-transparent text-[#8A8A8E] font-medium'
                          }`}
                        >
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* المروحة والتأرجح */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const order: FanSpeed[] = ['auto', 'low', 'medium', 'high'];
                      const nextFan = order[(order.indexOf(acState.fanSpeed) + 1) % order.length];
                      emitAcState(
                        { ...acState, power: true, fanSpeed: nextFan },
                        `المروحة: ${FAN_LABELS[nextFan]}`
                      );
                    }}
                    className="h-[58px] rounded-[14px] bg-[#161618] border border-[#232326] p-2 flex flex-col items-center justify-center gap-0.5 active:opacity-55"
                  >
                    <span className="text-[11px] text-[#8A8A8E] flex items-center gap-1">
                      <Fan className="w-3 h-3" />
                      سرعة المروحة
                    </span>
                    <span className="text-[13px] font-semibold text-white">
                      {FAN_LABELS[acState.fanSpeed]}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const nextSwing = !acState.swing;
                      emitAcState(
                        { ...acState, power: true, swing: nextSwing },
                        nextSwing ? 'تفعيل التأرجح' : 'إيقاف التأرجح'
                      );
                    }}
                    className="h-[58px] rounded-[14px] bg-[#161618] border border-[#232326] p-2 flex flex-col items-center justify-center gap-0.5 active:opacity-55"
                  >
                    <span className="text-[11px] text-[#8A8A8E]">تأرجح الريش</span>
                    <span className="text-[13px] font-semibold text-white">
                      {acState.swing ? 'يعمل' : 'متوقف'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* [و] شريط التبويب السفلي بارتفاع 52 وحد علوي فقط */}
            <div className="h-[52px] grid grid-cols-2 gap-2 px-3 py-1.5 bg-[#000000] border-t border-[#232326]">
              <button
                type="button"
                onClick={() => setActiveTab('tv')}
                className={`rounded-full border text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap active:opacity-55 ${
                  activeTab === 'tv'
                    ? 'bg-[#2C8EF8]/15 border-[#2C8EF8] text-white'
                    : 'bg-[#161618] border-[#232326] text-[#8A8A8E]'
                }`}
              >
                <Tv className="w-4 h-4" />
                <span>الشاشة</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ac')}
                className={`rounded-full border text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap active:opacity-55 ${
                  activeTab === 'ac'
                    ? 'bg-[#2C8EF8]/15 border-[#2C8EF8] text-white'
                    : 'bg-[#161618] border-[#232326] text-[#8A8A8E]'
                }`}
              >
                <Snowflake className="w-4 h-4" />
                <span>التكييف</span>
              </button>
            </div>

            {/* نافذة إعدادات الاتصال والماركة (WifiSheet) */}
            {showSettingsModal && (
              <div className="absolute inset-0 z-30 bg-black/85 flex items-center justify-center p-4">
                <div className="w-full rounded-[18px] bg-[#0E0E10] border border-[#232326] p-4 space-y-3">
                  <div className="text-[17px] font-bold text-white">إعدادات الشاشة والاتصال</div>
                  <div className="grid grid-cols-2 gap-1 p-[3px] rounded-full bg-[#161618] border border-[#232326]">
                    <button
                      type="button"
                      onClick={() => setTransport('ir')}
                      className={`h-[40px] rounded-full border text-[13px] font-semibold flex items-center justify-center gap-1.5 ${
                        transport === 'ir'
                          ? 'bg-[#2C8EF8]/15 border-[#2C8EF8] text-white'
                          : 'border-transparent text-[#8A8A8E]'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>أشعة IR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransport('wifi')}
                      className={`h-[40px] rounded-full border text-[13px] font-semibold flex items-center justify-center gap-1.5 ${
                        transport === 'wifi'
                          ? 'bg-[#2C8EF8]/15 border-[#2C8EF8] text-white'
                          : 'border-transparent text-[#8A8A8E]'
                      }`}
                    >
                      <Wifi className="w-3.5 h-3.5" />
                      <span>واي فاي</span>
                    </button>
                  </div>

                  {transport === 'ir' ? (
                    <div className="grid grid-cols-2 gap-2">
                      {(['samsung', 'lg'] as TvIrBrand[]).map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setIrBrand(b)}
                          className={`h-[44px] rounded-full border text-[13px] font-semibold ${
                            irBrand === b
                              ? 'border-[#2C8EF8] bg-[#2C8EF8]/15 text-white'
                              : 'border-[#232326] bg-[#161618] text-[#8A8A8E]'
                          }`}
                        >
                          {b === 'samsung' ? 'Samsung (0x0707)' : 'LG TV (NEC)'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setWifiProtocol('roku')}
                          className={`h-[44px] rounded-full border text-[13px] font-semibold ${
                            wifiProtocol === 'roku'
                              ? 'border-[#2C8EF8] bg-[#2C8EF8]/15 text-white'
                              : 'border-[#232326] bg-[#161618] text-[#8A8A8E]'
                          }`}
                        >
                          Roku ECP
                        </button>
                        <button
                          type="button"
                          onClick={() => setWifiProtocol('android_tv')}
                          className={`h-[44px] rounded-full border text-[13px] font-semibold ${
                            wifiProtocol === 'android_tv'
                              ? 'border-[#2C8EF8] bg-[#2C8EF8]/15 text-white'
                              : 'border-[#232326] bg-[#161618] text-[#8A8A8E]'
                          }`}
                        >
                          Android TV
                        </button>
                      </div>
                      <input
                        type="text"
                        dir="ltr"
                        value={wifiIp}
                        onChange={(e) => setWifiIp(e.target.value)}
                        aria-label="عنوان IP الشاشة الذكية"
                        className="w-full h-[44px] px-3 rounded-[14px] bg-[#161618] border border-[#232326] text-xs font-mono text-white focus:outline-none focus:border-[#2C8EF8]"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowSettingsModal(false)}
                    className="w-full h-[46px] rounded-[14px] bg-[#161618] border border-[#2C8EF8] text-white text-[14px] font-semibold"
                  >
                    تم
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* العمود الثاني: حالة الجهاز الافتراضي + راسم إشارة الـ IR والشبكة */}
      <div className="lg:col-span-7 space-y-5">
        {/* لوحة استجابة الجهاز المستهدف الحية */}
        <div className="rounded-2xl bg-[#131720] border border-[#1E2532] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-lg text-slate-100">
                استجابة الجهاز المستهدف (المحاكاة الحية)
              </h2>
              <p className="text-sm text-slate-400">
                جرّب الأزرار في الهاتف لمشاهدة تحديث الشاشة أو التكييف وفحص الحزمة المرسلة فعلياً
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onSelectSourceFile(
                  activeTab === 'ac'
                    ? 'ac-remote-screen-js'
                    : transport === 'wifi'
                    ? 'wifi-service-js'
                    : 'ir-module-kt'
                )
              }
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#1A202C] hover:bg-[#232B3A] border border-[#2A3446] text-xs font-medium text-sky-400 flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Code2 className="w-4 h-4" />
              <span>معاينة الكود المسؤول</span>
            </button>
          </div>

          {activeTab === 'tv' ? (
            <div className="rounded-xl bg-[#0B0D11] border border-[#1E2532] p-5 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  الحالة: {tvState.power ? 'قيد التشغيل' : 'وضع الاستعداد'} ·{' '}
                  {INPUT_SOURCES[tvState.inputIndex]}
                </span>
                <span className="font-mono tabular-nums">
                  {transport === 'ir'
                    ? irBrand === 'samsung'
                      ? 'Samsung IR'
                      : 'LG IR'
                    : `${wifiProtocol.toUpperCase()} · ${wifiIp}`}
                </span>
              </div>

              <div className="py-5 px-4 rounded-lg bg-[#11151E] border border-[#1C2330] text-center space-y-2">
                <div className="text-xl font-display font-semibold text-slate-100">
                  {tvState.power ? tvState.screenNotice : 'الشاشة مغلقة'}
                </div>
                {tvState.power && (
                  <div className="flex items-center justify-center gap-6 text-sm text-slate-400 tabular-nums font-mono pt-1">
                    <span>CH {String(tvState.channel).padStart(3, '0')}</span>
                    <span aria-hidden="true">·</span>
                    <span>VOL {tvState.muted ? 'MUTE' : `${tvState.volume}%`}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-[#0B0D11] border border-[#1E2532] p-5 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  المكيف: {acBrand === 'gree' ? 'Gree Split AC' : 'Carrier Split AC'} ·{' '}
                  {acState.power ? 'يعمل' : 'متوقف'}
                </span>
                <span>توجيه الريش: {acState.swing ? 'تلقائي متحرك' : 'ثابت'}</span>
              </div>

              <div className="grid grid-cols-3 gap-4 py-4 px-4 rounded-lg bg-[#11151E] border border-[#1C2330] text-center">
                <div>
                  <div className="text-xs text-slate-400 mb-1">درجة الحرارة</div>
                  <div className="text-2xl font-mono font-bold tabular-nums text-slate-100">
                    {acState.power ? `${acState.temperature}°C` : 'OFF'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">وضع التشغيل</div>
                  <div className="text-lg font-semibold text-sky-400">{currentAcModeLabel}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">سرعة المروحة</div>
                  <div className="text-lg font-semibold text-slate-200">
                    {FAN_LABELS[acState.fanSpeed]}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* عارض إشارة الـ IR أو حزمة الواي فاي */}
        <div className="rounded-2xl bg-[#131720] border border-[#1E2532] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display font-semibold text-base text-slate-100">
              {lastSignal.transport === 'ir'
                ? 'راسم نبضات ConsumerIrManager (ميكروثانية)'
                : 'حمولة طلب الشبكة المحلية (Wi-Fi Payload)'}
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {lastSignal.timestamp}
            </span>
          </div>

          {lastSignal.transport === 'ir' ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-[#0B0D11] border border-[#1E2532] p-3">
                <svg
                  viewBox="0 0 320 42"
                  className="w-full h-14 overflow-visible"
                  role="img"
                  aria-label="مخطط نبضات الأشعة تحت الحمراء"
                >
                  <line x1="0" y1="34" x2="320" y2="34" stroke="#1E2532" strokeWidth="1" />
                  <polyline
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="2"
                    strokeLinejoin="miter"
                    points={irWavePoints}
                  />
                </svg>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-[#0B0D11] border border-[#1E2532] p-3">
                  <div className="text-slate-400 mb-1">تردد الحامل</div>
                  <div className="font-mono font-semibold tabular-nums text-slate-100">
                    {lastSignal.carrierHz?.toLocaleString('en-US')} Hz
                  </div>
                </div>
                <div className="rounded-lg bg-[#0B0D11] border border-[#1E2532] p-3">
                  <div className="text-slate-400 mb-1">عدد النبضات</div>
                  <div className="font-mono font-semibold tabular-nums text-slate-100">
                    {lastSignal.pattern?.length || 0} نبضة
                  </div>
                </div>
                <div className="rounded-lg bg-[#0B0D11] border border-[#1E2532] p-3">
                  <div className="text-slate-400 mb-1">الدالة المستدعاة</div>
                  <div className="font-mono font-semibold text-red-400 truncate">
                    transmitIR()
                  </div>
                </div>
              </div>

              <div
                dir="ltr"
                className="rounded-lg bg-[#0B0D11] border border-[#1E2532] p-3 font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-nowrap tabular-nums"
              >
                pattern = [{lastSignal.pattern?.slice(0, 14).join(', ')}
                {(lastSignal.pattern?.length || 0) > 14 ? ', ...' : ''}]
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                dir="ltr"
                className="rounded-xl bg-[#0B0D11] border border-[#1E2532] p-4 font-mono text-xs text-sky-300 overflow-x-auto"
              >
                {lastSignal.wifiEndpointOrPayload}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>الخدمة: src/services/wifiRemoteService.js</span>
                <span className="font-mono">
                  {wifiProtocol === 'roku' ? 'HTTP REST (Port 8060)' : 'WebSocket (Port 8080)'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
