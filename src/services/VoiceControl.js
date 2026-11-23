import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

const IS_WEB = Platform.OS === 'web';
const VoiceNative =
  NativeModules && NativeModules.VoiceModule ? NativeModules.VoiceModule : null;

const MAX_LISTEN_MS = 10000;

class VoiceControlService {
  constructor() {
    this.emitter = !IS_WEB && VoiceNative ? new NativeEventEmitter(VoiceNative) : null;
    this.subscriptions = [];
    this.webRecognition = null;
    this.safetyTimer = null;
    this.isListening = false;
    this.latestTranscript = '';
  }

  _clearTimers() {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }

  _removeNativeSubscriptions() {
    while (this.subscriptions.length > 0) {
      const sub = this.subscriptions.pop();
      try {
        if (sub && typeof sub.remove === 'function') {
          sub.remove();
        }
      } catch (_) {
        // ignore
      }
    }
  }

  async isSupported() {
    if (IS_WEB) {
      if (typeof window === 'undefined') return false;
      return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    }
    if (Platform.OS !== 'android' || !VoiceNative) {
      return false;
    }
    try {
      if (typeof VoiceNative.isAvailable === 'function') {
        return Boolean(await VoiceNative.isAvailable());
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async requestMicPermission() {
    if (IS_WEB) {
      return true;
    }
    if (Platform.OS !== 'android') {
      return false;
    }
    try {
      const alreadyGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      if (alreadyGranted) {
        return true;
      }
      const status = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'صلاحية المايكروفون',
          message: 'يحتاج الريموت الصوتي إلى إذن المايكروفون للاستماع لأوامرك بالعامية المصرية.',
          buttonPositive: 'سماح',
          buttonNegative: 'رفض',
        }
      );
      return status === PermissionsAndroid.RESULTS.GRANTED;
    } catch (_) {
      return false;
    }
  }

  async startSession({
    language = 'ar-EG',
    onReady,
    onPartial,
    onResult,
    onError,
    onEnd,
    onRms,
  } = {}) {
    await this.cancelSession();
    this.latestTranscript = '';

    const supported = await this.isSupported();
    if (!supported) {
      const msg = IS_WEB
        ? 'المتصفح الحالي لا يدعم التعرف الصوتي (جرّب Google Chrome أو Edge).'
        : 'خدمة التعرف الصوتي غير متاحة على هذا الجهاز. تأكد من تفعيل خدمة Google للتعرف على الكلام.';
      if (onError) onError({ code: 'UNAVAILABLE', message: msg });
      return false;
    }

    const granted = await this.requestMicPermission();
    if (!granted) {
      if (onError) {
        onError({
          code: 'PERMISSION_DENIED',
          message: 'يرجى منح صلاحية المايكروفون لاستخدام الريموت الصوتي.',
        });
      }
      return false;
    }

    if (IS_WEB) {
      return this._startWebSession({
        language,
        onReady,
        onPartial,
        onResult,
        onError,
        onEnd,
      });
    }

    return this._startAndroidSession({
      language,
      onReady,
      onPartial,
      onResult,
      onError,
      onEnd,
      onRms,
    });
  }

  _startWebSession({
    language,
    onReady,
    onPartial,
    onResult,
    onError,
    onEnd,
  }) {
    const SpeechRec =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRec) {
      if (onError) {
        onError({
          code: 'UNAVAILABLE',
          message: 'واجهة SpeechRecognition غير متوفرة في هذا المتصفح.',
        });
      }
      return false;
    }

    let settled = false;
    const recognition = new SpeechRec();
    recognition.lang = language || 'ar-EG';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    this.webRecognition = recognition;
    this.isListening = true;

    this._clearTimers();
    this.safetyTimer = setTimeout(() => {
      if (this.isListening) {
        this.stopSession();
      }
    }, MAX_LISTEN_MS);

    recognition.onstart = () => {
      if (onReady) onReady();
    };

    recognition.onresult = (event) => {
      let interimText = '';
      let finalText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const res = event.results[i];
        const transcript = res && res[0] ? String(res[0].transcript || '').trim() : '';
        if (!transcript) continue;
        if (res.isFinal) {
          finalText = `${finalText} ${transcript}`.trim();
        } else {
          interimText = `${interimText} ${transcript}`.trim();
        }
      }

      const combined = (finalText || interimText).trim();
      if (combined) {
        this.latestTranscript = combined;
      }

      if (finalText) {
        settled = true;
        this.isListening = false;
        this._clearTimers();
        if (onResult) onResult(finalText);
      } else if (interimText && onPartial) {
        onPartial(interimText);
      }
    };

    recognition.onerror = (event) => {
      settled = true;
      this.isListening = false;
      this._clearTimers();
      const errCode = event && event.error ? String(event.error) : 'UNKNOWN';
      if (errCode === 'aborted') return;
      const msg =
        errCode === 'not-allowed' || errCode === 'service-not-allowed'
          ? 'تم رفض إذن المايكروفون في المتصفح.'
          : errCode === 'no-speech'
          ? 'لم نسمع أي صوت واضح. حاول التحدث مجدداً.'
          : errCode === 'network'
          ? 'تعذر الاتصال بخدمة التعرف الصوتي عبر الشبكة.'
          : 'حدث خطأ أثناء التعرف الصوتي.';
      if (onError) onError({ code: errCode, message: msg });
    };

    recognition.onend = () => {
      this.isListening = false;
      this._clearTimers();
      this.webRecognition = null;
      if (!settled && this.latestTranscript) {
        settled = true;
        if (onResult) onResult(this.latestTranscript);
      } else if (!settled && onEnd) {
        onEnd();
      }
    };

    try {
      recognition.start();
      return true;
    } catch (_) {
      this.isListening = false;
      this._clearTimers();
      this.webRecognition = null;
      if (onError) {
        onError({
          code: 'START_FAILED',
          message: 'تعذر تشغيل المايكروفون حالياً.',
        });
      }
      return false;
    }
  }

  async _startAndroidSession({
    language,
    onReady,
    onPartial,
    onResult,
    onError,
    onEnd,
    onRms,
  }) {
    if (!VoiceNative || !this.emitter) {
      if (onError) {
        onError({
          code: 'MISSING_NATIVE_MODULE',
          message: 'وحدة VoiceModule غير مسجلة في هذا الإصدار.',
        });
      }
      return false;
    }

    this._removeNativeSubscriptions();
    let settled = false;

    this.subscriptions.push(
      this.emitter.addListener('onVoiceReady', () => {
        if (onReady) onReady();
      }),
      this.emitter.addListener('onVoiceRms', (payload) => {
        if (onRms && payload) onRms(Number(payload.rms) || 0);
      }),
      this.emitter.addListener('onVoicePartial', (payload) => {
        const text = payload && payload.transcript ? String(payload.transcript).trim() : '';
        if (text) {
          this.latestTranscript = text;
          if (onPartial) onPartial(text);
        }
      }),
      this.emitter.addListener('onVoiceResult', (payload) => {
        settled = true;
        this.isListening = false;
        this._clearTimers();
        this._removeNativeSubscriptions();
        const text = payload && payload.transcript ? String(payload.transcript).trim() : '';
        const resolved = text || this.latestTranscript;
        if (resolved) {
          if (onResult) onResult(resolved);
        } else if (onError) {
          onError({
            code: 'NO_MATCH',
            message: 'لم نسمع أمراً واضحاً. حاول التحدث بوضوح مجدداً.',
          });
        }
      }),
      this.emitter.addListener('onVoiceError', (payload) => {
        settled = true;
        this.isListening = false;
        this._clearTimers();
        this._removeNativeSubscriptions();
        const code = payload && payload.code ? String(payload.code) : 'ERROR';
        if ((code === 'ERROR_NO_MATCH' || code === 'ERROR_SPEECH_TIMEOUT') && this.latestTranscript) {
          if (onResult) onResult(this.latestTranscript);
          return;
        }
        if (onError) {
          onError({
            code,
            message:
              (payload && payload.message) ||
              'لم نسمع أمراً واضحاً. حاول التحدث مجدداً.',
          });
        }
      }),
      this.emitter.addListener('onVoiceEnd', () => {
        if (!settled && onEnd) {
          onEnd();
        }
      })
    );

    this.isListening = true;
    this._clearTimers();
    this.safetyTimer = setTimeout(() => {
      if (this.isListening) {
        this.stopSession();
      }
    }, MAX_LISTEN_MS);

    try {
      await VoiceNative.startListening(language || 'ar-EG');
      return true;
    } catch (err) {
      this.isListening = false;
      this._clearTimers();
      this._removeNativeSubscriptions();
      if (onError) {
        onError({
          code: 'NATIVE_START_ERROR',
          message:
            (err && err.message) || 'تعذر بدء التعرف الصوتي على جهاز الأندرويد.',
        });
      }
      return false;
    }
  }

  async stopSession() {
    this._clearTimers();
    this.isListening = false;
    if (IS_WEB) {
      if (this.webRecognition) {
        try {
          this.webRecognition.stop();
        } catch (_) {
          // ignore
        }
      }
      return;
    }
    if (VoiceNative && typeof VoiceNative.stopListening === 'function') {
      try {
        await VoiceNative.stopListening();
      } catch (_) {
        // ignore
      }
    }
  }

  async cancelSession() {
    this._clearTimers();
    this.isListening = false;
    this.latestTranscript = '';
    if (IS_WEB) {
      if (this.webRecognition) {
        try {
          this.webRecognition.abort();
        } catch (_) {
          // ignore
        }
        this.webRecognition = null;
      }
      return;
    }
    this._removeNativeSubscriptions();
    if (VoiceNative && typeof VoiceNative.cancelListening === 'function') {
      try {
        await VoiceNative.cancelListening();
      } catch (_) {
        // ignore
      }
    }
  }
}

export const VoiceControl = new VoiceControlService();
export default VoiceControl;
