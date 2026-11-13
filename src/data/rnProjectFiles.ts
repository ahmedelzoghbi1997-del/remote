export type ProjectFileCategory = 'android' | 'services' | 'ui' | 'cicd';

export interface ProjectFileEntry {
  id: string;
  path: string;
  titleAr: string;
  category: ProjectFileCategory;
  language: 'kotlin' | 'javascript' | 'xml' | 'gradle' | 'yaml' | 'json' | 'markdown';
  summaryAr: string;
  content: string;
}

export const CATEGORY_LABELS: Record<'all' | ProjectFileCategory, string> = {
  all: 'جميع الملفات',
  android: 'أندرويد Kotlin',
  services: 'خدمات IR والواي فاي',
  ui: 'واجهة React Native',
  cicd: 'CI/CD والإعدادات',
};

export const RN_PROJECT_FILES: ProjectFileEntry[] = [
  {
    id: 'ir-module-kt',
    path: 'android/app/src/main/java/com/universalremote/IrManagerModule.kt',
    titleAr: 'وحدة جسر الأشعة تحت الحمراء الأصلية (Kotlin)',
    category: 'android',
    language: 'kotlin',
    summaryAr:
      'جسر Native Module يربط ConsumerIrManager في أندرويد بـ React Native مع فحص العتاد، قراءة الترددات المدعومة، وإرسال النبضات الزمنية أو أكواد Pronto Hex.',
    content: `package com.universalremote

import android.content.Context
import android.hardware.ConsumerIrManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors
import kotlin.math.roundToInt

@ReactModule(name = IrManagerModule.NAME)
class IrManagerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "IrManagerModule"
        private const val MIN_IR_API_LEVEL = Build.VERSION_CODES.KITKAT
        private const val PRONTO_TIMEBASE_CONSTANT = 0.241246
    }

    private val irExecutor = Executors.newSingleThreadExecutor()

    private val irManager: ConsumerIrManager? by lazy {
        if (Build.VERSION.SDK_INT >= MIN_IR_API_LEVEL) {
            reactApplicationContext.getSystemService(Context.CONSUMER_IR_SERVICE) as? ConsumerIrManager
        } else {
            null
        }
    }

    override fun getName(): String = NAME

    /**
     * التحقق من وجود مستشعر الأشعة تحت الحمراء في الهاتف
     */
    @ReactMethod
    fun hasIrEmitter(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < MIN_IR_API_LEVEL) {
                promise.resolve(false)
                return
            }
            val available = irManager?.hasIrEmitter() == true
            promise.resolve(available)
        } catch (ex: Exception) {
            promise.reject("IR_CHECK_ERROR", "فشل التحقق من مستشعر الأشعة تحت الحمراء: \${ex.message}", ex)
        }
    }

    /**
     * جلب نطاقات التردد المدعومة من شريحة الـ IR بالهرتز (Hz)
     */
    @ReactMethod
    fun getCarrierFrequencies(promise: Promise) {
        try {
            val manager = irManager
            if (manager == null || !manager.hasIrEmitter()) {
                promise.reject("IR_UNAVAILABLE", "الهاتف لا يحتوي على مستشعر IR Blaster فعال.")
                return
            }

            val resultArray = Arguments.createArray()
            val ranges = manager.carrierFrequencies ?: emptyArray()
            for (range in ranges) {
                val map = Arguments.createMap().apply {
                    putInt("minFrequency", range.minFrequency)
                    putInt("maxFrequency", range.maxFrequency)
                }
                resultArray.pushMap(map)
            }
            promise.resolve(resultArray)
        } catch (ex: SecurityException) {
            promise.reject("IR_PERMISSION_DENIED", "صلاحية TRANSMIT_IR غير مفعلة في AndroidManifest.", ex)
        } catch (ex: Exception) {
            promise.reject("IR_FREQ_ERROR", "تعذر جلب الترددات المدعومة: \${ex.message}", ex)
        }
    }

    /**
     * إرسال نبضات الـ IR بصيغة مصفوفة أزمنة بالميكروثانية [Mark, Space, ...]
     * @param pattern مصفوفة أعداد صحيحة تمثل مدد التشغيل والإطفاء بالميكروثانية
     * @param carrierFrequency تردد الحامل بالهرتز (غالباً 38000 هرتز)
     */
    @ReactMethod
    fun transmitIR(pattern: ReadableArray, carrierFrequency: Int, promise: Promise) {
        val manager = irManager
        if (manager == null || !manager.hasIrEmitter()) {
            promise.reject("IR_UNAVAILABLE", "مستشعر الأشعة تحت الحمراء غير متوفر على هذا الجهاز.")
            return
        }

        if (pattern.size() == 0) {
            promise.reject("IR_INVALID_PATTERN", "نمط النبضات فارغ ولا يمكن إرساله.")
            return
        }

        if (carrierFrequency <= 0) {
            promise.reject("IR_INVALID_FREQUENCY", "تردد الحامل غير صالح: \$carrierFrequency Hz")
            return
        }

        val intPattern = IntArray(pattern.size())
        for (i in 0 until pattern.size()) {
            val duration = pattern.getInt(i)
            if (duration <= 0) {
                promise.reject("IR_INVALID_PULSE", "جميع قيم النبضات يجب أن تكون أكبر من صفر عند الفهرس \$i.")
                return
            }
            intPattern[i] = duration
        }

        irExecutor.execute {
            try {
                manager.transmit(carrierFrequency, intPattern)
                val response = Arguments.createMap().apply {
                    putBoolean("transmitted", true)
                    putInt("carrierFrequency", carrierFrequency)
                    putInt("pulseCount", intPattern.size)
                }
                promise.resolve(response)
            } catch (ex: SecurityException) {
                promise.reject("IR_PERMISSION_DENIED", "مطلوب إذن android.permission.TRANSMIT_IR.", ex)
            } catch (ex: UnsupportedOperationException) {
                promise.reject("IR_UNSUPPORTED_FREQ", "التردد \$carrierFrequency Hz غير مدعوم من الجهاز.", ex)
            } catch (ex: Exception) {
                promise.reject("IR_TRANSMIT_ERROR", "فشل إرسال إشارة الـ IR: \${ex.message}", ex)
            }
        }
    }

    /**
     * إرسال كود Pronto Hex مباشر (مثل أكواد أجهزة التلفاز والتكييف العالمية)
     */
    @ReactMethod
    fun transmitProntoHex(prontoHex: String, promise: Promise) {
        val manager = irManager
        if (manager == null || !manager.hasIrEmitter()) {
            promise.reject("IR_UNAVAILABLE", "مستشعر الأشعة تحت الحمراء غير متوفر على هذا الجهاز.")
            return
        }

        irExecutor.execute {
            try {
                val tokens = prontoHex.trim().split(Regex("\\\\s+")).filter { it.isNotEmpty() }
                if (tokens.size < 6) {
                    promise.reject("IR_INVALID_HEX", "صيغة Pronto Hex قصيرة أو غير صالحة.")
                    return@execute
                }

                val words = tokens.map { it.toInt(16) }
                val freqWord = words[1]
                if (freqWord <= 0) {
                    promise.reject("IR_INVALID_HEX", "كلمة التردد في Pronto Hex تساوي صفراً.")
                    return@execute
                }

                val carrierHz = (1_000_000.0 / (freqWord * PRONTO_TIMEBASE_CONSTANT)).roundToInt()
                val periodUs = 1_000_000.0 / carrierHz
                val burstData = words.drop(4)
                val pattern = IntArray(burstData.size) { index ->
                    (burstData[index] * periodUs).roundToInt().coerceAtLeast(1)
                }

                manager.transmit(carrierHz, pattern)

                val response = Arguments.createMap().apply {
                    putBoolean("transmitted", true)
                    putInt("carrierFrequency", carrierHz)
                    putInt("pulseCount", pattern.size)
                }
                promise.resolve(response)
            } catch (ex: NumberFormatException) {
                promise.reject("IR_HEX_PARSE_ERROR", "فشل تحليل كود Hex: تأكد من صحة الأرقام الست عشرية.", ex)
            } catch (ex: Exception) {
                promise.reject("IR_TRANSMIT_ERROR", "فشل إرسال كود Pronto Hex: \${ex.message}", ex)
            }
        }
    }

    override fun invalidate() {
        super.invalidate()
        irExecutor.shutdown()
    }
}
`,
  },
  {
    id: 'ir-package-kt',
    path: 'android/app/src/main/java/com/universalremote/IrManagerPackage.kt',
    titleAr: 'ملف ReactPackage لتسجيل الوحدة الأصلية',
    category: 'android',
    language: 'kotlin',
    summaryAr:
      'يسجل IrManagerModule داخل React Native Bridge ليكون متاحاً عبر NativeModules.IrManagerModule في طبقة JavaScript.',
    content: `package com.universalremote

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

class IrManagerPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): MutableList<NativeModule> {
        return mutableListOf(IrManagerModule(reactContext))
    }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): MutableList<ViewManager<View, ReactShadowNode<*>>> {
        return mutableListOf()
    }
}
`,
  },
  {
    id: 'main-application-kt',
    path: 'android/app/src/main/java/com/universalremote/MainApplication.kt',
    titleAr: 'تسجيل الحزمة داخل MainApplication',
    category: 'android',
    language: 'kotlin',
    summaryAr:
      'يضيف IrManagerPackage إلى قائمة حزم ReactNativeHost عند تشغيل التطبيق في بيئة Bare Workflow.',
    content: `package com.universalremote

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.soloader.SoLoader

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> =
                PackageList(this).packages.apply {
                    // تسجيل وحدة الـ IR الأصلية يدوياً
                    add(IrManagerPackage())
                }

            override fun getJSMainModuleName(): String = "index"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, false)
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            load()
        }
    }
}
`,
  },
  {
    id: 'android-manifest-xml',
    path: 'android/app/src/main/AndroidManifest.xml',
    titleAr: 'أذونات الـ IR والشبكة المحلية (Manifest)',
    category: 'android',
    language: 'xml',
    summaryAr:
      'يعرّف إذن TRANSMIT_IR وأذونات الواي فاي والشبكة، مع تفعيل usesCleartextTraffic للاتصال المحلي المباشر بشاشات Roku و Android TV.',
    content: `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.universalremote">

    <!-- إذن مستشعر الأشعة تحت الحمراء -->
    <uses-permission android:name="android.permission.TRANSMIT_IR" />

    <!-- أذونات التحكم في الشاشات الذكية عبر الواي فاي المحلي -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <!-- السماح بتثبيت التطبيق حتى على الهواتف التي لا تملك IR للعمل عبر Wi-Fi -->
    <uses-feature
        android:name="android.hardware.consumerir"
        android:required="false" />

    <application
        android:name=".MainApplication"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:allowBackup="false"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/AppTheme">
        <activity
            android:name=".MainActivity"
            android:label="@string/app_name"
            android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
  },
  {
    id: 'app-build-gradle',
    path: 'android/app/build.gradle',
    titleAr: 'إعدادات Gradle وبناء Release APK',
    category: 'android',
    language: 'gradle',
    summaryAr:
      'يضبط namespace و applicationId باسم com.universalremote مع تهيئة signingConfigs.release الآمنة عبر متغيرات البيئة في CI/CD.',
    content: `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

react {
    autolinkLibrariesWithApp()
}

def enableProguardInReleaseBuilds = true

android {
    ndkVersion rootProject.ext.ndkVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace "com.universalremote"
    defaultConfig {
        applicationId "com.universalremote"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"
    }

    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (System.getenv("ANDROID_KEYSTORE_PATH")) {
                storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            } else {
                // تراجع آمن للتوقيع التجريبي عند غياب أسرار التوقيع الإنتاجية
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }

    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
    if (hermesEnabled.toBoolean()) {
        implementation("com.facebook.react:hermes-android")
    } else {
        implementation jscFlavor
    }
}
`,
  },
  {
    id: 'ir-codes-js',
    path: 'src/constants/irCodes.js',
    titleAr: 'مكتبة أكواد الترددات ونبضات NEC / AC',
    category: 'services',
    language: 'javascript',
    summaryAr:
      'تحويل أكواد Hex لبروتوكول NEC إلى نبضات ميكروثانية دقيقة عند 38kHz، مع أكواد الشاشات والمكيفات وخرائط مفاتيح Roku و Android TV.',
    content: `/**
 * مولد نبضات بروتوكول NEC القياسي (38000 Hz)
 * يحول عنوان الجهاز والأمر الست عشري إلى مصفوفة أزمنة بالميكروثانية
 */
export const DEFAULT_CARRIER_HZ = 38000;

export function encodeNecToMicroseconds(addressHex, commandHex) {
  const addr = addressHex & 0xff;
  const addrInv = (~addr) & 0xff;
  const cmd = commandHex & 0xff;
  const cmdInv = (~cmd) & 0xff;

  const frame32 =
    ((addr << 24) >>> 0) |
    ((addrInv << 16) >>> 0) |
    ((cmd << 8) >>> 0) |
    (cmdInv >>> 0);

  // نبضة البداية القياسية NEC (9ms Mark + 4.5ms Space)
  const pattern = [9000, 4500];

  for (let bit = 31; bit >= 0; bit--) {
    const isOne = ((frame32 >>> bit) & 1) === 1;
    pattern.push(560); // Mark
    pattern.push(isOne ? 1690 : 560); // Space
  }

  // نبضة التوقف النهائية
  pattern.push(560);
  return pattern;
}

/**
 * أكواد الأشعة تحت الحمراء للشاشات (Samsung / LG)
 */
export const TV_IR_BRANDS = {
  samsung: {
    label: 'سامسونج (Samsung TV)',
    carrierFrequency: 38000,
    address: 0x07,
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
    },
  },
  lg: {
    label: 'إل جي (LG TV)',
    carrierFrequency: 38000,
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

/**
 * بناء حزمة نبضات التكييف الديناميكية (درجة الحرارة + الوضع + المروحة + التأرجح)
 */
export function buildAcIrPattern(brandKey, { power, temperature, mode, fanSpeed, swing }) {
  const brandAddress = brandKey === 'carrier' ? 0x4d : 0x58; // Gree / Carrier
  const modeMap = { cool: 1, dry: 2, fan: 3, heat: 4, auto: 0 };
  const fanMap = { auto: 0, low: 1, medium: 2, high: 3 };

  const clampedTemp = Math.max(16, Math.min(30, temperature));
  const tempOffset = clampedTemp - 16;

  // تشفير حالة المكيف داخل بايت الأمر
  const stateByte =
    ((power ? 1 : 0) << 7) |
    ((modeMap[mode] ?? 1) << 4) |
    ((fanMap[fanSpeed] ?? 0) << 2) |
    (swing ? 0x02 : 0x00);

  const headerPattern = encodeNecToMicroseconds(brandAddress, stateByte);
  const tempPattern = encodeNecToMicroseconds(brandAddress ^ 0x0f, tempOffset);

  // دمج الحزمتين مع فاصل زمني 20ms
  return [...headerPattern, 20000, ...tempPattern];
}

/**
 * خريطة أوامر الواي فاي لبروتوكول Roku ECP و Android TV WebSocket
 */
export const WIFI_KEY_MAP = {
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
`,
  },
  {
    id: 'ir-service-js',
    path: 'src/services/irRemoteService.js',
    titleAr: 'خدمة التحكم بالأشعة تحت الحمراء (JS Bridge)',
    category: 'services',
    language: 'javascript',
    summaryAr:
      'تستدعي NativeModules.IrManagerModule للتحقق من المستشعر وجلب الترددات وإرسال أوامر الشاشات والمكيفات بأمان.',
    content: `import { NativeModules, Platform } from 'react-native';
import {
  DEFAULT_CARRIER_HZ,
  TV_IR_BRANDS,
  buildAcIrPattern,
  encodeNecToMicroseconds,
} from '../constants/irCodes';

const { IrManagerModule } = NativeModules;

class IrRemoteService {
  constructor() {
    this._emitterCached = null;
  }

  /**
   * التحقق من توفر مستشعر IR على هاتف الأندرويد
   */
  async isAvailable() {
    if (Platform.OS !== 'android' || !IrManagerModule) {
      return false;
    }
    if (this._emitterCached !== null) {
      return this._emitterCached;
    }
    try {
      const supported = await IrManagerModule.hasIrEmitter();
      this._emitterCached = Boolean(supported);
      return this._emitterCached;
    } catch {
      return false;
    }
  }

  /**
   * جلب نطاقات التردد المدعومة من شريحة الهاتف
   */
  async getSupportedFrequencies() {
    if (Platform.OS !== 'android' || !IrManagerModule) {
      return [];
    }
    return IrManagerModule.getCarrierFrequencies();
  }

  /**
   * إرسال أمر شاشة تلفاز عبر مستشعر IR
   */
  async sendTvCommand(brandKey, commandKey) {
    const brand = TV_IR_BRANDS[brandKey] || TV_IR_BRANDS.samsung;
    const commandHex = brand.commands[commandKey];

    if (commandHex === undefined) {
      throw new Error(\`الأمر \${commandKey} غير معرف للعلامة التجارية \${brand.label}\`);
    }

    const available = await this.isAvailable();
    if (!available) {
      throw new Error('هذا الهاتف لا يدعم مستشعر الأشعة تحت الحمراء (IR Blaster).');
    }

    const pattern = encodeNecToMicroseconds(brand.address, commandHex);
    return IrManagerModule.transmitIR(pattern, brand.carrierFrequency || DEFAULT_CARRIER_HZ);
  }

  /**
   * إرسال حالة المكيف الكاملة عبر مستشعر IR
   */
  async sendAcState(brandKey, acState) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('مستشعر الأشعة تحت الحمراء غير متاح لإرسال أوامر التكييف.');
    }

    const pattern = buildAcIrPattern(brandKey, acState);
    return IrManagerModule.transmitIR(pattern, DEFAULT_CARRIER_HZ);
  }

  /**
   * إرسال كود Pronto Hex مخصص
   */
  async sendProntoHex(prontoHex) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('مستشعر الأشعة تحت الحمراء غير متاح.');
    }
    return IrManagerModule.transmitProntoHex(prontoHex);
  }
}

export const irRemoteService = new IrRemoteService();
export default irRemoteService;
`,
  },
  {
    id: 'wifi-service-js',
    path: 'src/services/wifiRemoteService.js',
    titleAr: 'خدمة الواي فاي للشاشات الذكية (Roku + Android TV)',
    category: 'services',
    language: 'javascript',
    summaryAr:
      'خدمة مزدوجة البروتوكول ترسل أوامر HTTP REST إلى شاشات Roku ECP على المنفذ 8060 أو تفتح اتصال WebSocket دائم مع Android TV مع إعادة اتصال تلقائية.',
    content: `import { WIFI_KEY_MAP } from '../constants/irCodes';

/**
 * خدمة التحكم عبر الواي فاي المحلي للشاشات الذكية
 * تدعم بروتوكولين:
 * 1) Roku External Control Protocol (ECP) عبر HTTP REST (المنفذ 8060)
 * 2) Android TV / Smart TV عبر WebSocket (المنفذ الافتراضي 8080)
 */
class WifiRemoteService {
  constructor() {
    this.protocol = 'roku'; // 'roku' | 'android_tv'
    this.ipAddress = '192.168.1.50';
    this.port = 8060;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.commandQueue = [];
    this.listeners = new Set();
  }

  /**
   * تسجيل مستمع لتغييرات حالة الاتصال
   */
  subscribe(listener) {
    this.listeners.add(listener);
    listener({
      isConnected: this.isConnected,
      protocol: this.protocol,
      ipAddress: this.ipAddress,
      port: this.port,
    });
    return () => this.listeners.delete(listener);
  }

  _notify() {
    const snapshot = {
      isConnected: this.isConnected,
      protocol: this.protocol,
      ipAddress: this.ipAddress,
      port: this.port,
    };
    this.listeners.forEach((cb) => cb(snapshot));
  }

  /**
   * تهيئة عنوان الشاشة وبروتوكول الاتصال
   */
  configure({ protocol, ipAddress, port }) {
    const nextProtocol = protocol || this.protocol;
    const nextIp = (ipAddress || this.ipAddress).trim();
    const nextPort = port || (nextProtocol === 'roku' ? 8060 : 8080);

    const changed =
      nextProtocol !== this.protocol || nextIp !== this.ipAddress || nextPort !== this.port;

    this.protocol = nextProtocol;
    this.ipAddress = nextIp;
    this.port = Number(nextPort);

    if (changed) {
      this.disconnect();
    }
    this._notify();
  }

  /**
   * اختبار الاتصال أو فتح جلسة WebSocket
   */
  async connect() {
    if (this.protocol === 'roku') {
      return this._verifyRokuDevice();
    }
    return this._connectAndroidTvSocket();
  }

  async _verifyRokuDevice() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(\`http://\${this.ipAddress}:\${this.port}/query/device-info\`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(\`استجابة غير متوقعة من Roku: \${response.status}\`);
      }

      this.isConnected = true;
      this._notify();
      return { connected: true, protocol: 'roku' };
    } catch (error) {
      this.isConnected = false;
      this._notify();
      throw new Error(\`تعذر الوصول لشاشة Roku على \${this.ipAddress}:\${this.port}\`);
    } finally {
      clearTimeout(timer);
    }
  }

  _connectAndroidTvSocket() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.isConnected = true;
        this._notify();
        resolve({ connected: true, protocol: 'android_tv' });
        return;
      }

      const wsUrl = \`ws://\${this.ipAddress}:\${this.port}/remote\`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      const timeoutId = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          socket.close();
          reject(new Error(\`انتهت مهلة اتصال WebSocket على \${wsUrl}\`));
        }
      }, 4500);

      socket.onopen = () => {
        clearTimeout(timeoutId);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this._notify();
        this._flushQueue();
        resolve({ connected: true, protocol: 'android_tv' });
      };

      socket.onclose = () => {
        clearTimeout(timeoutId);
        this.isConnected = false;
        this._notify();
        this._scheduleReconnect();
      };

      socket.onerror = () => {
        clearTimeout(timeoutId);
        this.isConnected = false;
        this._notify();
        reject(new Error(\`فشل اتصال WebSocket مع Android TV (\${this.ipAddress})\`));
      };
    });
  }

  _scheduleReconnect() {
    if (this.protocol !== 'android_tv') return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts += 1;
    const delayMs = Math.min(8000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    setTimeout(() => {
      if (!this.isConnected && this.protocol === 'android_tv') {
        this._connectAndroidTvSocket().catch(() => {});
      }
    }, delayMs);
  }

  _flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.commandQueue.length > 0) {
      const payload = this.commandQueue.shift();
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.commandQueue = [];
    this._notify();
  }

  /**
   * إرسال أمر قياسي موحد إلى الشاشة الذكية عبر REST أو WebSocket
   */
  async sendCommand(commandKey) {
    const mapped = WIFI_KEY_MAP[commandKey];
    if (!mapped) {
      throw new Error(\`أمر غير مدعوم عبر الواي فاي: \${commandKey}\`);
    }

    if (this.protocol === 'roku') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const endpoint = \`http://\${this.ipAddress}:\${this.port}/keypress/\${mapped.roku}\`;
        const response = await fetch(endpoint, {
          method: 'POST',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(\`فشل أمر Roku ECP (\${response.status})\`);
        }

        this.isConnected = true;
        this._notify();
        return { sent: true, protocol: 'roku', key: mapped.roku, endpoint };
      } finally {
        clearTimeout(timer);
      }
    }

    // بروتوكول Android TV WebSocket
    const payload = {
      type: 'KEY_EVENT',
      keyCode: mapped.androidTv,
      action: 'CLICK',
      timestamp: Date.now(),
    };

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.commandQueue.push(payload);
      await this._connectAndroidTvSocket();
    } else {
      this.ws.send(JSON.stringify(payload));
    }

    return { sent: true, protocol: 'android_tv', payload };
  }
}

export const wifiRemoteService = new WifiRemoteService();
export default wifiRemoteService;
`,
  },
  {
    id: 'theme-colors-js',
    path: 'src/theme/colors.js',
    titleAr: 'نظام الألوان الداكن للأجهزة (Theme Tokens)',
    category: 'ui',
    language: 'javascript',
    summaryAr:
      'رموز الألوان المعتمدة في واجهة التطبيق (خلفية داكنة كربونية، أسطح أزرار ملموسة، تمييز الطاقة والأشعة والواي فاي).',
    content: `export const COLORS = {
  background: '#0B0D11',
  surface: '#131720',
  surfaceElevated: '#1A202C',
  border: '#232B3A',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  irCrimson: '#EF4444',
  irCrimsonSoft: 'rgba(239, 68, 68, 0.16)',
  wifiSky: '#0EA5E9',
  wifiSkySoft: 'rgba(14, 165, 233, 0.16)',
  heatAmber: '#F59E0B',
  heatAmberSoft: 'rgba(245, 158, 11, 0.16)',
  successGreen: '#16A34A',
};
`,
  },
  {
    id: 'tv-remote-screen-js',
    path: 'src/screens/TvRemoteScreen.js',
    titleAr: 'شاشة ريموت التلفاز (TV Remote Screen)',
    category: 'ui',
    language: 'javascript',
    summaryAr:
      'واجهة عربية RTL متجاوبة تضم زر الطاقة، التحكم بالصوت والقنوات، لوحة الاتجاهات D-Pad الدائرية، اختيار وضع IR أو Wi-Fi، ونافذة إعداد IP الشاشة.',
    content: `import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import irRemoteService from '../services/irRemoteService';
import wifiRemoteService from '../services/wifiRemoteService';
import { COLORS } from '../theme/colors';

export default function TvRemoteScreen({ onFeedback }) {
  const [transport, setTransport] = useState('ir'); // 'ir' | 'wifi'
  const [irBrand, setIrBrand] = useState('samsung'); // 'samsung' | 'lg'
  const [wifiProtocol, setWifiProtocol] = useState('roku'); // 'roku' | 'android_tv'
  const [tvIp, setTvIp] = useState('192.168.1.50');
  const [tvPort, setTvPort] = useState('8060');
  const [showWifiModal, setShowWifiModal] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handleCommand = async (commandKey, labelAr) => {
    setIsSending(true);
    try {
      if (transport === 'ir') {
        const res = await irRemoteService.sendTvCommand(irBrand, commandKey);
        onFeedback(\`تم إرسال "\${labelAr}" عبر IR بتردد \${res.carrierFrequency} Hz\`, 'ir');
      } else {
        await wifiRemoteService.sendCommand(commandKey);
        onFeedback(\`تم إرسال "\${labelAr}" عبر الواي فاي (\${wifiProtocol.toUpperCase()})\`, 'wifi');
      }
    } catch (error) {
      onFeedback(error.message || 'تعذر تنفيذ الأمر', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveWifiConfig = async () => {
    wifiRemoteService.configure({
      protocol: wifiProtocol,
      ipAddress: tvIp,
      port: Number(tvPort) || (wifiProtocol === 'roku' ? 8060 : 8080),
    });
    setShowWifiModal(false);
    try {
      await wifiRemoteService.connect();
      onFeedback(\`تم الاتصال بالشاشة على \${tvIp}\`, 'wifi');
    } catch (error) {
      onFeedback(error.message, 'error');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* مبدل طريقة الاتصال: IR Blaster أو Wi-Fi */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, transport === 'ir' && styles.segmentActiveIr]}
          onPress={() => setTransport('ir')}
          accessibilityRole="button"
        >
          <Text style={[styles.segmentText, transport === 'ir' && styles.segmentTextActive]}>
            أشعة IR (38kHz)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, transport === 'wifi' && styles.segmentActiveWifi]}
          onPress={() => setTransport('wifi')}
          accessibilityRole="button"
        >
          <Text style={[styles.segmentText, transport === 'wifi' && styles.segmentTextActive]}>
            واي فاي (Smart TV)
          </Text>
        </TouchableOpacity>
      </View>

      {/* شريط اختيار الجهاز أو إعدادات IP */}
      {transport === 'ir' ? (
        <View style={styles.brandRow}>
          <TouchableOpacity
            style={[styles.brandBtn, irBrand === 'samsung' && styles.brandBtnActive]}
            onPress={() => setIrBrand('samsung')}
          >
            <Text style={styles.brandText}>Samsung TV</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.brandBtn, irBrand === 'lg' && styles.brandBtnActive]}
            onPress={() => setIrBrand('lg')}
          >
            <Text style={styles.brandText}>LG TV</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.wifiConfigBar} onPress={() => setShowWifiModal(true)}>
          <Text style={styles.wifiConfigLabel}>
            {wifiProtocol === 'roku' ? 'Roku ECP' : 'Android TV WS'} · {tvIp}:{tvPort}
          </Text>
          <Text style={styles.wifiConfigAction}>تعديل IP</Text>
        </TouchableOpacity>
      )}

      {/* الصف العلوي: الطاقة + المصدر + كتم الصوت */}
      <View style={styles.topActionRow}>
        <TouchableOpacity
          style={styles.powerButton}
          onPress={() => handleCommand('POWER', 'الطاقة')}
          disabled={isSending}
        >
          <Text style={styles.powerButtonText}>طاقة</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.utilityButton}
          onPress={() => handleCommand('INPUT', 'تبديل المصدر')}
        >
          <Text style={styles.utilityButtonText}>المصدر</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.utilityButton}
          onPress={() => handleCommand('MUTE', 'كتم الصوت')}
        >
          <Text style={styles.utilityButtonText}>كتم</Text>
        </TouchableOpacity>
      </View>

      {/* لوحة الاتجاهات D-Pad */}
      <View style={styles.dpadWrapper}>
        <TouchableOpacity style={styles.dpadEdgeBtn} onPress={() => handleCommand('UP', 'أعلى')}>
          <Text style={styles.dpadArrow}>▲</Text>
        </TouchableOpacity>

        <View style={styles.dpadMiddleRow}>
          <TouchableOpacity
            style={styles.dpadEdgeBtn}
            onPress={() => handleCommand('RIGHT', 'يمين')}
          >
            <Text style={styles.dpadArrow}>▶</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dpadOkBtn}
            onPress={() => handleCommand('OK', 'موافق')}
          >
            <Text style={styles.dpadOkText}>موافق</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dpadEdgeBtn}
            onPress={() => handleCommand('LEFT', 'يسار')}
          >
            <Text style={styles.dpadArrow}>◀</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.dpadEdgeBtn} onPress={() => handleCommand('DOWN', 'أسفل')}>
          <Text style={styles.dpadArrow}>▼</Text>
        </TouchableOpacity>
      </View>

      {/* أزرار التنقل: رجوع، الرئيسية، القائمة */}
      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navBtn} onPress={() => handleCommand('BACK', 'رجوع')}>
          <Text style={styles.navBtnText}>رجوع</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} onPress={() => handleCommand('HOME', 'الرئيسية')}>
          <Text style={styles.navBtnText}>الرئيسية</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} onPress={() => handleCommand('MENU', 'القائمة')}>
          <Text style={styles.navBtnText}>القائمة</Text>
        </TouchableOpacity>
      </View>

      {/* عمودا الصوت والقنوات */}
      <View style={styles.rockerGrid}>
        <View style={styles.rockerColumn}>
          <TouchableOpacity
            style={styles.rockerBtn}
            onPress={() => handleCommand('VOL_UP', 'رفع الصوت')}
          >
            <Text style={styles.rockerSymbol}>+</Text>
          </TouchableOpacity>
          <Text style={styles.rockerTitle}>الصوت</Text>
          <TouchableOpacity
            style={styles.rockerBtn}
            onPress={() => handleCommand('VOL_DOWN', 'خفض الصوت')}
          >
            <Text style={styles.rockerSymbol}>−</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rockerColumn}>
          <TouchableOpacity
            style={styles.rockerBtn}
            onPress={() => handleCommand('CH_UP', 'القناة التالية')}
          >
            <Text style={styles.rockerSymbol}>▲</Text>
          </TouchableOpacity>
          <Text style={styles.rockerTitle}>القناة</Text>
          <TouchableOpacity
            style={styles.rockerBtn}
            onPress={() => handleCommand('CH_DOWN', 'القناة السابقة')}
          >
            <Text style={styles.rockerSymbol}>▼</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* نافذة إعدادات اتصال الواي فاي */}
      <Modal visible={showWifiModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>إعداد الشاشة الذكية عبر الواي فاي</Text>

            <View style={styles.brandRow}>
              <TouchableOpacity
                style={[styles.brandBtn, wifiProtocol === 'roku' && styles.brandBtnActive]}
                onPress={() => {
                  setWifiProtocol('roku');
                  setTvPort('8060');
                }}
              >
                <Text style={styles.brandText}>Roku ECP (REST)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.brandBtn, wifiProtocol === 'android_tv' && styles.brandBtnActive]}
                onPress={() => {
                  setWifiProtocol('android_tv');
                  setTvPort('8080');
                }}
              >
                <Text style={styles.brandText}>Android TV (WS)</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>عنوان IP المحلي للشاشة</Text>
            <TextInput
              style={styles.input}
              value={tvIp}
              onChangeText={setTvIp}
              keyboardType="numeric"
              placeholder="192.168.1.50"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={styles.inputLabel}>المنفذ (Port)</Text>
            <TextInput
              style={styles.input}
              value={tvPort}
              onChangeText={setTvPort}
              keyboardType="numeric"
              placeholder="8060"
              placeholderTextColor={COLORS.textMuted}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowWifiModal(false)}
              >
                <Text style={styles.navBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveWifiConfig}>
                <Text style={styles.segmentTextActive}>حفظ واتصال</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    gap: 16,
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 9,
  },
  segmentActiveIr: {
    backgroundColor: COLORS.irCrimson,
  },
  segmentActiveWifi: {
    backgroundColor: COLORS.wifiSky,
  },
  segmentText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  brandRow: {
    flexDirection: 'row',
    gap: 8,
  },
  brandBtn: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  brandBtnActive: {
    borderColor: COLORS.wifiSky,
    backgroundColor: COLORS.wifiSkySoft,
  },
  brandText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  wifiConfigBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  wifiConfigLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  wifiConfigAction: {
    color: COLORS.wifiSky,
    fontSize: 13,
    fontWeight: '700',
  },
  topActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  powerButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: COLORS.irCrimson,
    justifyContent: 'center',
    alignItems: 'center',
  },
  powerButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  utilityButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  utilityButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  dpadWrapper: {
    alignSelf: 'center',
    width: 224,
    height: 224,
    borderRadius: 112,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  dpadMiddleRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dpadEdgeBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
  },
  dpadArrow: {
    color: COLORS.textPrimary,
    fontSize: 16,
  },
  dpadOkBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: COLORS.wifiSky,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadOkText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    gap: 10,
  },
  navBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtnText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  rockerGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  rockerColumn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 8,
    alignItems: 'center',
    gap: 8,
  },
  rockerBtn: {
    width: '100%',
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rockerSymbol: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  rockerTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    gap: 12,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  inputLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: 'right',
  },
  input: {
    minHeight: 44,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: COLORS.textPrimary,
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  modalCancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSaveBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: COLORS.wifiSky,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
`,
  },
  {
    id: 'ac-remote-screen-js',
    path: 'src/screens/AcRemoteScreen.js',
    titleAr: 'شاشة ريموت التكييف (AC Remote Screen)',
    category: 'ui',
    language: 'javascript',
    summaryAr:
      'شاشة رقمية متجاوبة للتحكم في مكيفات الهواء عبر IR Blaster (تشغيل/إطفاء، رفع وخفض الحرارة من 16 إلى 30، وضع التشغيل، سرعة المروحة، والتأرجح).',
    content: `import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import irRemoteService from '../services/irRemoteService';
import { COLORS } from '../theme/colors';

const AC_MODES = [
  { key: 'cool', label: 'تبريد' },
  { key: 'heat', label: 'تدفئة' },
  { key: 'dry', label: 'تجفيف' },
  { key: 'fan', label: 'مروحة' },
  { key: 'auto', label: 'تلقائي' },
];

const FAN_SPEEDS = [
  { key: 'auto', label: 'تلقائي' },
  { key: 'low', label: 'منخفض' },
  { key: 'medium', label: 'متوسط' },
  { key: 'high', label: 'عالي' },
];

export default function AcRemoteScreen({ onFeedback }) {
  const [brand, setBrand] = useState('gree'); // 'gree' | 'carrier'
  const [acState, setAcState] = useState({
    power: true,
    temperature: 22,
    mode: 'cool',
    fanSpeed: 'auto',
    swing: true,
  });

  const transmitNextState = async (nextState, actionLabel) => {
    setAcState(nextState);
    try {
      const res = await irRemoteService.sendAcState(brand, nextState);
      onFeedback(
        \`\${actionLabel} · \${nextState.temperature}°C (\${res.pulseCount} نبضة IR)\`,
        'ir'
      );
    } catch (error) {
      onFeedback(error.message || 'تعذر إرسال أمر التكييف', 'error');
    }
  };

  const togglePower = () => {
    const next = { ...acState, power: !acState.power };
    transmitNextState(next, next.power ? 'تشغيل المكيف' : 'إطفاء المكيف');
  };

  const adjustTemp = (delta) => {
    const nextTemp = Math.max(16, Math.min(30, acState.temperature + delta));
    if (nextTemp === acState.temperature) return;
    transmitNextState({ ...acState, power: true, temperature: nextTemp }, 'تعديل الحرارة');
  };

  const selectMode = (modeKey, label) => {
    transmitNextState({ ...acState, power: true, mode: modeKey }, \`وضع \${label}\`);
  };

  const cycleFan = () => {
    const idx = FAN_SPEEDS.findIndex((item) => item.key === acState.fanSpeed);
    const nextFan = FAN_SPEEDS[(idx + 1) % FAN_SPEEDS.length];
    transmitNextState({ ...acState, power: true, fanSpeed: nextFan.key }, \`المروحة: \${nextFan.label}\`);
  };

  const toggleSwing = () => {
    const nextSwing = !acState.swing;
    transmitNextState(
      { ...acState, power: true, swing: nextSwing },
      nextSwing ? 'تفعيل التأرجح' : 'إيقاف التأرجح'
    );
  };

  const currentModeLabel = AC_MODES.find((m) => m.key === acState.mode)?.label || 'تبريد';
  const currentFanLabel = FAN_SPEEDS.find((f) => f.key === acState.fanSpeed)?.label || 'تلقائي';

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* اختيار الشركة المصنعة */}
      <View style={styles.brandRow}>
        <TouchableOpacity
          style={[styles.brandBtn, brand === 'gree' && styles.brandBtnActive]}
          onPress={() => setBrand('gree')}
        >
          <Text style={styles.brandText}>Gree AC</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.brandBtn, brand === 'carrier' && styles.brandBtnActive]}
          onPress={() => setBrand('carrier')}
        >
          <Text style={styles.brandText}>Carrier AC</Text>
        </TouchableOpacity>
      </View>

      {/* الشاشة الرقمية لبيانات المكيف */}
      <View style={[styles.lcdPanel, !acState.power && styles.lcdPanelOff]}>
        <View style={styles.lcdTopRow}>
          <Text style={styles.lcdMeta}>الوضع: {currentModeLabel}</Text>
          <Text style={styles.lcdMeta}>المروحة: {currentFanLabel}</Text>
        </View>

        <Text style={styles.lcdTemp}>
          {acState.power ? \`\${acState.temperature}°C\` : 'OFF'}
        </Text>

        <Text style={styles.lcdFooter}>
          توجيه الهواء: {acState.swing ? 'متحرك' : 'ثابت'} · IR 38kHz
        </Text>
      </View>

      {/* أزرار الطاقة ورفع/خفض الحرارة */}
      <View style={styles.tempControlRow}>
        <TouchableOpacity style={styles.tempBtn} onPress={() => adjustTemp(-1)}>
          <Text style={styles.tempBtnText}>−</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.powerBtn, acState.power ? styles.powerBtnOn : styles.powerBtnOff]}
          onPress={togglePower}
        >
          <Text style={styles.powerBtnText}>{acState.power ? 'إطفاء' : 'تشغيل'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tempBtn} onPress={() => adjustTemp(1)}>
          <Text style={styles.tempBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* أوضاع التشغيل */}
      <Text style={styles.sectionTitle}>وضع التشغيل</Text>
      <View style={styles.modesGrid}>
        {AC_MODES.map((item) => {
          const active = acState.mode === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.modeBtn,
                active && (item.key === 'heat' ? styles.modeActiveHeat : styles.modeActiveCool),
              ]}
              onPress={() => selectMode(item.key, item.label)}
            >
              <Text style={[styles.modeBtnText, active && styles.modeBtnTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* سرعة المروحة والتأرجح */}
      <View style={styles.extraRow}>
        <TouchableOpacity style={styles.extraBtn} onPress={cycleFan}>
          <Text style={styles.extraLabel}>سرعة المروحة</Text>
          <Text style={styles.extraValue}>{currentFanLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.extraBtn} onPress={toggleSwing}>
          <Text style={styles.extraLabel}>تأرجح الريش</Text>
          <Text style={styles.extraValue}>{acState.swing ? 'يعمل' : 'متوقف'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    gap: 16,
  },
  brandRow: {
    flexDirection: 'row',
    gap: 8,
  },
  brandBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandBtnActive: {
    borderColor: COLORS.wifiSky,
    backgroundColor: COLORS.wifiSkySoft,
  },
  brandText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  lcdPanel: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  lcdPanelOff: {
    opacity: 0.55,
  },
  lcdTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lcdMeta: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  lcdTemp: {
    color: COLORS.textPrimary,
    fontSize: 54,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  lcdFooter: {
    color: COLORS.wifiSky,
    fontSize: 12,
    fontWeight: '600',
  },
  tempControlRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  tempBtn: {
    width: 72,
    height: 60,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tempBtnText: {
    color: COLORS.textPrimary,
    fontSize: 26,
    fontWeight: '700',
  },
  powerBtn: {
    flex: 1,
    height: 60,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  powerBtnOn: {
    backgroundColor: COLORS.irCrimson,
  },
  powerBtnOff: {
    backgroundColor: COLORS.successGreen,
  },
  powerBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  modesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modeBtn: {
    width: '31%',
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeActiveCool: {
    backgroundColor: COLORS.wifiSkySoft,
    borderColor: COLORS.wifiSky,
  },
  modeActiveHeat: {
    backgroundColor: COLORS.heatAmberSoft,
    borderColor: COLORS.heatAmber,
  },
  modeBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
  extraRow: {
    flexDirection: 'row',
    gap: 10,
  },
  extraBtn: {
    flex: 1,
    minHeight: 62,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  extraLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  extraValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
});
`,
  },
  {
    id: 'app-js',
    path: 'App.js',
    titleAr: 'الملف الجذري للتطبيق (App.js)',
    category: 'ui',
    language: 'javascript',
    summaryAr:
      'يفعل اتجاه الواجهة العربي RTL، يفحص توفر مستشعر ConsumerIrManager عند التشغيل، ويدير التبويب بين ريموت الشاشة وريموت التكييف.',
    content: `import React, { useEffect, useState } from 'react';
import {
  I18nManager,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AcRemoteScreen from './src/screens/AcRemoteScreen';
import TvRemoteScreen from './src/screens/TvRemoteScreen';
import irRemoteService from './src/services/irRemoteService';
import { COLORS } from './src/theme/colors';

// تفعيل الاتجاه من اليمين إلى اليسار للواجهة العربية
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

export default function App() {
  const [activeTab, setActiveTab] = useState('tv'); // 'tv' | 'ac'
  const [hasIrHardware, setHasIrHardware] = useState(null);
  const [feedback, setFeedback] = useState({
    message: 'جاهز للتحكم بالشاشة والمكيف',
    type: 'info',
  });

  useEffect(() => {
    let mounted = true;
    irRemoteService.isAvailable().then((available) => {
      if (mounted) {
        setHasIrHardware(available);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleFeedback = (message, type = 'info') => {
    setFeedback({ message, type });
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* الشريط العلوي */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>الريموت الشامل</Text>
        <Text style={styles.hardwareNote}>
          {hasIrHardware === null
            ? 'جاري فحص مستشعر IR'
            : hasIrHardware
            ? 'مستشعر IR متاح'
            : 'وضع Wi-Fi (لا يوجد IR)'}
        </Text>
      </View>

      {/* شريط الإشعار الفوري للأوامر */}
      <View
        style={[
          styles.feedbackBar,
          feedback.type === 'error' && styles.feedbackError,
          feedback.type === 'ir' && styles.feedbackIr,
          feedback.type === 'wifi' && styles.feedbackWifi,
        ]}
      >
        <Text style={styles.feedbackText} numberOfLines={1}>
          {feedback.message}
        </Text>
      </View>

      {/* محتوى التبويب النشط */}
      <View style={styles.content}>
        {activeTab === 'tv' ? (
          <TvRemoteScreen onFeedback={handleFeedback} />
        ) : (
          <AcRemoteScreen onFeedback={handleFeedback} />
        )}
      </View>

      {/* شريط التبويب السفلي */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'tv' && styles.tabBtnActive]}
          onPress={() => setActiveTab('tv')}
        >
          <Text style={[styles.tabText, activeTab === 'tv' && styles.tabTextActive]}>
            ريموت الشاشة
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'ac' && styles.tabBtnActive]}
          onPress={() => setActiveTab('ac')}
        >
          <Text style={[styles.tabText, activeTab === 'ac' && styles.tabTextActive]}>
            ريموت التكييف
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 19,
    fontWeight: '700',
  },
  hardwareNote: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  feedbackBar: {
    marginHorizontal: 18,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  feedbackIr: {
    borderColor: COLORS.irCrimson,
    backgroundColor: COLORS.irCrimsonSoft,
  },
  feedbackWifi: {
    borderColor: COLORS.wifiSky,
    backgroundColor: COLORS.wifiSkySoft,
  },
  feedbackError: {
    borderColor: COLORS.heatAmber,
    backgroundColor: COLORS.heatAmberSoft,
  },
  feedbackText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 8,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.wifiSky,
  },
  tabText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
});
`,
  },
  {
    id: 'rn-package-json',
    path: 'package.json',
    titleAr: 'ملف اعتماديات React Native (package.json)',
    category: 'cicd',
    language: 'json',
    summaryAr:
      'يعرّف اعتماديات React Native Bare Workflow المتوافقة مع أندرويد وسكربتات التشغيل والبناء.',
    content: `{
  "name": "UniversalRemoteControl",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "android": "react-native run-android",
    "start": "react-native start",
    "lint": "eslint .",
    "test": "jest"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-native": "0.76.5"
  },
  "devDependencies": {
    "@babel/core": "^7.25.2",
    "@babel/preset-env": "^7.25.3",
    "@babel/runtime": "^7.25.0",
    "@react-native/babel-preset": "0.76.5",
    "@react-native/eslint-config": "0.76.5",
    "@react-native/metro-config": "0.76.5",
    "@react-native/typescript-config": "0.76.5",
    "eslint": "^8.57.0"
  },
  "engines": {
    "node": ">=18"
  }
}
`,
  },
  {
    id: 'github-actions-yml',
    path: '.github/workflows/build-apk.yml',
    titleAr: 'سير عمل البناء السحابي (GitHub Actions CI/CD)',
    category: 'cicd',
    language: 'yaml',
    summaryAr:
      'يهيئ Node.js 20 و Java 17 و Android SDK تلقائياً عند كل Push إلى main، ويبني ملف Release APK ويرفعه كـ Artifact جاهز للتحميل.',
    content: `name: Build Android Release APK

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build-android-apk:
    name: Build Release APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Setup Java 17 (Temurin)
        uses: actions/setup-java@v4
        with:
          distribution: "temurin"
          java-version: "17"

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Cache Gradle Packages
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: \${{ runner.os }}-gradle-\${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
          restore-keys: |
            \${{ runner.os }}-gradle-

      - name: Install JavaScript Dependencies
        run: npm ci

      - name: Decode Release Keystore (Optional)
        if: env.ANDROID_KEYSTORE_BASE64 != ''
        env:
          ANDROID_KEYSTORE_BASE64: \${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > android/app/release.keystore
          echo "ANDROID_KEYSTORE_PATH=release.keystore" >> $GITHUB_ENV

      - name: Grant Execute Permission for Gradlew
        run: chmod +x android/gradlew

      - name: Build Android Release APK
        working-directory: android
        env:
          ANDROID_KEYSTORE_PASSWORD: \${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: \${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: \${{ secrets.ANDROID_KEY_PASSWORD }}
        run: ./gradlew assembleRelease --no-daemon --stacktrace

      - name: Upload Release APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: universal-remote-release-apk
          path: android/app/build/outputs/apk/release/*.apk
          if-no-files-found: error
          retention-days: 30
`,
  },
  {
    id: 'readme-md',
    path: 'README.md',
    titleAr: 'دليل الإعداد والرفع إلى GitHub',
    category: 'cicd',
    language: 'markdown',
    summaryAr:
      'خطوات تهيئة مشروع React Native Bare Workflow، دمج الملفات، وإضافة أسرار التوقيع في GitHub لبناء الـ APK تلقائياً.',
    content: `# تطبيق الريموت كنترول الشامل (Universal Remote Control)

تطبيق أندرويد احترافي مبني بـ **React Native (Bare Workflow)** مع وحدة **Kotlin** أصلية للتحكم بالأشعة تحت الحمراء (\`ConsumerIrManager\`) وخدمة واي فاي مزدوجة لشاشات **Roku** و **Android TV**.

## 1. تهيئة المشروع محلياً

\`\`\`bash
npx @react-native-community/cli init UniversalRemoteControl --version 0.76.5
cd UniversalRemoteControl
# انسخ محتويات مجلدات android/ و src/ و App.js و .github/ إلى المشروع
npm install
npx react-native run-android
\`\`\`

## 2. أسرار التوقيع السحابي (GitHub Secrets)

لبناء نسخة موقعة رسمياً للنشر على متجر Google Play، أضف الأسرار التالية في إعدادات مستودع GitHub:
- \`ANDROID_KEYSTORE_BASE64\`: ملف \`.keystore\` محول إلى Base64
- \`ANDROID_KEYSTORE_PASSWORD\`: كلمة مرور الـ Keystore
- \`ANDROID_KEY_ALIAS\`: الاسم المستعار للمفتاح
- \`ANDROID_KEY_PASSWORD\`: كلمة مرور المفتاح

*(في حال عدم إضافة الأسرار، سيقوم سير العمل ببناء APK باستخدام توقيع الاختبار تلقائياً لتتمكن من تحميله وتجربته مباشرة من قسم Artifacts).*
`,
  },
];
