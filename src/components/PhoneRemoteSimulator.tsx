import React, { useMemo, useState } from 'react';
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
  LogIn,
  Menu,
  Minus,
  Plus,
  Power,
  Radio,
  SlidersHorizontal,
  Snowflake,
  Sun,
  Tv,
  Volume2,
  VolumeX,
  Wifi,
  Wind,
  Droplets,
  Sparkles,
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
          <div className="rounded-[24px] bg-[#000000] border border-[#2C2C2E] overflow-hidden flex flex-col relative">
            {/* شريط عنوان تطبيق الأندرويد */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="font-display font-bold text-base text-[#F5F5F7]">ريموت</span>
            </div>

            {/* محتوى التبويب النشط */}
            {activeTab === 'tv' ? (
              <div className="px-4 py-3 flex flex-col justify-between gap-3">
                {/* 1) هيدر: كبسولة الجهاز + أيقونة الإعدادات + نص IR/Wi-Fi + زر الطاقة 50px */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col items-start gap-0.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setShowSettingsModal(true)}
                      className="min-h-[48px] max-w-full px-4 rounded-full bg-[#111114] border border-[#363642] flex items-center gap-2 text-sm font-semibold text-[#F5F5F7] hover:border-[#0A84FF] transition-colors"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          transport === 'ir' || tvState.power ? 'bg-[#30D158]' : 'bg-[#636366]'
                        }`}
                      />
                      <span className="truncate">
                        {transport === 'ir'
                          ? irBrand === 'samsung'
                            ? 'Samsung (0x0707)'
                            : 'LG TV (NEC)'
                          : wifiProtocol === 'roku'
                          ? 'Roku ECP'
                          : 'Android TV'}
                      </span>
                      <SlidersHorizontal className="w-3.5 h-3.5 text-[#8E8E93] shrink-0" />
                    </button>
                    <span className="text-[11px] font-semibold text-[#8E8E93] px-3">
                      {transport === 'ir' ? 'IR' : 'Wi-Fi'}
                    </span>
                  </div>

                  <button
                    type="button"
                    aria-label="طاقة"
                    onClick={() => sendTvCommand('POWER', 'الطاقة')}
                    className="w-[50px] h-[50px] rounded-full bg-[#FF3B30] border border-[#FF3B30]/40 hover:opacity-90 active:scale-95 text-white flex items-center justify-center shrink-0 transition-all shadow-lg shadow-black/40"
                  >
                    <Power className="w-5 h-5" />
                  </button>
                </div>

                {/* 2) قرص التنقل الدائري (204px) مع حلقة داخلية وزر OK */}
                <div className="relative mx-auto w-[204px] h-[204px] rounded-full bg-[#111114] border-[1.5px] border-[#363642] p-1 flex flex-col items-center justify-between shadow-lg shadow-black/40">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-[30px] rounded-full border border-[#26262E]"
                  />
                  <button
                    type="button"
                    aria-label="أعلى"
                    onClick={() => sendTvCommand('UP', 'أعلى')}
                    className="relative z-10 w-full min-h-[54px] flex-1 flex items-center justify-center text-[#EBEBF0] hover:text-white active:scale-90 transition-all"
                  >
                    <ArrowUp className="w-[18px] h-[18px]" />
                  </button>
                  <div className="relative z-10 w-full min-h-[72px] flex items-center justify-between">
                    <button
                      type="button"
                      aria-label="يمين"
                      onClick={() => sendTvCommand('RIGHT', 'يمين')}
                      className="flex-1 min-w-[48px] min-h-[54px] flex items-center justify-center text-[#EBEBF0] hover:text-white active:scale-90 transition-all"
                    >
                      <ArrowRight className="w-[18px] h-[18px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => sendTvCommand('OK', 'موافق')}
                      className="w-[70px] h-[70px] rounded-full bg-[#0A84FF] border-[3px] border-black hover:opacity-90 active:scale-95 text-white font-extrabold text-sm tracking-wider shrink-0 transition-all shadow-md"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      aria-label="يسار"
                      onClick={() => sendTvCommand('LEFT', 'يسار')}
                      className="flex-1 min-w-[48px] min-h-[54px] flex items-center justify-center text-[#EBEBF0] hover:text-white active:scale-90 transition-all"
                    >
                      <ArrowLeft className="w-[18px] h-[18px]" />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="أسفل"
                    onClick={() => sendTvCommand('DOWN', 'أسفل')}
                    className="relative z-10 w-full min-h-[54px] flex-1 flex items-center justify-center text-[#EBEBF0] hover:text-white active:scale-90 transition-all"
                  >
                    <ArrowDown className="w-[18px] h-[18px]" />
                  </button>
                </div>

                {/* 3) صف 4 أزرار دائرية 48px مع تسميات دقيقة */}
                <div className="flex items-center justify-evenly">
                  {[
                    { key: 'BACK', label: 'رجوع', icon: CornerUpLeft },
                    { key: 'HOME', label: 'رئيسية', icon: Home },
                    { key: 'MENU', label: 'قائمة', icon: Menu },
                  ].map(({ key, label, icon: IconComp }) => (
                    <div key={key} className="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={label}
                        onClick={() => sendTvCommand(key, label)}
                        className="w-[48px] h-[48px] rounded-full bg-[#1A1A1F] border border-[#363642] text-[#EBEBF0] flex items-center justify-center active:scale-90 transition-all"
                      >
                        <IconComp className="w-[18px] h-[18px]" />
                      </button>
                      <span className="text-[11px] font-semibold text-[#8E8E93]">{label}</span>
                    </div>
                  ))}
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      aria-label="كتم الصوت"
                      onClick={() => sendTvCommand('MUTE', 'كتم الصوت')}
                      className="w-[48px] h-[48px] rounded-full bg-[#1A1A1F] border border-[#363642] text-[#EBEBF0] flex items-center justify-center active:scale-90 transition-all"
                    >
                      {tvState.muted ? (
                        <VolumeX className="w-[18px] h-[18px]" />
                      ) : (
                        <Volume2 className="w-[18px] h-[18px]" />
                      )}
                    </button>
                    <span className="text-[11px] font-semibold text-[#8E8E93]">كتم</span>
                  </div>
                </div>

                {/* 4) ذراعا الصوت (يمين) والقنوات (شمال) مع زر المصدر في المنتصف */}
                <div className="flex items-center justify-evenly">
                  <div className="w-[72px] h-[140px] rounded-[36px] bg-[#1A1A1F] border border-[#363642] flex flex-col items-center justify-between py-0.5 overflow-hidden">
                    <button
                      type="button"
                      aria-label="رفع الصوت"
                      onClick={() => sendTvCommand('VOL_UP', 'رفع الصوت')}
                      className="w-full min-h-[50px] flex-1 flex items-center justify-center text-[#F5F5F7] active:scale-90"
                    >
                      <Plus className="w-[17px] h-[17px]" />
                    </button>
                    <div className="flex flex-col items-center gap-0.5 pointer-events-none">
                      <span className="w-6 h-px bg-[#26262E]" />
                      <Volume2 className="w-3.5 h-3.5 text-[#8E8E93]" />
                      <span className="text-[10px] font-semibold text-[#8E8E93]">الصوت</span>
                      <span className="w-6 h-px bg-[#26262E]" />
                    </div>
                    <button
                      type="button"
                      aria-label="خفض الصوت"
                      onClick={() => sendTvCommand('VOL_DOWN', 'خفض الصوت')}
                      className="w-full min-h-[50px] flex-1 flex items-center justify-center text-[#F5F5F7] active:scale-90"
                    >
                      <Minus className="w-[17px] h-[17px]" />
                    </button>
                  </div>

                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      aria-label="تبديل مصدر الإدخال HDMI"
                      onClick={() => sendTvCommand('INPUT', 'المصدر')}
                      className="w-[48px] h-[48px] rounded-full bg-[#1A1A1F] border border-[#363642] text-[#EBEBF0] flex items-center justify-center active:scale-90 transition-all"
                    >
                      <LogIn className="w-[18px] h-[18px]" />
                    </button>
                    <span className="text-[11px] font-semibold text-[#8E8E93]">المصدر</span>
                  </div>

                  <div className="w-[72px] h-[140px] rounded-[36px] bg-[#1A1A1F] border border-[#363642] flex flex-col items-center justify-between py-0.5 overflow-hidden">
                    <button
                      type="button"
                      aria-label="القناة التالية"
                      onClick={() => sendTvCommand('CH_UP', 'القناة التالية')}
                      className="w-full min-h-[50px] flex-1 flex items-center justify-center text-[#F5F5F7] active:scale-90"
                    >
                      <ChevronUp className="w-[17px] h-[17px]" />
                    </button>
                    <div className="flex flex-col items-center gap-0.5 pointer-events-none">
                      <span className="w-6 h-px bg-[#26262E]" />
                      <Tv className="w-3.5 h-3.5 text-[#8E8E93]" />
                      <span className="text-[10px] font-semibold text-[#8E8E93]">القنوات</span>
                      <span className="w-6 h-px bg-[#26262E]" />
                    </div>
                    <button
                      type="button"
                      aria-label="القناة السابقة"
                      onClick={() => sendTvCommand('CH_DOWN', 'القناة السابقة')}
                      className="w-full min-h-[50px] flex-1 flex items-center justify-center text-[#F5F5F7] active:scale-90"
                    >
                      <ChevronDown className="w-[17px] h-[17px]" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {/* ماركة المكيف */}
                <div className="grid grid-cols-2 gap-2">
                  {(['gree', 'carrier'] as AcBrand[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setAcBrand(b)}
                      className={`min-h-[48px] rounded-xl border text-xs font-semibold transition-colors ${
                        acBrand === b
                          ? 'border-[#0A84FF] bg-[#0A84FF]/20 text-white'
                          : 'border-[#1E2532] bg-[#131720] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {b === 'gree' ? 'Gree AC' : 'Carrier AC'}
                    </button>
                  ))}
                </div>

                {/* شاشة التكييف الرقمية */}
                <div
                  className={`rounded-2xl bg-[#0F172A] border border-[#1E293B] p-5 text-center space-y-2 transition-opacity ${
                    acState.power ? 'opacity-100' : 'opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>الوضع: {currentAcModeLabel}</span>
                    <span>المروحة: {FAN_LABELS[acState.fanSpeed]}</span>
                  </div>
                  <div className="text-5xl font-mono font-bold tabular-nums text-slate-100 tracking-tight py-1">
                    {acState.power ? `${acState.temperature}°C` : 'OFF'}
                  </div>
                  <div className="text-xs text-sky-400">
                    توجيه الهواء: {acState.swing ? 'متحرك' : 'ثابت'} · IR 38kHz
                  </div>
                </div>

                {/* أزرار الطاقة ورفع/خفض الحرارة */}
                <div className="grid grid-cols-3 gap-2.5">
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
                    className="min-h-[54px] rounded-xl bg-[#1A202C] hover:bg-[#252E3E] active:scale-95 border border-[#263042] text-slate-100 flex items-center justify-center transition-all"
                  >
                    <Minus className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const nextPower = !acState.power;
                      emitAcState(
                        { ...acState, power: nextPower },
                        nextPower ? 'تشغيل المكيف' : 'إطفاء المكيف'
                      );
                    }}
                    className={`min-h-[54px] rounded-xl font-bold text-sm text-white active:scale-95 transition-all ${
                      acState.power ? 'bg-[#FF3B30] hover:opacity-90' : 'bg-[#0A84FF] hover:opacity-90'
                    }`}
                  >
                    {acState.power ? 'إطفاء' : 'تشغيل'}
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
                    className="min-h-[54px] rounded-xl bg-[#1A202C] hover:bg-[#252E3E] active:scale-95 border border-[#263042] text-slate-100 flex items-center justify-center transition-all"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {/* أوضاع التشغيل */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-400">وضع التشغيل</div>
                  <div className="grid grid-cols-3 gap-2">
                    {AC_MODES.map((m) => {
                      const active = acState.mode === m.key;
                      const ModeIcon =
                        m.key === 'cool'
                          ? Snowflake
                          : m.key === 'heat'
                          ? Sun
                          : m.key === 'dry'
                          ? Droplets
                          : m.key === 'fan'
                          ? Wind
                          : Sparkles;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() =>
                            emitAcState({ ...acState, power: true, mode: m.key }, `وضع ${m.label}`)
                          }
                          className={`min-h-[48px] rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                            active
                              ? 'border-[#0A84FF] bg-[#0A84FF]/20 text-white'
                              : 'border-[#1E2532] bg-[#131720] text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <ModeIcon className="w-3.5 h-3.5" />
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* المروحة والتأرجح */}
                <div className="grid grid-cols-2 gap-2.5">
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
                    className="min-h-[58px] rounded-xl bg-[#131720] hover:bg-[#1A202C] border border-[#1E2532] p-2.5 flex flex-col items-center justify-center gap-1"
                  >
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Fan className="w-3.5 h-3.5" />
                      سرعة المروحة
                    </span>
                    <span className="text-xs font-bold text-slate-100">
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
                    className="min-h-[58px] rounded-xl bg-[#131720] hover:bg-[#1A202C] border border-[#1E2532] p-2.5 flex flex-col items-center justify-center gap-1"
                  >
                    <span className="text-[11px] text-slate-400">تأرجح الريش</span>
                    <span className="text-xs font-bold text-slate-100">
                      {acState.swing ? 'يعمل' : 'متوقف'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* شريط التبويب السفلي */}
            <div className="grid grid-cols-2 gap-2.5 p-2.5 bg-[#0A0A0C] border-t border-[#1C1C1E]">
              <button
                type="button"
                onClick={() => setActiveTab('tv')}
                className={`min-h-[48px] rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                  activeTab === 'tv'
                    ? 'bg-[#0A84FF] text-white font-bold'
                    : 'bg-[#141416] text-[#8E8E93] hover:text-white'
                }`}
              >
                <Tv className="w-4 h-4" />
                <span>الشاشة</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ac')}
                className={`min-h-[48px] rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                  activeTab === 'ac'
                    ? 'bg-[#0A84FF] text-white font-bold'
                    : 'bg-[#141416] text-[#8E8E93] hover:text-white'
                }`}
              >
                <Snowflake className="w-4 h-4" />
                <span>التكييف</span>
              </button>
            </div>

            {/* نافذة إعدادات الاتصال والماركة (WifiSheet) */}
            {showSettingsModal && (
              <div className="absolute inset-0 z-30 bg-black/80 flex items-center justify-center p-4">
                <div className="w-full rounded-[22px] bg-[#141416] border border-[#2C2C2E] p-4 space-y-3">
                  <div className="text-sm font-bold text-[#F5F5F7]">إعدادات الشاشة والاتصال</div>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-[#1C1C1E]">
                    <button
                      type="button"
                      onClick={() => setTransport('ir')}
                      className={`min-h-[48px] rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 ${
                        transport === 'ir' ? 'bg-[#0A84FF] text-white' : 'text-[#8E8E93]'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>أشعة IR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransport('wifi')}
                      className={`min-h-[48px] rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 ${
                        transport === 'wifi' ? 'bg-[#0A84FF] text-white' : 'text-[#8E8E93]'
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
                          className={`min-h-[48px] rounded-full border text-xs font-semibold ${
                            irBrand === b
                              ? 'border-[#0A84FF] bg-[#0A84FF]/20 text-white'
                              : 'border-transparent bg-[#1C1C1E] text-[#8E8E93]'
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
                          className={`min-h-[48px] rounded-full border text-xs font-semibold ${
                            wifiProtocol === 'roku'
                              ? 'border-[#0A84FF] bg-[#0A84FF]/20 text-white'
                              : 'border-transparent bg-[#1C1C1E] text-[#8E8E93]'
                          }`}
                        >
                          Roku ECP
                        </button>
                        <button
                          type="button"
                          onClick={() => setWifiProtocol('android_tv')}
                          className={`min-h-[48px] rounded-full border text-xs font-semibold ${
                            wifiProtocol === 'android_tv'
                              ? 'border-[#0A84FF] bg-[#0A84FF]/20 text-white'
                              : 'border-transparent bg-[#1C1C1E] text-[#8E8E93]'
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
                        className="w-full min-h-[48px] px-3 rounded-xl bg-[#1C1C1E] text-xs font-mono text-[#F5F5F7] focus:outline-none focus:ring-1 focus:ring-[#0A84FF]"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowSettingsModal(false)}
                    className="w-full min-h-[48px] rounded-xl bg-[#0A84FF] text-white text-sm font-bold"
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
