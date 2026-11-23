const ARABIC_DIGIT_MAP = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

const WORD_NUMBER_MAP = {
  واحد: 1,
  واحده: 1,
  مره: 1,
  درجه: 1,
  تكه: 1,
  اتنين: 2,
  اثنين: 2,
  اثنان: 2,
  تنين: 2,
  درجتين: 2,
  تكتين: 2,
  مرتين: 2,
  تلاته: 3,
  ثلاثه: 3,
  تلات: 3,
  ثلاث: 3,
  اربعه: 4,
  اربع: 4,
  خمسه: 5,
  خمس: 5,
  سته: 6,
  ست: 6,
  سبعه: 7,
  سبع: 7,
  تمانيه: 8,
  ثمانيه: 8,
  تمن: 8,
  تسعه: 9,
  تسع: 9,
  عشره: 10,
  عشر: 10,
  حداشر: 11,
  اتناشر: 12,
  تلتاشر: 13,
  اربعتاشر: 14,
  خمستاشر: 15,
  ستاشر: 16,
  سبعتاشر: 17,
  تمنتاشر: 18,
  تسعتاشر: 19,
  عشرين: 20,
  عشرون: 20,
  تلاتين: 30,
  ثلاثين: 30,
  اربعين: 40,
  خمسين: 50,
};

export function normalizeEgyptianArabic(rawText) {
  const convertedDigits = String(rawText || '').replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGIT_MAP[d] || d);
  return convertedDigits
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\u0600-\u06FF0-9a-zA-Z\s.:/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractNumberFromText(normalizedText) {
  if (!normalizedText) return null;
  const digitMatch = normalizedText.match(/(?:^|\s)(\d{1,3})(?=\s|$)/);
  if (digitMatch && digitMatch[1]) {
    const n = Number(digitMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const tokens = normalizedText.split(/\s+/);
  for (const token of tokens) {
    if (WORD_NUMBER_MAP[token] !== undefined) {
      return WORD_NUMBER_MAP[token];
    }
  }
  return null;
}

function extractVolumeStepCount(normalizedText) {
  const explicitNum = extractNumberFromText(normalizedText);
  if (explicitNum !== null) {
    return Math.max(1, Math.min(25, explicitNum));
  }
  if (/(?:^|\s)(?:كتير|جامد|اوي|قوي|خالص|جدا)(?=\s|$)/.test(normalizedText)) {
    return 6;
  }
  if (/(?:^|\s)(?:شويه|حبه|بسيط)(?=\s|$)/.test(normalizedText)) {
    return 3;
  }
  return 1;
}

export function parseEgyptianDurationMinutes(normalizedText) {
  if (!normalizedText) return null;

  if (/(?:^|\s)ساعه\s*و\s*نص(?:ف)?(?=\s|$)/.test(normalizedText)) return 90;
  if (/(?:^|\s)ساعه\s*الا\s*ربع(?=\s|$)/.test(normalizedText)) return 45;
  if (/(?:^|\s)ساعه\s*الا\s*(?:تلت|ثلث)(?=\s|$)/.test(normalizedText)) return 40;
  if (/(?:^|\s)ساعه\s*و\s*ربع(?=\s|$)/.test(normalizedText)) return 75;
  if (/(?:^|\s)ساعه\s*و\s*(?:تلت|ثلث)(?=\s|$)/.test(normalizedText)) return 80;
  if (/(?:^|\s)(?:نص|نصف)\s*ساعه(?=\s|$)/.test(normalizedText)) return 30;
  if (/(?:^|\s)(?:تلت|ثلث)\s*ساعه(?=\s|$)/.test(normalizedText)) return 20;
  if (/(?:^|\s)ربع\s*ساعه(?=\s|$)/.test(normalizedText)) return 15;
  if (/(?:^|\s)ساعتين(?=\s|$)/.test(normalizedText)) return 120;

  const hoursMatch = normalizedText.match(/(?:^|\s)(\d+|[\u0600-\u06FF]+)\s*(?:ساعه|ساعات)(?=\s|$)/);
  if (hoursMatch) {
    const hVal = Number(hoursMatch[1]) || WORD_NUMBER_MAP[hoursMatch[1]];
    if (hVal && hVal > 0) {
      return Math.min(720, hVal * 60);
    }
  }
  if (/(?:^|\s)ساعه(?=\s|$)/.test(normalizedText)) return 60;

  if (/(?:^|\s)دقيقتين(?=\s|$)/.test(normalizedText)) return 2;
  const minsMatch = normalizedText.match(
    /(?:^|\s)(\d+|[\u0600-\u06FF]+)\s*(?:دقيقه|دقايق|دقائق|د)(?=\s|$)/
  );
  if (minsMatch) {
    const mVal = Number(minsMatch[1]) || WORD_NUMBER_MAP[minsMatch[1]];
    if (mVal && mVal > 0) {
      return Math.min(720, mVal);
    }
  }
  if (/(?:^|\s)دقيقه(?=\s|$)/.test(normalizedText)) return 1;

  return null;
}

export function parseSeekStepCount(normalizedText) {
  if (!normalizedText) return 2;

  let seconds = 0;

  if (/(?:^|\s)(?:نص|نصف)\s*دقيقه(?=\s|$)/.test(normalizedText)) {
    seconds = 30;
  } else if (/(?:^|\s)ربع\s*دقيقه(?=\s|$)/.test(normalizedText)) {
    seconds = 15;
  } else if (/(?:^|\s)دقيقتين(?=\s|$)/.test(normalizedText)) {
    seconds = 120;
  } else if (/(?:^|\s)دقيقه\s*و\s*نص(?:ف)?(?=\s|$)/.test(normalizedText)) {
    seconds = 90;
  } else {
    const minsMatch = normalizedText.match(
      /(?:^|\s)(\d+|[\u0600-\u06FF]+)\s*(?:دقيقه|دقايق|دقائق)(?=\s|$)/
    );
    if (minsMatch) {
      const mVal = Number(minsMatch[1]) || WORD_NUMBER_MAP[minsMatch[1]];
      if (mVal && mVal > 0) {
        seconds = mVal * 60;
      }
    } else if (/(?:^|\s)دقيقه(?=\s|$)/.test(normalizedText)) {
      seconds = 60;
    }
  }

  if (seconds === 0) {
    const secsMatch = normalizedText.match(
      /(?:^|\s)(\d+|[\u0600-\u06FF]+)\s*(?:ثانيه|ثواني|ث)(?=\s|$)/
    );
    if (secsMatch) {
      const sVal = Number(secsMatch[1]) || WORD_NUMBER_MAP[secsMatch[1]];
      if (sVal && sVal > 0) {
        seconds = sVal;
      }
    } else if (/(?:^|\s)ثانيه(?=\s|$)/.test(normalizedText)) {
      seconds = 10;
    }
  }

  if (seconds > 0) {
    return Math.max(1, Math.min(10, Math.round(seconds / 10) || 1));
  }

  const rawNum = extractNumberFromText(normalizedText);
  if (rawNum !== null) {
    return Math.max(1, Math.min(10, rawNum));
  }
  if (/(?:^|\s)(?:كتير|جامد|اوي)(?=\s|$)/.test(normalizedText)) {
    return 5;
  }
  return 2;
}

function stripPlaybackPrefixesAndFillers(rawOriginalText) {
  let cleaned = String(rawOriginalText || '').trim();
  const prefixPatterns = [
    /^(?:من فضلك|لو سمحت|ممكن|يا ريت)\s+/i,
    /^(?:عايز|عاوز|نفسي|محتاج)\s+(?:اشوف|اسمع|اتفرج علي|اتفرج على|اشغل|شغل)\s+/i,
    /^(?:شغّل|شغل|هات|اسمع|افتح|ابحث عن|دوّر على|دور على|دور علي|وريني|اعرض)\s+(?:لي|لنا|فيديو|مقطع|قناه|قناة|مسلسل|فيلم)?\s*/i,
  ];
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const regex of prefixPatterns) {
      const next = cleaned.replace(regex, '').trim();
      if (next !== cleaned) {
        cleaned = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  cleaned = cleaned
    .replace(/\s+(?:على|علي|في|من)\s+(?:اليوتيوب|يوتيوب|الشاشه|الشاشة|التلفزيون)$/i, '')
    .replace(/\s+(?:من فضلك|لو سمحت)$/i, '')
    .trim();

  return cleaned;
}

export function parseEgyptianVoiceCommand(rawText) {
  const original = String(rawText || '').trim();
  const norm = normalizeEgyptianArabic(original);

  if (!norm || norm.length < 2) {
    return {
      type: 'UNKNOWN',
      rawText: original,
      normalizedText: norm,
      label: 'لم يتم التعرف على أمر واضح',
      confirmDelayMs: 0,
    };
  }

  // 1. إلغاء مؤقت النوم صوتياً
  if (
    /(?:^|\s)(?:الغي|الغاء|وقف|ايقاف|شيل|امسح|اقفل)\s+(?:ال)?(?:موقت|تايمر|موقت النوم|موقت الشاشه)(?=\s|$)/.test(
      norm
    )
  ) {
    return {
      type: 'CANCEL_TV_SLEEP_TIMER',
      rawText: original,
      normalizedText: norm,
      label: 'إلغاء مؤقت إغلاق الشاشة',
      confirmDelayMs: 1200,
    };
  }

  // 2. مؤقت إغلاق الشاشة (أولوية قبل الإغلاق الفوري)
  if (
    /(?:^|\s)(?:اقفل|اطفي|طفي|سكر|افصل|موقت)(?=\s|$)/.test(norm) &&
    /(?:^|\s)(?:بعد|كمان|خلال|موقت|تايمر)(?=\s|$)/.test(norm)
  ) {
    const minutes = parseEgyptianDurationMinutes(norm);
    if (minutes && minutes > 0) {
      return {
        type: 'TV_SLEEP_TIMER',
        minutes,
        rawText: original,
        normalizedText: norm,
        label: `إغلاق الشاشة بعد ${minutes} دقيقة`,
        confirmDelayMs: 1200,
      };
    }
  }

  // 3. أوامر الطاقة: إغلاق أو فتح الشاشة (POWER)
  const powerOffPattern =
    /^(?:لو سمحت\s+|من فضلك\s+)?(?:اقفل|اطفي|طفي|سكر|افصل)(?:\s+لي)?(?:\s+(?:الشاشه|التلفزيون|التلفاز|التي في|الجهاز))?(?:\s+دلوقتي|\s+لو سمحت)?$/;
  const powerOnPattern =
    /^(?:لو سمحت\s+|من فضلك\s+)?(?:افتح|شغل|ولع|نور)(?:\s+لي)?\s+(?:الشاشه|التلفزيون|التلفاز|التي في|الجهاز)(?:\s+دلوقتي|\s+لو سمحت)?$/;

  if (powerOffPattern.test(norm) || powerOnPattern.test(norm)) {
    const isOpening = powerOnPattern.test(norm);
    return {
      type: 'TV_COMMAND',
      commandKey: 'POWER',
      isDestructive: true,
      rawText: original,
      normalizedText: norm,
      label: isOpening ? 'تشغيل الشاشة (Power)' : 'إغلاق الشاشة (Power)',
      confirmDelayMs: 2500,
    };
  }

  // 4. كتم / استعادة الصوت
  if (
    /(?:^|\s)(?:اكتم الصوت|اكتم|كتم الصوت|كتم|صامت|ميوت|رجع الصوت|شيل الكتم|فك الكتم|الغاء الكتم|الغي الكتم|افتح الصوت)(?=\s|$)/.test(
      norm
    )
  ) {
    const isUnmute = /(?:^|\s)(?:رجع الصوت|شيل الكتم|فك الكتم|الغاء الكتم|الغي الكتم|افتح الصوت)(?=\s|$)/.test(
      norm
    );
    return {
      type: 'TV_COMMAND',
      commandKey: 'MUTE',
      rawText: original,
      normalizedText: norm,
      label: isUnmute ? 'إلغاء كتم الصوت' : 'كتم الصوت',
      confirmDelayMs: 1200,
    };
  }

  // 5. رفع / خفض الصوت مع التمييز الصارم بين «علّي» (فعل رفع) و«على» (حرف جر لمستوى ثابت مثل: خلي الصوت على 20)
  const startsWithMediaRequestPrefix =
    /^(?:شغل|هات|عايز اسمع|عاوز اسمع|عايز اشوف|عاوز اشوف|اسمع|ابحث عن|دور على|دور علي|افتح فيديو)(?=\s|$)/.test(
      norm
    );

  const hasVolumeWord = /(?:^|\s)(?:صوت|الصوت)(?=\s|$)/.test(norm);
  const explicitVolumeNum = extractNumberFromText(norm);

  // رصد أوامر ضبط مستوى ثابت (مثل: خلي الصوت على 20 درجة / اضبط الصوت على 15 / الصوت على 20)
  const isSetAbsoluteVolumeVerb =
    /(?:^|\s)(?:خلي|خليلي|اجعل|اضبط|ظبط|حط|ثبت|وصل|وصللي|اعمل)(?=\s|$)/.test(norm) &&
    hasVolumeWord &&
    !/(?:^|\s)(?:عالي|اعلي|اعلى|واطي|اوصف|يعلي|يوطي)(?=\s|$)/.test(norm);
  const hasPrepositionTargetAfterVolume =
    /(?:^|\s)(?:صوت|الصوت)\s+(?:علي|ل|الي|عند|لحد)\s*(?:\d+|[\u0600-\u06FF]+)(?=\s|$)/.test(
      norm
    ) && explicitVolumeNum !== null;

  if (!startsWithMediaRequestPrefix && (isSetAbsoluteVolumeVerb || hasPrepositionTargetAfterVolume)) {
    return {
      type: 'UNSUPPORTED_ABSOLUTE_VOLUME',
      targetLevel: explicitVolumeNum,
      rawText: original,
      normalizedText: norm,
      label:
        explicitVolumeNum !== null
          ? `لا يمكن ضبط الصوت مباشرة على ${explicitVolumeNum}`
          : 'تعديل الصوت نسبي فقط (رفع أو خفض)',
      confirmDelayMs: 0,
    };
  }

  // يجب أن يأتي فعل «علّي» في موضع الفعل (بداية الجملة أو بعد كلمة تهذيب) أو بصيغة صريحة (ارفع/زود/اعلي/عليلي)
  const hasAliAsRaiseVerb =
    /^(?:(?:لو سمحت|من فضلك|ممكن|يا ريت)\s+)?(?:علي|عللي|عليلي)(?=\s|$)/.test(norm) ||
    /(?:^|\s)(?:ارفع|زود|اعلي|اعلى|عليلي)(?=\s|$)/.test(norm);

  const hasVolumeOrMagnitudeCue =
    hasVolumeWord ||
    /(?:^|\s)(?:شويه|حبه|كتير|جامد|درجه|درجات|تكه|فوق|تحت|اوي|جدا)(?=\s|$)/.test(norm) ||
    explicitVolumeNum !== null;

  const isVolumeDownVerb = /(?:^|\s)(?:وطي|وطيلي|خفض|نزل|قلل)(?=\s|$)/.test(norm);

  const isVolumeDownCommand =
    !startsWithMediaRequestPrefix &&
    isVolumeDownVerb &&
    (hasVolumeOrMagnitudeCue ||
      /^(?:وطي|وطيلي|خفض|نزل|قلل)(?:\s+(?:الصوت|شويه|حبه|كتير|درجه|درجات|\d+))?$/.test(norm));

  const isVolumeUpCommand =
    !startsWithMediaRequestPrefix &&
    !isVolumeDownCommand &&
    hasAliAsRaiseVerb &&
    (hasVolumeOrMagnitudeCue ||
      /^(?:(?:لو سمحت|من فضلك|ممكن|يا ريت)\s+)?(?:علي|عللي|عليلي|ارفع|زود|اعلي|اعلى)$/.test(
        norm
      ));

  if (isVolumeUpCommand || isVolumeDownCommand) {
    const count = extractVolumeStepCount(norm);
    const isUp = isVolumeUpCommand;
    return {
      type: 'TV_REPEATED_COMMAND',
      commandKey: isUp ? 'VOL_UP' : 'VOL_DOWN',
      count,
      rawText: original,
      normalizedText: norm,
      label: isUp
        ? count > 1
          ? `رفع الصوت ${count} درجات`
          : 'رفع الصوت'
        : count > 1
        ? `خفض الصوت ${count} درجات`
        : 'خفض الصوت',
      confirmDelayMs: 1200,
    };
  }

  // 6. التقديم والترجيع داخل الفيديو (ضغطات RIGHT / LEFT متتالية بمعدل ضغطة لكل 10 ثوانٍ بحد أقصى 10)
  const isSeekForward =
    /^(?:قدم|جري|فوت|طلع قدام|امشي قدام)(?:\s+(?:الفيديو|المقطع))?(?:\s+(?:شويه|حبه|كتير|جامد|\d+.*|دقيق.*|ثاني.*|نص.*|ربع.*))?$/.test(
      norm
    );
  const isSeekBackward =
    /^(?:رجع|اخر|ارجع بالفيديو|رجع الفيديو|ارجع لورا)(?:\s+(?:الفيديو|المقطع|لورا))?(?:\s+(?:شويه|حبه|كتير|جامد|\d+.*|دقيق.*|ثاني.*|نص.*|ربع.*))?$/.test(
      norm
    ) && !/^(?:ارجع|رجوع)$/.test(norm);

  if (isSeekForward || isSeekBackward) {
    const steps = parseSeekStepCount(norm);
    return {
      type: 'TV_REPEATED_COMMAND',
      commandKey: isSeekForward ? 'RIGHT' : 'LEFT',
      count: steps,
      rawText: original,
      normalizedText: norm,
      label: isSeekForward
        ? `تقديم الفيديو (${steps * 10} ثانية)`
        : `ترجيع الفيديو (${steps * 10} ثانية)`,
      confirmDelayMs: 1200,
    };
  }

  // 7. الإيقاف المؤقت والاستئناف (PAUSE / PLAY)
  if (/^(?:وقف|وقفي|وقف الفيديو|ثبت|ايقاف مؤقت|بوز|اعمل بوز)$/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'PAUSE',
      rawText: original,
      normalizedText: norm,
      label: 'إيقاف مؤقت (Pause)',
      confirmDelayMs: 1200,
    };
  }

  if (/^(?:كمل|كملي|كمل الفيديو|كمل تشغيل|شغل تاني|استيناف|شغل|شغل الفيديو)$/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'PLAY',
      rawText: original,
      normalizedText: norm,
      label: 'استئناف التشغيل (Play)',
      confirmDelayMs: 1200,
    };
  }

  // 8. التنقل والقنوات والمصدر
  if (/^(?:ارجع|رجوع|الخطوه اللي فاتت|ارجع ورا|وراء|باك)$/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'BACK',
      rawText: original,
      normalizedText: norm,
      label: 'رجوع (Back)',
      confirmDelayMs: 1200,
    };
  }

  if (
    /^(?:الصفحه الرييسيه|الشاشه الرييسيه|الرييسيه|هوم|اطلع بره|القايمه الرييسيه)$/.test(
      norm
    )
  ) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'HOME',
      rawText: original,
      normalizedText: norm,
      label: 'الصفحة الرئيسية (Home)',
      confirmDelayMs: 1200,
    };
  }

  if (/^(?:القايمه|الاعدادات|مينيو)$/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'MENU',
      rawText: original,
      normalizedText: norm,
      label: 'القائمة (Menu)',
      confirmDelayMs: 1200,
    };
  }

  if (/^(?:موافق|اوك|اوكي|تمام|اختار|دوس موافق)$/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'OK',
      rawText: original,
      normalizedText: norm,
      label: 'موافق (OK)',
      confirmDelayMs: 1200,
    };
  }

  if (/(?:^|\s)(?:المصدر|غير المصدر|هات الاتش دي|اتش دي|hdmi|سورس)(?=\s|$)/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'INPUT',
      rawText: original,
      normalizedText: norm,
      label: 'تبديل المصدر (Source)',
      confirmDelayMs: 1200,
    };
  }

  if (
    /(?:^|\s)(?:القناه اللي بعدها|القناه الجايه|هات القناه اللي بعدها|اقلب القناه|غير القناه|القناه التاليه)(?=\s|$)/.test(
      norm
    )
  ) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'CH_UP',
      rawText: original,
      normalizedText: norm,
      label: 'القناة التالية',
      confirmDelayMs: 1200,
    };
  }

  if (/(?:^|\s)(?:القناه اللي قبلها|القناه السابقه|هات القناه اللي فاتت)(?=\s|$)/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'CH_DOWN',
      rawText: original,
      normalizedText: norm,
      label: 'القناة السابقة',
      confirmDelayMs: 1200,
    };
  }

  // 9. فتح التطبيقات والمتصفح
  if (/^(?:افتح|شغل|هات)\s+(?:تطبيق\s+)?(?:اليوتيوب|يوتيوب|youtube)(?:\s+على الشاشه)?$/.test(norm)) {
    return {
      type: 'LAUNCH_YOUTUBE',
      rawText: original,
      normalizedText: norm,
      label: 'فتح تطبيق يوتيوب',
      confirmDelayMs: 1200,
    };
  }

  if (/^(?:افتح|شغل|هات)\s+(?:تطبيق\s+)?(?:نتفلكس|نتفليكس|netflix)$/.test(norm)) {
    return {
      type: 'TV_COMMAND',
      commandKey: 'NETFLIX',
      rawText: original,
      normalizedText: norm,
      label: 'فتح نتفلكس',
      confirmDelayMs: 1200,
    };
  }

  const browserMatch = norm.match(
    /^(?:افتح|شغل|هات)\s+(?:المتصفح|الانترنت|جوجل|البراوزر)(?:\s+(.+))?$/
  );
  if (browserMatch) {
    const extraTarget = (browserMatch[1] || '').trim();
    const targetUrl = !extraTarget
      ? 'https://www.google.com'
      : /^https?:\/\//i.test(extraTarget)
      ? extraTarget
      : /\.[a-z]{2,10}$/i.test(extraTarget)
      ? `https://${extraTarget}`
      : `https://www.google.com/search?q=${encodeURIComponent(extraTarget)}`;
    return {
      type: 'OPEN_BROWSER',
      url: targetUrl,
      rawText: original,
      normalizedText: norm,
      label: 'فتح متصفح الشاشة',
      confirmDelayMs: 1200,
    };
  }

  // 10. تشغيل محتوى يوتيوب مباشرة في الخلفية
  const cleanQuery = stripPlaybackPrefixesAndFillers(original);
  if (cleanQuery && cleanQuery.length >= 2) {
    return {
      type: 'YOUTUBE_DIRECT_PLAY',
      query: cleanQuery,
      rawText: original,
      normalizedText: norm,
      label: `تشغيل على يوتيوب: ${cleanQuery}`,
      confirmDelayMs: 1800,
    };
  }

  return {
    type: 'UNKNOWN',
    rawText: original,
    normalizedText: norm,
    label: 'لم يتم فهم الأمر الصوتي',
    confirmDelayMs: 0,
  };
}

export default {
  normalizeEgyptianArabic,
  parseEgyptianDurationMinutes,
  parseSeekStepCount,
  parseEgyptianVoiceCommand,
};
