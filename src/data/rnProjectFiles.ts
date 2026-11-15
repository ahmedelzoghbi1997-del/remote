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
    id: "ir-codes-js",
    path: "src/ir/encoders.js",
    titleAr: "مكتبة تشفير نبضات IR (Samsung / NEC / AC)",
    category: "services",
    language: "javascript",
    summaryAr:
      "دوال تشفير نبضات الأشعة تحت الحمراء (Samsung Dual 0x0707 و NEC وبروتوكول التكييف 38kHz) مع جداول أوامر الشاشات والمكيفات.",
    content: "export const CARRIER_38KHZ = 38000;\n\nexport function pushByteLsbFirst(pattern, byteValue) {\n  const b = byteValue & 0xff;\n  for (let bit = 0; bit < 8; bit++) {\n    const isOne = ((b >>> bit) & 1) === 1;\n    pattern.push(560);\n    pattern.push(isOne ? 1690 : 560);\n  }\n}\n\nexport function encodeSamsungDual0707(commandHex, addressHigh = 0x07, addressLow = 0x07) {\n  const cmd = commandHex & 0xff;\n  const cmdInv = ~cmd & 0xff;\n  const pattern = [4500, 4500];\n  pushByteLsbFirst(pattern, addressHigh);\n  pushByteLsbFirst(pattern, addressLow);\n  pushByteLsbFirst(pattern, cmd);\n  pushByteLsbFirst(pattern, cmdInv);\n  pattern.push(560);\n  return pattern;\n}\n\nexport function encodeNecToMicroseconds(addressHex, commandHex) {\n  const addr = addressHex & 0xff;\n  const addrInv = ~addr & 0xff;\n  const cmd = commandHex & 0xff;\n  const cmdInv = ~cmd & 0xff;\n\n  const pattern = [9000, 4500];\n  pushByteLsbFirst(pattern, addr);\n  pushByteLsbFirst(pattern, addrInv);\n  pushByteLsbFirst(pattern, cmd);\n  pushByteLsbFirst(pattern, cmdInv);\n  pattern.push(560);\n  return pattern;\n}\n\nexport const TV_IR_BRANDS = {\n  samsung: {\n    label: 'Samsung (0x0707)',\n    protocol: 'samsung_dual',\n    addressHigh: 0x07,\n    addressLow: 0x07,\n    commands: {\n      POWER: 0x02,\n      VOL_UP: 0x07,\n      VOL_DOWN: 0x0b,\n      MUTE: 0x0f,\n      CH_UP: 0x12,\n      CH_DOWN: 0x10,\n      UP: 0x60,\n      DOWN: 0x61,\n      LEFT: 0x65,\n      RIGHT: 0x62,\n      OK: 0x68,\n      BACK: 0x58,\n      HOME: 0x79,\n      MENU: 0x1a,\n      INPUT: 0x01,\n      YOUTUBE: 0x7c,\n      NETFLIX: 0x34,\n    },\n  },\n  lg: {\n    label: 'LG TV (NEC)',\n    protocol: 'nec',\n    address: 0x04,\n    commands: {\n      POWER: 0x08,\n      VOL_UP: 0x02,\n      VOL_DOWN: 0x03,\n      MUTE: 0x09,\n      CH_UP: 0x00,\n      CH_DOWN: 0x01,\n      UP: 0x40,\n      DOWN: 0x41,\n      LEFT: 0x07,\n      RIGHT: 0x06,\n      OK: 0x44,\n      BACK: 0x28,\n      HOME: 0x7c,\n      MENU: 0x43,\n      INPUT: 0x0b,\n    },\n  },\n};\n\nexport function buildAcIrPattern(brandKey, acState) {\n  const brandAddress = brandKey === 'carrier' ? 0x4d : 0x58;\n  const modeMap = { cool: 1, dry: 2, fan: 3, heat: 4, auto: 0 };\n  const fanMap = { auto: 0, low: 1, medium: 2, high: 3 };\n  const clampedTemp = Math.max(16, Math.min(30, acState.temperature));\n  const tempOffset = clampedTemp - 16;\n\n  const modeCode = modeMap[acState.mode] !== undefined ? modeMap[acState.mode] : 1;\n  const fanCode = fanMap[acState.fanSpeed] !== undefined ? fanMap[acState.fanSpeed] : 0;\n\n  const stateByte =\n    ((acState.power ? 1 : 0) << 7) |\n    (modeCode << 4) |\n    (fanCode << 2) |\n    (acState.swing ? 0x02 : 0x00);\n\n  return [\n    ...encodeNecToMicroseconds(brandAddress, stateByte),\n    20000,\n    ...encodeNecToMicroseconds(brandAddress ^ 0x0f, tempOffset),\n  ];\n}\n\nexport const AC_MODES = [\n  { key: 'cool', label: 'تبريد' },\n  { key: 'heat', label: 'تدفئة' },\n  { key: 'dry', label: 'تجفيف' },\n  { key: 'fan', label: 'مروحة' },\n  { key: 'auto', label: 'تلقائي' },\n];\n\nexport const FAN_SPEEDS = [\n  { key: 'auto', label: 'تلقائي' },\n  { key: 'low', label: 'منخفض' },\n  { key: 'medium', label: 'متوسط' },\n  { key: 'high', label: 'عالي' },\n];\n",
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
    id: "wifi-service-js",
    path: "src/services/WifiControl.js",
    titleAr: "خدمة الواي فاي والاستكشاف التلقائي (Samsung Tizen / Android TV / Roku)",
    category: "services",
    language: "javascript",
    summaryAr:
      "تدير الاستكشاف التلقائي للشاشات عبر الشبكة المحلية، حفظ Token في AsyncStorage، اتصال WebSocket لـ Samsung Tizen على 8002/8001، وبث YouTube.",
    content: "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport { Platform } from 'react-native';\n\nconst YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY';\n\nconst INVIDIOUS_INSTANCES = [\n  'https://inv.nadeko.net',\n  'https://invidious.nerdvpn.de',\n  'https://yewtu.be',\n];\n\nconst STORAGE_TOKEN_PREFIX = '@universal_remote_tizen_token_';\nconst STORAGE_LAST_TV_KEY = '@universal_remote_last_tv_config';\nconst SAMSUNG_REMOTE_APP_NAME = 'UniversalRemote'; // 15 حرفاً -> Base64 بدون '=' padding\nconst BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';\n\nfunction encodeBase64(input) {\n  const str = String(input || '');\n  let output = '';\n  for (let i = 0; i < str.length; i += 3) {\n    const b1 = str.charCodeAt(i) & 0xff;\n    const hasB2 = i + 1 < str.length;\n    const hasB3 = i + 2 < str.length;\n    const b2 = hasB2 ? str.charCodeAt(i + 1) & 0xff : 0;\n    const b3 = hasB3 ? str.charCodeAt(i + 2) & 0xff : 0;\n    const triplet = (b1 << 16) | (b2 << 8) | b3;\n\n    output += BASE64_CHARS[(triplet >>> 18) & 0x3f];\n    output += BASE64_CHARS[(triplet >>> 12) & 0x3f];\n    output += hasB2 ? BASE64_CHARS[(triplet >>> 6) & 0x3f] : '=';\n    output += hasB3 ? BASE64_CHARS[triplet & 0x3f] : '=';\n  }\n  return output;\n}\n\nconst WIFI_KEY_MAP = {\n  POWER: { roku: 'Power', androidTv: 'KEYCODE_POWER', tizen: 'KEY_POWER' },\n  VOL_UP: { roku: 'VolumeUp', androidTv: 'KEYCODE_VOLUME_UP', tizen: 'KEY_VOLUP' },\n  VOL_DOWN: { roku: 'VolumeDown', androidTv: 'KEYCODE_VOLUME_DOWN', tizen: 'KEY_VOLDOWN' },\n  MUTE: { roku: 'VolumeMute', androidTv: 'KEYCODE_VOLUME_MUTE', tizen: 'KEY_MUTE' },\n  CH_UP: { roku: 'ChannelUp', androidTv: 'KEYCODE_CHANNEL_UP', tizen: 'KEY_CHUP' },\n  CH_DOWN: { roku: 'ChannelDown', androidTv: 'KEYCODE_CHANNEL_DOWN', tizen: 'KEY_CHDOWN' },\n  UP: { roku: 'Up', androidTv: 'KEYCODE_DPAD_UP', tizen: 'KEY_UP' },\n  DOWN: { roku: 'Down', androidTv: 'KEYCODE_DPAD_DOWN', tizen: 'KEY_DOWN' },\n  LEFT: { roku: 'Left', androidTv: 'KEYCODE_DPAD_LEFT', tizen: 'KEY_LEFT' },\n  RIGHT: { roku: 'Right', androidTv: 'KEYCODE_DPAD_RIGHT', tizen: 'KEY_RIGHT' },\n  OK: { roku: 'Select', androidTv: 'KEYCODE_DPAD_CENTER', tizen: 'KEY_ENTER' },\n  BACK: { roku: 'Back', androidTv: 'KEYCODE_BACK', tizen: 'KEY_RETURN' },\n  HOME: { roku: 'Home', androidTv: 'KEYCODE_HOME', tizen: 'KEY_HOME' },\n  MENU: { roku: 'Info', androidTv: 'KEYCODE_MENU', tizen: 'KEY_MENU' },\n  INPUT: { roku: 'InputHDMI1', androidTv: 'KEYCODE_TV_INPUT', tizen: 'KEY_SOURCE' },\n  YOUTUBE: { roku: 'Home', androidTv: 'KEYCODE_MEDIA_TOP_MENU', tizen: 'KEY_APPS' },\n  NETFLIX: { roku: 'Netflix', androidTv: 'KEYCODE_BUTTON_1', tizen: 'KEY_NETFLIX' },\n};\n\nfunction formatDurationSeconds(seconds) {\n  if (!seconds || seconds <= 0) return '';\n  const mins = Math.floor(seconds / 60);\n  const secs = seconds % 60;\n  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;\n}\n\nfunction extractSubnetPrefix(ip) {\n  const parts = String(ip || '')\n    .trim()\n    .split('.');\n  if (parts.length >= 3 && parts.slice(0, 3).every((p) => /^\\d{1,3}$/.test(p))) {\n    return `${parts[0]}.${parts[1]}.${parts[2]}`;\n  }\n  return '192.168.1';\n}\n\nfunction extractXmlTagValue(xmlText, tagName) {\n  if (!xmlText) return '';\n  const regex = new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, 'i');\n  const match = xmlText.match(regex);\n  return match && match[1] ? match[1].trim() : '';\n}\n\nclass WifiControlService {\n  constructor() {\n    this.protocol = 'samsung_tizen'; // 'samsung_tizen' | 'android_tv' | 'roku'\n    this.ipAddress = '192.168.1.50';\n    this.port = 8002;\n    this.dialPort = 8080;\n    this.ws = null;\n    this.isConnected = false;\n    this.pairingState = 'idle'; // 'idle' | 'connecting' | 'awaiting_approval' | 'paired' | 'unauthorized'\n    this.authToken = null;\n    this.deviceName = '';\n    this.reconnectAttempts = 0;\n    this.maxReconnectAttempts = 5;\n    this.commandQueue = [];\n    this.listeners = new Set();\n    this.isScanning = false;\n    this.scanAborted = false;\n    this.manualDisconnect = false;\n  }\n\n  subscribe(listener) {\n    this.listeners.add(listener);\n    listener(this.getStatus());\n    return () => this.listeners.delete(listener);\n  }\n\n  getStatus() {\n    return {\n      isConnected: this.isConnected,\n      protocol: this.protocol,\n      ipAddress: this.ipAddress,\n      port: this.port,\n      dialPort: this.dialPort,\n      pairingState: this.pairingState,\n      hasSavedToken: Boolean(this.authToken),\n      deviceName: this.deviceName,\n      isScanning: this.isScanning,\n    };\n  }\n\n  _notify() {\n    const status = this.getStatus();\n    this.listeners.forEach((cb) => cb(status));\n  }\n\n  _defaultPortForProtocol(protocol) {\n    if (protocol === 'roku') return 8060;\n    if (protocol === 'samsung_tizen') return 8002;\n    return 8080;\n  }\n\n  _defaultDialPortForProtocol(protocol) {\n    if (protocol === 'roku') return 8060;\n    if (protocol === 'samsung_tizen') return 8080;\n    return 8008;\n  }\n\n  _tokenStorageKey(ip) {\n    return `${STORAGE_TOKEN_PREFIX}${String(ip || this.ipAddress).trim()}`;\n  }\n\n  async getSavedToken(ip = this.ipAddress) {\n    try {\n      const token = await AsyncStorage.getItem(this._tokenStorageKey(ip));\n      const cleanToken = token ? token.trim() : null;\n      if (ip === this.ipAddress) {\n        this.authToken = cleanToken;\n        if (cleanToken && this.pairingState === 'idle') {\n          this.pairingState = 'paired';\n        }\n        this._notify();\n      }\n      return cleanToken;\n    } catch (_) {\n      return null;\n    }\n  }\n\n  async saveToken(ip, token) {\n    if (!token) return;\n    const cleanToken = String(token).trim();\n    if (!cleanToken) return;\n    try {\n      await AsyncStorage.setItem(this._tokenStorageKey(ip), cleanToken);\n    } catch (_) {\n      // الاحتفاظ بالـ Token في الذاكرة في حال تعذر التخزين المؤقت\n    }\n    if (ip === this.ipAddress) {\n      this.authToken = cleanToken;\n      this.pairingState = 'paired';\n      this._notify();\n    }\n  }\n\n  async clearToken(ip = this.ipAddress) {\n    try {\n      await AsyncStorage.removeItem(this._tokenStorageKey(ip));\n    } catch (_) {\n      // ignore\n    }\n    if (ip === this.ipAddress) {\n      this.authToken = null;\n      this.pairingState = 'idle';\n      this._notify();\n    }\n  }\n\n  async saveLastTvConfig(config) {\n    try {\n      await AsyncStorage.setItem(STORAGE_LAST_TV_KEY, JSON.stringify(config));\n    } catch (_) {\n      // ignore\n    }\n  }\n\n  async loadSavedConfig() {\n    try {\n      const raw = await AsyncStorage.getItem(STORAGE_LAST_TV_KEY);\n      if (raw) {\n        const parsed = JSON.parse(raw);\n        if (parsed && parsed.ipAddress) {\n          this.protocol = parsed.protocol || 'samsung_tizen';\n          this.ipAddress = parsed.ipAddress;\n          this.port = Number(parsed.port) || this._defaultPortForProtocol(this.protocol);\n          this.dialPort =\n            Number(parsed.dialPort) || this._defaultDialPortForProtocol(this.protocol);\n          this.deviceName = parsed.deviceName || '';\n        }\n      }\n      if (this.protocol === 'samsung_tizen') {\n        await this.getSavedToken(this.ipAddress);\n      }\n      this._notify();\n      return this.getStatus();\n    } catch (_) {\n      return this.getStatus();\n    }\n  }\n\n  configure({ protocol, ipAddress, port, dialPort, deviceName }) {\n    const nextProtocol = protocol || this.protocol;\n    const nextIp = (ipAddress || this.ipAddress).trim();\n    const nextPort = Number(port) || this._defaultPortForProtocol(nextProtocol);\n    const nextDialPort = Number(dialPort) || this._defaultDialPortForProtocol(nextProtocol);\n    const nextDeviceName =\n      deviceName !== undefined ? deviceName : nextIp !== this.ipAddress ? '' : this.deviceName;\n\n    const changed =\n      nextProtocol !== this.protocol ||\n      nextIp !== this.ipAddress ||\n      nextPort !== this.port ||\n      nextDialPort !== this.dialPort;\n\n    this.protocol = nextProtocol;\n    this.ipAddress = nextIp;\n    this.port = nextPort;\n    this.dialPort = nextDialPort;\n    this.deviceName = nextDeviceName;\n\n    if (changed) {\n      this.authToken = null;\n      this.pairingState = 'idle';\n      this.disconnect();\n      this.saveLastTvConfig({\n        protocol: this.protocol,\n        ipAddress: this.ipAddress,\n        port: this.port,\n        dialPort: this.dialPort,\n        deviceName: this.deviceName,\n      });\n      if (this.protocol === 'samsung_tizen') {\n        this.getSavedToken(this.ipAddress).catch(() => {});\n      }\n    }\n    this._notify();\n  }\n\n  async connect() {\n    this.manualDisconnect = false;\n    if (Platform.OS === 'web') {\n      this.isConnected = true;\n      this.pairingState = 'paired';\n      if (this.protocol === 'samsung_tizen' && !this.authToken) {\n        await this.saveToken(this.ipAddress, 'mock-web-preview-token');\n      }\n      this._notify();\n      return {\n        connected: true,\n        mocked: true,\n        protocol: this.protocol,\n        token: this.authToken,\n      };\n    }\n    if (this.protocol === 'roku') {\n      return this._verifyRokuRest();\n    }\n\n    if (this.protocol === 'samsung_tizen') {\n      const savedToken = await this.getSavedToken(this.ipAddress);\n      // محاولة الاتصال أولاً عبر wss:// (منفذ 8002) ثم الرجوع احتياطياً إلى ws:// (منفذ 8001) عند الفشل\n      const primaryPort = Number(this.port) === 8001 ? 8002 : Number(this.port) || 8002;\n      const fallbackPort = primaryPort === 8002 ? 8001 : 8002;\n\n      try {\n        const res = await this._connectTvSocket(primaryPort, savedToken);\n        if (this.port !== primaryPort) {\n          this.port = primaryPort;\n          this.saveLastTvConfig({\n            protocol: this.protocol,\n            ipAddress: this.ipAddress,\n            port: this.port,\n            dialPort: this.dialPort,\n            deviceName: this.deviceName,\n          });\n          this._notify();\n        }\n        return res;\n      } catch (primaryErr) {\n        if (this.pairingState !== 'unauthorized' && !this.manualDisconnect) {\n          try {\n            const fallbackRes = await this._connectTvSocket(fallbackPort, savedToken);\n            this.port = fallbackPort;\n            this.saveLastTvConfig({\n              protocol: this.protocol,\n              ipAddress: this.ipAddress,\n              port: this.port,\n              dialPort: this.dialPort,\n              deviceName: this.deviceName,\n            });\n            this._notify();\n            return fallbackRes;\n          } catch (_) {\n            throw primaryErr;\n          }\n        }\n        throw primaryErr;\n      }\n    }\n\n    return this._connectTvSocket(this.port, null);\n  }\n\n  async _verifyRokuRest() {\n    const controller = new AbortController();\n    const timer = setTimeout(() => controller.abort(), 3500);\n\n    try {\n      const response = await fetch(\n        `http://${this.ipAddress}:${this.port}/query/device-info`,\n        {\n          method: 'GET',\n          signal: controller.signal,\n        }\n      );\n      if (!response.ok) {\n        throw new Error(`HTTP ${response.status}`);\n      }\n      this.isConnected = true;\n      this.pairingState = 'paired';\n      this._notify();\n      return { connected: true, protocol: 'roku' };\n    } catch (error) {\n      this.isConnected = false;\n      this.pairingState = 'idle';\n      this._notify();\n      throw new Error(`تعذر الاتصال بشاشة Roku على ${this.ipAddress}:${this.port}`);\n    } finally {\n      clearTimeout(timer);\n    }\n  }\n\n  _buildWebSocketUrl(portOverride, tokenOverride) {\n    const targetPort = Number(portOverride || this.port);\n    if (this.protocol === 'samsung_tizen') {\n      const encodedName = encodeURIComponent(encodeBase64(SAMSUNG_REMOTE_APP_NAME));\n      const scheme = targetPort === 8002 ? 'wss' : 'ws';\n      const tokenPart = tokenOverride\n        ? `&token=${encodeURIComponent(tokenOverride)}`\n        : '';\n      return `${scheme}://${this.ipAddress}:${targetPort}/api/v2/channels/samsung.remote.control?name=${encodedName}${tokenPart}`;\n    }\n    return `ws://${this.ipAddress}:${targetPort}/remote`;\n  }\n\n  _connectTvSocket(portOverride = this.port, tokenOverride = this.authToken) {\n    return new Promise((resolve, reject) => {\n      if (this.ws && this.ws.readyState === WebSocket.OPEN) {\n        this.isConnected = true;\n        this._notify();\n        resolve({ connected: true, protocol: this.protocol, token: this.authToken });\n        return;\n      }\n\n      if (this.ws) {\n        try {\n          this.ws.onopen = null;\n          this.ws.onmessage = null;\n          this.ws.onclose = null;\n          this.ws.onerror = null;\n          this.ws.close();\n        } catch (_) {\n          // ignore\n        }\n        this.ws = null;\n      }\n\n      this.pairingState = tokenOverride ? 'connecting' : 'awaiting_approval';\n      this._notify();\n\n      const wsUrl = this._buildWebSocketUrl(portOverride, tokenOverride);\n      const socket = new WebSocket(wsUrl);\n      this.ws = socket;\n      let settled = false;\n      let handshakeTimer = null;\n\n      const finishResolve = (payload) => {\n        if (settled) return;\n        settled = true;\n        clearTimeout(connectTimeoutId);\n        if (handshakeTimer) clearTimeout(handshakeTimer);\n        resolve(payload);\n      };\n\n      const finishReject = (err) => {\n        if (settled) return;\n        settled = true;\n        clearTimeout(connectTimeoutId);\n        if (handshakeTimer) clearTimeout(handshakeTimer);\n        reject(err);\n      };\n\n      const connectTimeoutId = setTimeout(() => {\n        if (socket.readyState !== WebSocket.OPEN) {\n          try {\n            socket.close();\n          } catch (_) {\n            // ignore\n          }\n          this.isConnected = false;\n          this.pairingState = 'idle';\n          this._notify();\n          finishReject(\n            new Error(`انتهت مهلة اتصال WebSocket على ${this.ipAddress}:${portOverride}`)\n          );\n        }\n      }, 6000);\n\n      socket.onopen = () => {\n        clearTimeout(connectTimeoutId);\n        this.isConnected = true;\n        this.reconnectAttempts = 0;\n        this._notify();\n\n        if (this.protocol !== 'samsung_tizen') {\n          this.pairingState = 'paired';\n          this._notify();\n          this._flushQueue();\n          finishResolve({ connected: true, protocol: this.protocol });\n          return;\n        }\n\n        // انتظار حدث استجابة الشاشة ms.channel.connect لاستخراج data.data.token\n        handshakeTimer = setTimeout(() => {\n          if (socket.readyState === WebSocket.OPEN) {\n            if (tokenOverride) {\n              this.pairingState = 'paired';\n            }\n            this._notify();\n            this._flushQueue();\n            finishResolve({\n              connected: true,\n              protocol: this.protocol,\n              token: this.authToken,\n            });\n          }\n        }, 1600);\n      };\n\n      socket.onmessage = async (event) => {\n        if (this.protocol !== 'samsung_tizen') return;\n        let data = null;\n        try {\n          data = JSON.parse(event.data);\n        } catch (_) {\n          return;\n        }\n        if (!data || !data.event) return;\n\n        if (data.event === 'ms.channel.connect') {\n          const receivedToken =\n            (data.data && data.data.token) ||\n            data.token ||\n            null;\n\n          if (receivedToken) {\n            await this.saveToken(this.ipAddress, String(receivedToken));\n          } else {\n            this.pairingState = 'paired';\n            this._notify();\n          }\n          this.isConnected = true;\n          this._flushQueue();\n          finishResolve({\n            connected: true,\n            protocol: this.protocol,\n            token: receivedToken ? String(receivedToken) : this.authToken,\n          });\n        } else if (data.event === 'ms.channel.unauthorized') {\n          this.isConnected = false;\n          this.pairingState = 'unauthorized';\n          if (tokenOverride) {\n            await this.clearToken(this.ipAddress);\n            this.pairingState = 'unauthorized';\n          }\n          this._notify();\n          finishReject(\n            new Error(\n              'الشاشة تطلب الموافقة على الاقتران — يرجى الضغط على \"سماح\" (Allow) في شاشة التلفاز.'\n            )\n          );\n        } else if (data.event === 'ms.channel.timeOut') {\n          this.isConnected = false;\n          this.pairingState = 'idle';\n          this._notify();\n          finishReject(\n            new Error('انتهت مهلة الموافقة على شاشة التلفاز. أعد المحاولة واضغط \"سماح\".')\n          );\n        }\n      };\n\n      socket.onclose = () => {\n        clearTimeout(connectTimeoutId);\n        if (handshakeTimer) clearTimeout(handshakeTimer);\n        this.isConnected = false;\n        this._notify();\n        if (!settled) {\n          finishReject(\n            new Error(`تم إغلاق الاتصال مع الشاشة (${this.ipAddress}:${portOverride})`)\n          );\n        }\n        if (!this.manualDisconnect && this.pairingState !== 'unauthorized') {\n          this._scheduleReconnect();\n        }\n      };\n\n      socket.onerror = () => {\n        clearTimeout(connectTimeoutId);\n        if (handshakeTimer) clearTimeout(handshakeTimer);\n        this.isConnected = false;\n        this._notify();\n        finishReject(\n          new Error(`فشل اتصال WebSocket مع الشاشة (${this.ipAddress}:${portOverride})`)\n        );\n      };\n    });\n  }\n\n  _scheduleReconnect() {\n    if (this.protocol === 'roku' || this.manualDisconnect) return;\n    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;\n\n    this.reconnectAttempts += 1;\n    const delayMs = Math.min(8000, 1000 * Math.pow(2, this.reconnectAttempts - 1));\n    setTimeout(() => {\n      if (!this.isConnected && !this.manualDisconnect && this.protocol !== 'roku') {\n        this.connect().catch(() => {});\n      }\n    }, delayMs);\n  }\n\n  _flushQueue() {\n    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;\n    while (this.commandQueue.length > 0) {\n      const payload = this.commandQueue.shift();\n      this.ws.send(JSON.stringify(payload));\n    }\n  }\n\n  disconnect() {\n    this.manualDisconnect = true;\n    if (this.ws) {\n      this.ws.onopen = null;\n      this.ws.onmessage = null;\n      this.ws.onclose = null;\n      this.ws.onerror = null;\n      try {\n        this.ws.close();\n      } catch (_) {\n        // ignore\n      }\n      this.ws = null;\n    }\n    this.isConnected = false;\n    this.commandQueue = [];\n    this._notify();\n  }\n\n  /**\n   * فحص الشبكة المحلية لاكتشاف الشاشات الذكية (Samsung Tizen / Android TV / Roku)\n   */\n  async _probeHostForTv(ip) {\n    // 1. فحص خدمة Samsung Tizen REST API على المنفذ 8001\n    try {\n      const controller = new AbortController();\n      const timer = setTimeout(() => controller.abort(), 520);\n      try {\n        const res = await fetch(`http://${ip}:8001/api/v2/`, {\n          method: 'GET',\n          signal: controller.signal,\n        });\n        if (res.ok) {\n          const data = await res.json();\n          const device = data && data.device ? data.device : {};\n          const tokenSupport =\n            device.TokenAuthSupport === 'true' ||\n            device.tokenAuthSupport === true ||\n            device.TokenAuthSupport === true;\n          return {\n            ip,\n            protocol: 'samsung_tizen',\n            port: 8002,\n            fallbackPort: 8001,\n            dialPort: 8080,\n            name: device.name || data.name || 'Samsung Smart TV',\n            modelName: device.modelName || 'Tizen TV',\n            tokenAuthSupport: Boolean(tokenSupport),\n          };\n        }\n      } finally {\n        clearTimeout(timer);\n      }\n    } catch (_) {\n      // ليست شاشة سامسونج على المنفذ 8001\n    }\n\n    // 2. فحص Roku ECP على المنفذ 8060\n    try {\n      const controller = new AbortController();\n      const timer = setTimeout(() => controller.abort(), 450);\n      try {\n        const res = await fetch(`http://${ip}:8060/query/device-info`, {\n          method: 'GET',\n          signal: controller.signal,\n        });\n        if (res.ok) {\n          const xml = await res.text();\n          return {\n            ip,\n            protocol: 'roku',\n            port: 8060,\n            dialPort: 8060,\n            name:\n              extractXmlTagValue(xml, 'friendly-device-name') ||\n              extractXmlTagValue(xml, 'user-device-name') ||\n              'Roku TV',\n            modelName: extractXmlTagValue(xml, 'model-name') || 'Roku ECP',\n            tokenAuthSupport: false,\n          };\n        }\n      } finally {\n        clearTimeout(timer);\n      }\n    } catch (_) {\n      // ليست شاشة Roku\n    }\n\n    // 3. فحص Android TV / Chromecast DIAL على المنفذ 8008\n    try {\n      const controller = new AbortController();\n      const timer = setTimeout(() => controller.abort(), 450);\n      try {\n        const res = await fetch(`http://${ip}:8008/setup/eureka_info`, {\n          method: 'GET',\n          signal: controller.signal,\n        });\n        if (res.ok) {\n          const data = await res.json();\n          return {\n            ip,\n            protocol: 'android_tv',\n            port: 8080,\n            dialPort: 8008,\n            name: (data && data.name) || 'Android TV',\n            modelName: (data && data.model_name) || 'Chromecast / Android TV',\n            tokenAuthSupport: false,\n          };\n        }\n      } finally {\n        clearTimeout(timer);\n      }\n    } catch (_) {\n      // ليست شاشة Android TV على 8008\n    }\n\n    return null;\n  }\n\n  abortDiscovery() {\n    this.scanAborted = true;\n    this.isScanning = false;\n    this._notify();\n  }\n\n  async discoverSmartTvs({ subnetPrefix, onProgress, onDeviceFound } = {}) {\n    const cleanSubnet = extractSubnetPrefix(subnetPrefix || this.ipAddress);\n    this.isScanning = true;\n    this.scanAborted = false;\n    this._notify();\n\n    if (Platform.OS === 'web') {\n      const mockDevices = [\n        {\n          ip: `${cleanSubnet}.50`,\n          protocol: 'samsung_tizen',\n          port: 8002,\n          fallbackPort: 8001,\n          dialPort: 8080,\n          name: 'Samsung QLED 65 (معاينة)',\n          modelName: 'QE65Q80C · Tizen TV',\n          tokenAuthSupport: true,\n        },\n        {\n          ip: `${cleanSubnet}.64`,\n          protocol: 'android_tv',\n          port: 8080,\n          dialPort: 8008,\n          name: 'Living Room Android TV',\n          modelName: 'Google TV / Chromecast',\n          tokenAuthSupport: false,\n        },\n      ];\n      await new Promise((r) => setTimeout(r, 250));\n      if (!this.scanAborted) {\n        mockDevices.forEach((d) => onDeviceFound && onDeviceFound(d));\n        if (onProgress) {\n          onProgress({ scanned: 254, total: 254, foundDevices: mockDevices });\n        }\n      }\n      this.isScanning = false;\n      this._notify();\n      return mockDevices;\n    }\n\n    const candidateIps = [];\n    if (this.ipAddress && this.ipAddress.startsWith(`${cleanSubnet}.`)) {\n      candidateIps.push(this.ipAddress);\n    }\n    for (let host = 1; host <= 254; host += 1) {\n      const ip = `${cleanSubnet}.${host}`;\n      if (ip !== this.ipAddress) {\n        candidateIps.push(ip);\n      }\n    }\n\n    const foundMap = new Map();\n    const total = candidateIps.length;\n    const batchSize = 24;\n    let scanned = 0;\n\n    try {\n      for (let i = 0; i < candidateIps.length; i += batchSize) {\n        if (this.scanAborted) break;\n        const batch = candidateIps.slice(i, i + batchSize);\n        const results = await Promise.all(batch.map((ip) => this._probeHostForTv(ip)));\n\n        for (const device of results) {\n          if (device && !foundMap.has(device.ip)) {\n            foundMap.set(device.ip, device);\n            if (onDeviceFound) {\n              onDeviceFound(device);\n            }\n          }\n        }\n\n        scanned += batch.length;\n        if (onProgress) {\n          onProgress({\n            scanned: Math.min(scanned, total),\n            total,\n            foundDevices: Array.from(foundMap.values()),\n          });\n        }\n      }\n\n      const finalList = Array.from(foundMap.values()).sort((a, b) => {\n        if (a.protocol === 'samsung_tizen' && b.protocol !== 'samsung_tizen') return -1;\n        if (a.protocol !== 'samsung_tizen' && b.protocol === 'samsung_tizen') return 1;\n        return a.ip.localeCompare(b.ip);\n      });\n\n      return finalList;\n    } finally {\n      this.isScanning = false;\n      this._notify();\n    }\n  }\n\n  _buildWsPayload(mapped) {\n    if (this.protocol === 'samsung_tizen') {\n      return {\n        method: 'ms.remote.control',\n        params: {\n          Cmd: 'Click',\n          DataOfCmd: mapped.tizen,\n          Option: 'false',\n          TypeOfRemote: 'SendRemoteKey',\n        },\n      };\n    }\n    return {\n      type: 'KEY_EVENT',\n      keyCode: mapped.androidTv,\n      action: 'CLICK',\n      timestamp: Date.now(),\n    };\n  }\n\n  async sendCommand(commandKey) {\n    const mapped = WIFI_KEY_MAP[commandKey];\n    if (!mapped) {\n      throw new Error(`الأمر ${commandKey} غير مدعوم عبر الواي فاي.`);\n    }\n\n    if (Platform.OS === 'web') {\n      this.isConnected = true;\n      this.pairingState = 'paired';\n      this._notify();\n      return {\n        sent: true,\n        mocked: true,\n        protocol: this.protocol,\n        payload: this._buildWsPayload(mapped),\n      };\n    }\n\n    if (this.protocol === 'roku') {\n      const controller = new AbortController();\n      const timer = setTimeout(() => controller.abort(), 3000);\n      try {\n        const endpoint = `http://${this.ipAddress}:${this.port}/keypress/${mapped.roku}`;\n        const response = await fetch(endpoint, {\n          method: 'POST',\n          signal: controller.signal,\n        });\n        if (!response.ok) {\n          throw new Error(`فشل أمر Roku ECP (${response.status})`);\n        }\n        this.isConnected = true;\n        this._notify();\n        return { sent: true, protocol: 'roku', key: mapped.roku };\n      } finally {\n        clearTimeout(timer);\n      }\n    }\n\n    const payload = this._buildWsPayload(mapped);\n\n    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {\n      this.commandQueue.push(payload);\n      await this.connect();\n    } else {\n      this.ws.send(JSON.stringify(payload));\n    }\n\n    return { sent: true, protocol: this.protocol, payload };\n  }\n\n  async _postWithTimeout(url, options = {}, timeoutMs = 4000) {\n    const controller = new AbortController();\n    const timer = setTimeout(() => controller.abort(), timeoutMs);\n    try {\n      const response = await fetch(url, {\n        ...options,\n        signal: controller.signal,\n      });\n      return response;\n    } finally {\n      clearTimeout(timer);\n    }\n  }\n\n  /**\n   * فتح تطبيق يوتيوب مباشرة على الشاشة الذكية عبر DIAL / REST\n   */\n  async launchYouTube() {\n    if (Platform.OS === 'web') {\n      return { launched: true, mocked: true, endpoint: `http://${this.ipAddress}:${this.dialPort}/ws/apps/YouTube` };\n    }\n    if (this.protocol === 'roku') {\n      const url = `http://${this.ipAddress}:${this.port}/launch/837`;\n      const res = await this._postWithTimeout(url, { method: 'POST' });\n      if (!res.ok) {\n        throw new Error(`تعذر فتح يوتيوب على Roku (${res.status})`);\n      }\n      return { launched: true, endpoint: url };\n    }\n\n    const candidateUrls =\n      this.protocol === 'samsung_tizen'\n        ? [\n            `http://${this.ipAddress}:${this.dialPort}/ws/apps/YouTube`,\n            `http://${this.ipAddress}:8001/api/v2/applications/111299001912`,\n            `http://${this.ipAddress}:8008/apps/YouTube`,\n          ]\n        : [\n            `http://${this.ipAddress}:${this.dialPort}/apps/YouTube`,\n            `http://${this.ipAddress}:8080/ws/apps/YouTube`,\n          ];\n\n    for (const url of candidateUrls) {\n      try {\n        const res = await this._postWithTimeout(url, {\n          method: 'POST',\n          headers: { 'Content-Type': 'text/plain; charset=utf-8' },\n        });\n        if (res.ok || res.status === 201 || res.status === 204) {\n          return { launched: true, endpoint: url };\n        }\n      } catch (_) {\n        // تجربة المسار التالي\n      }\n    }\n\n    throw new Error(\n      `تعذر فتح تطبيق يوتيوب على ${this.ipAddress}. تأكد من اتصال الهاتف والشاشة بنفس شبكة الواي فاي.`\n    );\n  }\n\n  /**\n   * إرسال فيديو محدد (Cast) وتشغيله فوراً على الشاشة عبر بروتوكول DIAL\n   */\n  async castYouTubeVideo(videoId) {\n    if (!videoId) {\n      throw new Error('معرف الفيديو غير صالح.');\n    }\n\n    if (Platform.OS === 'web') {\n      return { casted: true, mocked: true, videoId };\n    }\n\n    if (this.protocol === 'roku') {\n      const url = `http://${this.ipAddress}:${this.port}/launch/837?contentId=${encodeURIComponent(\n        videoId\n      )}&mediaType=live`;\n      const res = await this._postWithTimeout(url, { method: 'POST' });\n      if (!res.ok) {\n        throw new Error(`فشل بث الفيديو على Roku (${res.status})`);\n      }\n      return { casted: true, videoId, endpoint: url };\n    }\n\n    const dialBody = `v=${encodeURIComponent(videoId)}`;\n    const candidateUrls =\n      this.protocol === 'samsung_tizen'\n        ? [\n            `http://${this.ipAddress}:${this.dialPort}/ws/apps/YouTube`,\n            `http://${this.ipAddress}:8008/apps/YouTube`,\n          ]\n        : [\n            `http://${this.ipAddress}:${this.dialPort}/apps/YouTube`,\n            `http://${this.ipAddress}:8080/ws/apps/YouTube`,\n          ];\n\n    for (const url of candidateUrls) {\n      try {\n        const res = await this._postWithTimeout(url, {\n          method: 'POST',\n          headers: { 'Content-Type': 'text/plain; charset=utf-8' },\n          body: dialBody,\n        });\n        if (res.ok || res.status === 201 || res.status === 204) {\n          return { casted: true, videoId, endpoint: url };\n        }\n      } catch (_) {\n        // تجربة المسار التالي\n      }\n    }\n\n    throw new Error(\n      `تعذر تشغيل الفيديو (${videoId}) عبر DIAL على ${this.ipAddress}.`\n    );\n  }\n\n  /**\n   * البحث في يوتيوب عبر YouTube Data API v3 (عند توفر المفتاح)\n   * أو عبر واجهة Invidious مفتوحة المصدر تلقائياً دون الحاجة لمفتاح\n   */\n  async searchYouTubeVideos(query) {\n    const cleanQuery = (query || '').trim();\n    if (!cleanQuery) {\n      throw new Error('أدخل عبارة للبحث في يوتيوب.');\n    }\n\n    if (YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY') {\n      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(\n        cleanQuery\n      )}&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;\n\n      const res = await this._postWithTimeout(apiUrl, { method: 'GET' }, 7000);\n      if (!res.ok) {\n        throw new Error(`فشل البحث عبر YouTube Data API (${res.status})`);\n      }\n      const data = await res.json();\n      return (data.items || [])\n        .filter((item) => item && item.id && item.id.videoId)\n        .map((item) => ({\n          videoId: item.id.videoId,\n          title: item.snippet.title || 'فيديو يوتيوب',\n          channelTitle: item.snippet.channelTitle || 'YouTube',\n          thumbnailUrl:\n            (item.snippet.thumbnails &&\n              ((item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url) ||\n                (item.snippet.thumbnails.default && item.snippet.thumbnails.default.url))) ||\n            `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,\n          durationText: '',\n        }));\n    }\n\n    for (const baseUrl of INVIDIOUS_INSTANCES) {\n      try {\n        const searchUrl = `${baseUrl}/api/v1/search?q=${encodeURIComponent(\n          cleanQuery\n        )}&type=video`;\n        const res = await this._postWithTimeout(searchUrl, { method: 'GET' }, 6500);\n        if (!res.ok) continue;\n\n        const items = await res.json();\n        if (!Array.isArray(items)) continue;\n\n        const normalized = items\n          .filter((item) => item && item.videoId)\n          .slice(0, 12)\n          .map((item) => {\n            const thumbs = Array.isArray(item.videoThumbnails) ? item.videoThumbnails : [];\n            const preferredThumb =\n              thumbs.find((t) => t.quality === 'medium') || thumbs[0] || null;\n            return {\n              videoId: item.videoId,\n              title: item.title || 'فيديو يوتيوب',\n              channelTitle: item.author || 'YouTube',\n              thumbnailUrl:\n                (preferredThumb && preferredThumb.url) ||\n                `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,\n              durationText: formatDurationSeconds(item.lengthSeconds),\n            };\n          });\n\n        if (normalized.length > 0) {\n          return normalized;\n        }\n      } catch (_) {\n        // الانتقال تلقائياً إلى الخادم البديل\n      }\n    }\n\n    if (Platform.OS === 'web') {\n      return [\n        {\n          videoId: 'dQw4w9WgXcQ',\n          title: `${cleanQuery} — عرض تجريبي للمعاينة (YouTube Cast)`,\n          channelTitle: 'معاينة الريموت الشامل',\n          thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',\n          durationText: '3:33',\n        },\n        {\n          videoId: 'aqz-KE-bpKQ',\n          title: `Big Buck Bunny 4K · ${cleanQuery}`,\n          channelTitle: 'Blender Foundation',\n          thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg',\n          durationText: '9:56',\n        },\n      ];\n    }\n\n    throw new Error('تعذر جلب نتائج البحث حالياً. تحقق من اتصال الإنترنت وأعد المحاولة.');\n  }\n}\n\nexport const WifiControl = new WifiControlService();\nexport default WifiControl;\n",
  },
  {
    id: "theme-colors-js",
    path: "src/theme.js",
    titleAr: "نظام التصميم والألوان الداكنة OLED (theme.js)",
    category: "ui",
    language: "javascript",
    summaryAr:
      "يجمع ألوان OLED، المسافات، أنصاف الأقطار، وأحجام الخطوط في مصدر موحد لكامل التطبيق.",
    content: "export const colors = {\n  background: '#000000',\n  bg: '#000000',\n  surface: '#0E0E10',\n  surfaceRaised: '#161618',\n  border: '#232326',\n  textPrimary: '#FFFFFF',\n  textSecondary: '#8A8A8E',\n  textTertiary: '#5A5A5E',\n  accent: '#2C8EF8',\n  danger: '#FF453A',\n  accentSoft: 'rgba(44,142,248,0.12)',\n  accentSegment: 'rgba(44,142,248,0.15)',\n  dangerSoft: 'rgba(255,69,58,0.12)',\n  backdrop: 'rgba(0,0,0,0.84)',\n  transparent: 'transparent',\n};\n\nexport const spacing = {\n  xs: 4,\n  sm: 8,\n  md: 12,\n  lg: 16,\n  xl: 20,\n};\n\nexport const radii = {\n  button: 14,\n  panel: 18,\n  capsule: 999,\n};\n\nexport const fontSizes = {\n  micro: 10,\n  label: 11,\n  button: 14,\n  title: 17,\n  temp: 64,\n};\n\nexport default {\n  colors,\n  spacing,\n  radii,\n  fontSizes,\n};\n",
  },
  {
    id: "tv-remote-screen-js",
    path: "src/components/TvRemote.js",
    titleAr: "مكوّن ريموت الشاشة (TvRemote.js)",
    category: "ui",
    language: "javascript",
    summaryAr:
      "واجهة ريموت الشاشة المدمجة بدون سكرول: هيدر بكبسولة الجهاز وزر طاقة 52px، حلقة D-Pad قطر 240px بـ 4 اتجاهات RepeatableButton وزر OK بلون accent، صف 4 أزرار دائرية 56px، وكبسولتا الصوت والقنوات 72×168.",
    content: "import React from 'react';\nimport {\n  ActivityIndicator,\n  Image,\n  ScrollView,\n  StyleSheet,\n  Text,\n  TextInput,\n  TouchableOpacity,\n  View,\n} from 'react-native';\nimport { TV_IR_BRANDS } from '../ir/encoders';\nimport { colors, fontSizes, radii, spacing } from '../theme';\nimport RemoteIcon from './RemoteIcon';\nimport RepeatableButton from './RepeatableButton';\n\nfunction TvRemote({\n  tvTransport,\n  setTvTransport,\n  tvBrand,\n  setTvBrand,\n  wifiProtocol,\n  tvIp,\n  tvPort,\n  wifiStatus,\n  isDiscovering,\n  discoveredTvs,\n  hasScannedOnce,\n  onOpenSettings,\n  onScanSmartTvs,\n  onSelectDiscoveredTv,\n  onTvCommand,\n  onLaunchYouTube,\n  isLaunchingYouTube,\n  searchQuery,\n  setSearchQuery,\n  onSearchYouTube,\n  isSearching,\n  hasSearchedOnce,\n  searchResults,\n  castingVideoId,\n  onCastVideo,\n}) {\n  const protocolDisplayLabel =\n    wifiProtocol === 'samsung_tizen'\n      ? 'Samsung Tizen'\n      : wifiProtocol === 'roku'\n      ? 'Roku ECP'\n      : 'Android TV';\n\n  const renderRemoteControls = () => (\n    <>\n      {/* [ب] شريط الوضع (IR / Wi-Fi) — كبسولة مزدوجة ارتفاع 38 */}\n      <View style={styles.modeCapsule}>\n        <TouchableOpacity\n          style={[styles.modeBtn, tvTransport === 'ir' && styles.modeBtnActive]}\n          activeOpacity={0.55}\n          accessibilityLabel=\"وضع الأشعة تحت الحمراء\"\n          accessibilityRole=\"button\"\n          onPress={() => setTvTransport('ir')}\n        >\n          <Text style={[styles.modeText, tvTransport === 'ir' && styles.modeTextActive]}>\n            IR\n          </Text>\n        </TouchableOpacity>\n        <TouchableOpacity\n          style={[styles.modeBtn, tvTransport === 'wifi' && styles.modeBtnActive]}\n          activeOpacity={0.55}\n          accessibilityLabel=\"وضع الواي فاي\"\n          accessibilityRole=\"button\"\n          onPress={() => setTvTransport('wifi')}\n        >\n          <Text style={[styles.modeText, tvTransport === 'wifi' && styles.modeTextActive]}>\n            Wi-Fi\n          </Text>\n        </TouchableOpacity>\n      </View>\n\n      {/* [ج] صف الماركة أو الجهاز — ارتفاع 36 فقط */}\n      {tvTransport === 'ir' ? (\n        <View style={styles.brandRow}>\n          {['samsung', 'lg'].map((key) => {\n            const active = tvBrand === key;\n            return (\n              <TouchableOpacity\n                key={key}\n                style={[styles.brandCapsule, active && styles.brandCapsuleActive]}\n                activeOpacity={0.55}\n                accessibilityLabel={TV_IR_BRANDS[key].label}\n                accessibilityRole=\"button\"\n                onPress={() => setTvBrand(key)}\n              >\n                <Text style={[styles.brandText, active && styles.brandTextActive]}>\n                  {key === 'samsung' ? 'Samsung' : 'LG'}\n                </Text>\n              </TouchableOpacity>\n            );\n          })}\n        </View>\n      ) : (\n        <TouchableOpacity\n          style={styles.wifiDeviceCapsule}\n          activeOpacity={0.55}\n          accessibilityLabel=\"إعدادات الشاشة المتصلة\"\n          accessibilityRole=\"button\"\n          onPress={onOpenSettings}\n        >\n          <View\n            style={[\n              styles.wifiDot,\n              wifiStatus.isConnected ? styles.wifiDotActive : styles.wifiDotIdle,\n            ]}\n          />\n          <Text style={styles.wifiDeviceText} numberOfLines={1}>\n            {tvIp}:{tvPort} · {wifiStatus.deviceName || protocolDisplayLabel}\n          </Text>\n          <Text style={styles.wifiSettingsLink}>إعداد</Text>\n        </TouchableOpacity>\n      )}\n\n      {/* [د] الكتلة المركزية: [كبسولة صوت 60×186] [D-Pad 200×200] [كبسولة قناة 60×186] */}\n      <View style={styles.centerClusterRow}>\n        {/* كبسولة الصوت (يمين في RTL) */}\n        <View style={styles.rockerColumn}>\n          <Text style={styles.rockerLabel}>صوت</Text>\n          <View style={styles.verticalCapsule}>\n            <RepeatableButton\n              style={styles.capsuleHalfBtn}\n              initialDelayMs={260}\n              repeatIntervalMs={150}\n              activeOpacity={0.55}\n              accessibilityLabel=\"رفع الصوت\"\n              onAction={() => onTvCommand('VOL_UP')}\n            >\n              <RemoteIcon name=\"plus\" color={colors.textPrimary} size={18} />\n            </RepeatableButton>\n\n            <View style={styles.capsuleCenterIcon} pointerEvents=\"none\">\n              <RemoteIcon name=\"volume\" color={colors.textTertiary} size={20} />\n            </View>\n\n            <RepeatableButton\n              style={styles.capsuleHalfBtn}\n              initialDelayMs={260}\n              repeatIntervalMs={150}\n              activeOpacity={0.55}\n              accessibilityLabel=\"خفض الصوت\"\n              onAction={() => onTvCommand('VOL_DOWN')}\n            >\n              <RemoteIcon name=\"minus\" color={colors.textPrimary} size={18} />\n            </RepeatableButton>\n          </View>\n        </View>\n\n        {/* دائرة D-Pad 200×200 */}\n        <View style={styles.dpadColumn}>\n          <Text style={styles.rockerSpacer}> </Text>\n          <View style={styles.dpadCircle}>\n            <RepeatableButton\n              style={styles.dpadZoneVertical}\n              initialDelayMs={260}\n              repeatIntervalMs={150}\n              activeOpacity={0.55}\n              accessibilityLabel=\"أعلى\"\n              onAction={() => onTvCommand('UP')}\n            >\n              <RemoteIcon name=\"chevron_up\" color={colors.textSecondary} size={20} />\n            </RepeatableButton>\n\n            <View style={styles.dpadMiddleRow}>\n              <RepeatableButton\n                style={styles.dpadZoneHorizontal}\n                initialDelayMs={260}\n                repeatIntervalMs={150}\n                activeOpacity={0.55}\n                accessibilityLabel=\"يمين\"\n                onAction={() => onTvCommand('RIGHT')}\n              >\n                <RemoteIcon name=\"chevron_right\" color={colors.textSecondary} size={20} />\n              </RepeatableButton>\n\n              <TouchableOpacity\n                style={styles.okCircle}\n                activeOpacity={0.55}\n                accessibilityLabel=\"موافق\"\n                accessibilityRole=\"button\"\n                onPress={() => onTvCommand('OK')}\n              >\n                <Text style={styles.okText}>OK</Text>\n              </TouchableOpacity>\n\n              <RepeatableButton\n                style={styles.dpadZoneHorizontal}\n                initialDelayMs={260}\n                repeatIntervalMs={150}\n                activeOpacity={0.55}\n                accessibilityLabel=\"يسار\"\n                onAction={() => onTvCommand('LEFT')}\n              >\n                <RemoteIcon name=\"chevron_left\" color={colors.textSecondary} size={20} />\n              </RepeatableButton>\n            </View>\n\n            <RepeatableButton\n              style={styles.dpadZoneVertical}\n              initialDelayMs={260}\n              repeatIntervalMs={150}\n              activeOpacity={0.55}\n              accessibilityLabel=\"أسفل\"\n              onAction={() => onTvCommand('DOWN')}\n            >\n              <RemoteIcon name=\"chevron_down\" color={colors.textSecondary} size={20} />\n            </RepeatableButton>\n          </View>\n        </View>\n\n        {/* كبسولة القناة (يسار في RTL) */}\n        <View style={styles.rockerColumn}>\n          <Text style={styles.rockerLabel}>قناة</Text>\n          <View style={styles.verticalCapsule}>\n            <RepeatableButton\n              style={styles.capsuleHalfBtn}\n              initialDelayMs={260}\n              repeatIntervalMs={150}\n              activeOpacity={0.55}\n              accessibilityLabel=\"قناة أعلى\"\n              onAction={() => onTvCommand('CH_UP')}\n            >\n              <RemoteIcon name=\"chevron_up\" color={colors.textPrimary} size={18} />\n            </RepeatableButton>\n\n            <View style={styles.capsuleCenterIcon} pointerEvents=\"none\">\n              <RemoteIcon name=\"channel\" color={colors.textTertiary} size={20} />\n            </View>\n\n            <RepeatableButton\n              style={styles.capsuleHalfBtn}\n              initialDelayMs={260}\n              repeatIntervalMs={150}\n              activeOpacity={0.55}\n              accessibilityLabel=\"قناة أسفل\"\n              onAction={() => onTvCommand('CH_DOWN')}\n            >\n              <RemoteIcon name=\"chevron_down\" color={colors.textPrimary} size={18} />\n            </RepeatableButton>\n          </View>\n        </View>\n      </View>\n\n      {/* [هـ] شريط سفلي واحد — 4 أزرار دائرية 52×52 */}\n      <View style={styles.bottomActionsRow}>\n        <TouchableOpacity\n          style={styles.circleActionBtn}\n          activeOpacity={0.55}\n          accessibilityLabel=\"رجوع\"\n          accessibilityRole=\"button\"\n          onPress={() => onTvCommand('BACK')}\n        >\n          <RemoteIcon name=\"back\" color={colors.textPrimary} size={20} />\n        </TouchableOpacity>\n\n        <TouchableOpacity\n          style={styles.circleActionBtn}\n          activeOpacity={0.55}\n          accessibilityLabel=\"الرئيسية\"\n          accessibilityRole=\"button\"\n          onPress={() => onTvCommand('HOME')}\n        >\n          <RemoteIcon name=\"home\" color={colors.textPrimary} size={20} />\n        </TouchableOpacity>\n\n        <TouchableOpacity\n          style={styles.circleActionBtn}\n          activeOpacity={0.55}\n          accessibilityLabel=\"القائمة\"\n          accessibilityRole=\"button\"\n          onPress={() => onTvCommand('MENU')}\n        >\n          <RemoteIcon name=\"menu\" color={colors.textPrimary} size={20} />\n        </TouchableOpacity>\n\n        <TouchableOpacity\n          style={styles.circleActionBtn}\n          activeOpacity={0.55}\n          accessibilityLabel=\"المصدر\"\n          accessibilityRole=\"button\"\n          onPress={() => onTvCommand('INPUT')}\n        >\n          <RemoteIcon name=\"input\" color={colors.textPrimary} size={20} />\n        </TouchableOpacity>\n      </View>\n    </>\n  );\n\n  if (tvTransport === 'ir') {\n    return <View style={styles.irRoot}>{renderRemoteControls()}</View>;\n  }\n\n  return (\n    <ScrollView\n      style={styles.wifiScroll}\n      contentContainerStyle={styles.wifiScrollContent}\n      keyboardShouldPersistTaps=\"handled\"\n      showsVerticalScrollIndicator={false}\n    >\n      <View style={styles.wifiRemoteSection}>{renderRemoteControls()}</View>\n\n      {/* أدوات الواي فاي السريعة (كتم، نتفلكس، بحث عن الشاشات) */}\n      <View style={styles.wifiPanel}>\n        <View style={styles.wifiQuickRow}>\n          <TouchableOpacity\n            style={styles.quickRectBtn}\n            activeOpacity={0.55}\n            accessibilityLabel=\"كتم الصوت\"\n            accessibilityRole=\"button\"\n            onPress={() => onTvCommand('MUTE')}\n          >\n            <RemoteIcon name=\"mute\" color={colors.textPrimary} size={18} />\n            <Text style={styles.quickRectText}>كتم</Text>\n          </TouchableOpacity>\n\n          <TouchableOpacity\n            style={styles.quickRectBtn}\n            activeOpacity={0.55}\n            accessibilityLabel=\"Netflix\"\n            accessibilityRole=\"button\"\n            onPress={() => onTvCommand('NETFLIX')}\n          >\n            <Text style={styles.quickRectText}>Netflix</Text>\n          </TouchableOpacity>\n\n          <TouchableOpacity\n            style={[styles.quickRectBtn, isDiscovering && styles.quickRectBtnActive]}\n            activeOpacity={0.55}\n            accessibilityLabel=\"البحث عن الشاشات\"\n            accessibilityRole=\"button\"\n            onPress={() => onScanSmartTvs()}\n          >\n            {isDiscovering ? (\n              <ActivityIndicator size=\"small\" color={colors.textPrimary} />\n            ) : (\n              <Text style={styles.quickRectText}>بحث الشاشات</Text>\n            )}\n          </TouchableOpacity>\n        </View>\n\n        {hasScannedOnce && discoveredTvs.length > 0 ? (\n          <View style={styles.discoveredList}>\n            {discoveredTvs.map((device) => {\n              const selected = device.ip === tvIp;\n              return (\n                <TouchableOpacity\n                  key={`${device.ip}-${device.protocol}`}\n                  style={[styles.discoveredRow, selected && styles.discoveredRowActive]}\n                  activeOpacity={0.55}\n                  onPress={() => onSelectDiscoveredTv(device)}\n                >\n                  <View style={styles.discoveredMeta}>\n                    <Text style={styles.discoveredTitle} numberOfLines={1}>\n                      {device.name}\n                    </Text>\n                    <Text style={styles.discoveredSub}>\n                      {device.ip}:{device.port}\n                    </Text>\n                  </View>\n                  <Text style={styles.discoveredTag}>\n                    {selected && wifiStatus.isConnected ? 'متصل' : 'اتصال'}\n                  </Text>\n                </TouchableOpacity>\n              );\n            })}\n          </View>\n        ) : null}\n      </View>\n\n      {/* لوحة البحث والبث على الشاشة (YouTube Cast) */}\n      <View style={styles.wifiPanel}>\n        <View style={styles.castHeaderRow}>\n          <Text style={styles.panelTitle}>البث والبحث (YouTube Cast)</Text>\n          <TouchableOpacity\n            style={styles.ytLaunchBtn}\n            activeOpacity={0.55}\n            onPress={onLaunchYouTube}\n            disabled={isLaunchingYouTube}\n          >\n            {isLaunchingYouTube ? (\n              <ActivityIndicator size=\"small\" color={colors.textPrimary} />\n            ) : (\n              <Text style={styles.ytLaunchText}>فتح يوتيوب</Text>\n            )}\n          </TouchableOpacity>\n        </View>\n\n        <View style={styles.searchRow}>\n          <TextInput\n            style={styles.searchInput}\n            value={searchQuery}\n            onChangeText={setSearchQuery}\n            placeholder=\"ابحث عن فيديو للبث...\"\n            placeholderTextColor={colors.textTertiary}\n            onSubmitEditing={onSearchYouTube}\n          />\n          <TouchableOpacity\n            style={styles.searchSubmitBtn}\n            activeOpacity={0.55}\n            onPress={onSearchYouTube}\n            disabled={isSearching}\n          >\n            {isSearching ? (\n              <ActivityIndicator size=\"small\" color={colors.textPrimary} />\n            ) : (\n              <Text style={styles.searchSubmitText}>بحث</Text>\n            )}\n          </TouchableOpacity>\n        </View>\n\n        {hasSearchedOnce && searchResults.length === 0 && !isSearching ? (\n          <Text style={styles.emptyText}>لا توجد نتائج مطابقة للبحث.</Text>\n        ) : null}\n\n        {searchResults.length > 0 ? (\n          <View style={styles.resultsList}>\n            {searchResults.map((item) => {\n              const isCasting = castingVideoId === item.videoId;\n              return (\n                <TouchableOpacity\n                  key={item.videoId}\n                  style={[styles.videoRow, isCasting && styles.videoRowActive]}\n                  activeOpacity={0.55}\n                  disabled={Boolean(castingVideoId)}\n                  onPress={() => onCastVideo(item)}\n                >\n                  <Image\n                    source={{ uri: item.thumbnailUrl }}\n                    style={styles.videoThumb}\n                    resizeMode=\"cover\"\n                  />\n                  <View style={styles.videoInfo}>\n                    <Text style={styles.videoTitle} numberOfLines={2}>\n                      {item.title}\n                    </Text>\n                    <Text style={styles.videoMeta} numberOfLines={1}>\n                      {item.channelTitle}\n                      {item.durationText ? ` · ${item.durationText}` : ''}\n                    </Text>\n                  </View>\n                  <Text style={styles.videoAction}>\n                    {isCasting ? 'جاري البث' : 'بث'}\n                  </Text>\n                </TouchableOpacity>\n              );\n            })}\n          </View>\n        ) : null}\n      </View>\n    </ScrollView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  irRoot: {\n    flex: 1,\n    width: '100%',\n    paddingHorizontal: spacing.md,\n    paddingTop: spacing.xs,\n    paddingBottom: spacing.md,\n    justifyContent: 'space-between',\n    alignItems: 'center',\n  },\n  wifiScroll: {\n    flex: 1,\n    width: '100%',\n  },\n  wifiScrollContent: {\n    paddingHorizontal: spacing.md,\n    paddingTop: spacing.xs,\n    paddingBottom: spacing.xl,\n    gap: spacing.lg,\n  },\n  wifiRemoteSection: {\n    width: '100%',\n    gap: spacing.lg,\n    alignItems: 'center',\n  },\n\n  // [ب] شريط الوضع (IR / Wi-Fi)\n  modeCapsule: {\n    width: '100%',\n    height: 38,\n    flexDirection: 'row',\n    backgroundColor: colors.surface,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.capsule,\n    padding: 3,\n    gap: spacing.xs,\n  },\n  modeBtn: {\n    flex: 1,\n    borderRadius: radii.capsule,\n    borderWidth: 1,\n    borderColor: colors.transparent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  modeBtnActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  modeText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n  modeTextActive: {\n    color: colors.textPrimary,\n    fontWeight: '600',\n  },\n\n  // [ج] صف الماركة / الجهاز (ارتفاع 36)\n  brandRow: {\n    width: '100%',\n    height: 36,\n    flexDirection: 'row',\n    gap: spacing.sm,\n  },\n  brandCapsule: {\n    flex: 1,\n    height: 36,\n    borderRadius: radii.capsule,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  brandCapsuleActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  brandText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  brandTextActive: {\n    color: colors.textPrimary,\n  },\n  wifiDeviceCapsule: {\n    width: '100%',\n    height: 36,\n    borderRadius: radii.capsule,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    flexDirection: 'row',\n    alignItems: 'center',\n    paddingHorizontal: spacing.md,\n    gap: spacing.sm,\n  },\n  wifiDot: {\n    width: 6,\n    height: 6,\n    borderRadius: radii.capsule,\n  },\n  wifiDotActive: {\n    backgroundColor: colors.accent,\n  },\n  wifiDotIdle: {\n    backgroundColor: colors.textTertiary,\n  },\n  wifiDeviceText: {\n    flex: 1,\n    color: colors.textPrimary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'right',\n  },\n  wifiSettingsLink: {\n    color: colors.accent,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n\n  // [د] الكتلة المركزية: صوت 60×186 | D-Pad 200×200 | قناة 60×186\n  centerClusterRow: {\n    width: '100%',\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'center',\n    gap: spacing.md,\n  },\n  rockerColumn: {\n    alignItems: 'center',\n    gap: spacing.xs,\n  },\n  dpadColumn: {\n    alignItems: 'center',\n    gap: spacing.xs,\n  },\n  rockerLabel: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.micro,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n  rockerSpacer: {\n    fontSize: fontSizes.micro,\n  },\n  verticalCapsule: {\n    width: 60,\n    height: 186,\n    borderRadius: 30,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    alignItems: 'center',\n    justifyContent: 'space-between',\n    overflow: 'hidden',\n  },\n  capsuleHalfBtn: {\n    flex: 1,\n    width: '100%',\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  capsuleCenterIcon: {\n    height: 24,\n    width: '100%',\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n\n  dpadCircle: {\n    width: 200,\n    height: 200,\n    borderRadius: 100,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n    overflow: 'hidden',\n  },\n  dpadZoneVertical: {\n    width: 88,\n    height: 62,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  dpadMiddleRow: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'center',\n  },\n  dpadZoneHorizontal: {\n    width: 62,\n    height: 88,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  okCircle: {\n    width: 72,\n    height: 72,\n    borderRadius: 36,\n    backgroundColor: colors.background,\n    borderWidth: 1.5,\n    borderColor: colors.accent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  okText: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '800',\n  },\n\n  // [هـ] الشريط السفلي: 4 أزرار دائرية 52×52\n  bottomActionsRow: {\n    width: '100%',\n    flexDirection: 'row',\n    justifyContent: 'center',\n    alignItems: 'center',\n    gap: spacing.xl,\n  },\n  circleActionBtn: {\n    width: 52,\n    height: 52,\n    borderRadius: 26,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n\n  // لوحات Wi-Fi والبحث والبث\n  wifiPanel: {\n    width: '100%',\n    backgroundColor: colors.surface,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.panel,\n    padding: spacing.md,\n    gap: spacing.md,\n  },\n  wifiQuickRow: {\n    flexDirection: 'row',\n    gap: spacing.sm,\n  },\n  quickRectBtn: {\n    flex: 1,\n    height: 44,\n    borderRadius: radii.button,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    flexDirection: 'row',\n    justifyContent: 'center',\n    alignItems: 'center',\n    gap: spacing.xs,\n  },\n  quickRectBtnActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  quickRectText: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  discoveredList: {\n    gap: spacing.sm,\n  },\n  discoveredRow: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'space-between',\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    paddingHorizontal: spacing.md,\n    paddingVertical: spacing.sm,\n  },\n  discoveredRowActive: {\n    backgroundColor: colors.accentSoft,\n    borderColor: colors.accent,\n  },\n  discoveredMeta: {\n    flex: 1,\n    gap: 2,\n  },\n  discoveredTitle: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n    textAlign: 'right',\n  },\n  discoveredSub: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'right',\n  },\n  discoveredTag: {\n    color: colors.accent,\n    fontSize: fontSizes.label,\n    fontWeight: '600',\n  },\n  castHeaderRow: {\n    flexDirection: 'row',\n    justifyContent: 'space-between',\n    alignItems: 'center',\n    gap: spacing.sm,\n  },\n  panelTitle: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  ytLaunchBtn: {\n    height: 34,\n    paddingHorizontal: spacing.md,\n    borderRadius: radii.button,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.accent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  ytLaunchText: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.label,\n    fontWeight: '600',\n  },\n  searchRow: {\n    flexDirection: 'row',\n    gap: spacing.sm,\n  },\n  searchInput: {\n    flex: 1,\n    height: 44,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    paddingHorizontal: spacing.md,\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    textAlign: 'right',\n  },\n  searchSubmitBtn: {\n    height: 44,\n    paddingHorizontal: spacing.lg,\n    borderRadius: radii.button,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.accent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  searchSubmitText: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  emptyText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'center',\n  },\n  resultsList: {\n    gap: spacing.sm,\n  },\n  videoRow: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: spacing.sm,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    padding: spacing.sm,\n  },\n  videoRowActive: {\n    backgroundColor: colors.accentSoft,\n    borderColor: colors.accent,\n  },\n  videoThumb: {\n    width: 72,\n    height: 44,\n    borderRadius: 8,\n    backgroundColor: colors.surface,\n  },\n  videoInfo: {\n    flex: 1,\n    gap: 2,\n  },\n  videoTitle: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.label,\n    fontWeight: '600',\n    textAlign: 'right',\n  },\n  videoMeta: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.micro,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'right',\n  },\n  videoAction: {\n    color: colors.accent,\n    fontSize: fontSizes.label,\n    fontWeight: '600',\n  },\n});\n\nexport default TvRemote;\n",
  },
  {
    id: "ac-remote-screen-js",
    path: "src/components/AcRemote.js",
    titleAr: "مكوّن ريموت التكييف (AcRemote.js)",
    category: "ui",
    language: "javascript",
    summaryAr:
      "واجهة التحكم بمكيفات Gree و Carrier مع شاشة LCD الرقمية وضبط الحرارة وأوضاع التشغيل وسرعة المروحة.",
    content: "import React from 'react';\nimport { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';\nimport { AC_MODES, FAN_SPEEDS } from '../ir/encoders';\nimport { colors, fontSizes, radii, spacing } from '../theme';\nimport RemoteIcon from './RemoteIcon';\n\nfunction AcRemote({ acBrand, setAcBrand, acState, updateAcAndTransmit }) {\n  const currentModeObj = AC_MODES.find((m) => m.key === acState.mode);\n  const currentModeLabel = currentModeObj ? currentModeObj.label : 'تبريد';\n\n  const currentFanObj = FAN_SPEEDS.find((f) => f.key === acState.fanSpeed);\n  const currentFanLabel = currentFanObj ? currentFanObj.label : 'تلقائي';\n\n  return (\n    <ScrollView\n      style={styles.scrollArea}\n      contentContainerStyle={styles.scrollContent}\n      showsVerticalScrollIndicator={false}\n    >\n      <View style={styles.sectionStack}>\n        <View style={styles.rowGap}>\n          {[\n            { key: 'gree', label: 'Gree AC' },\n            { key: 'carrier', label: 'Carrier AC' },\n          ].map((b) => {\n            const active = acBrand === b.key;\n            return (\n              <TouchableOpacity\n                key={b.key}\n                style={[styles.brandChip, active && styles.brandChipActive]}\n                activeOpacity={0.55}\n                accessibilityLabel={b.label}\n                accessibilityRole=\"button\"\n                onPress={() => setAcBrand(b.key)}\n              >\n                <Text style={[styles.brandText, active && styles.brandTextActive]}>\n                  {b.label}\n                </Text>\n              </TouchableOpacity>\n            );\n          })}\n        </View>\n\n        <View style={[styles.acLcd, !acState.power && styles.acLcdOff]}>\n          <View style={styles.acLcdTop}>\n            <Text style={styles.acMeta}>الوضع: {currentModeLabel}</Text>\n            <Text style={styles.acMeta}>المروحة: {currentFanLabel}</Text>\n          </View>\n          <Text style={styles.acTemp}>\n            {acState.power ? `${acState.temperature}°C` : 'OFF'}\n          </Text>\n          <Text style={styles.acFooter}>\n            توجيه الهواء: {acState.swing ? 'متحرك' : 'ثابت'} · IR 38kHz\n          </Text>\n        </View>\n\n        {/* صف التحكم بالحرارة والطاقة: [−] [زر طاقة دائري 64px] [+] */}\n        <View style={styles.powerRow}>\n          <TouchableOpacity\n            style={styles.tempStepBtn}\n            activeOpacity={0.55}\n            accessibilityLabel=\"خفض الحرارة\"\n            accessibilityRole=\"button\"\n            onPress={() => {\n              const nextTemp = Math.max(16, acState.temperature - 1);\n              if (nextTemp !== acState.temperature) {\n                updateAcAndTransmit({\n                  ...acState,\n                  power: true,\n                  temperature: nextTemp,\n                });\n              }\n            }}\n          >\n            <RemoteIcon name=\"minus\" color={colors.textPrimary} size={22} />\n          </TouchableOpacity>\n\n          <TouchableOpacity\n            style={styles.acPowerCircleBtn}\n            activeOpacity={0.55}\n            accessibilityLabel=\"الطاقة\"\n            accessibilityRole=\"button\"\n            onPress={() => {\n              const nextPower = !acState.power;\n              updateAcAndTransmit({ ...acState, power: nextPower });\n            }}\n          >\n            <RemoteIcon name=\"power\" color={colors.textPrimary} size={24} />\n          </TouchableOpacity>\n\n          <TouchableOpacity\n            style={styles.tempStepBtn}\n            activeOpacity={0.55}\n            accessibilityLabel=\"رفع الحرارة\"\n            accessibilityRole=\"button\"\n            onPress={() => {\n              const nextTemp = Math.min(30, acState.temperature + 1);\n              if (nextTemp !== acState.temperature) {\n                updateAcAndTransmit({\n                  ...acState,\n                  power: true,\n                  temperature: nextTemp,\n                });\n              }\n            }}\n          >\n            <RemoteIcon name=\"plus\" color={colors.textPrimary} size={22} />\n          </TouchableOpacity>\n        </View>\n\n        {/* شريط الأوضاع الأفقي الموحّد (Segment) */}\n        <View style={styles.modeSection}>\n          <Text style={styles.sectionCaption}>وضع التشغيل</Text>\n          <View style={styles.modeSegmentBar}>\n            {AC_MODES.map((m) => {\n              const active = acState.mode === m.key;\n              return (\n                <TouchableOpacity\n                  key={m.key}\n                  style={[styles.modeSegmentItem, active && styles.modeSegmentItemActive]}\n                  activeOpacity={0.55}\n                  accessibilityLabel={m.label}\n                  accessibilityRole=\"button\"\n                  onPress={() =>\n                    updateAcAndTransmit({ ...acState, power: true, mode: m.key })\n                  }\n                >\n                  <Text\n                    style={[styles.modeSegmentText, active && styles.modeSegmentTextActive]}\n                    numberOfLines={1}\n                  >\n                    {m.label}\n                  </Text>\n                </TouchableOpacity>\n              );\n            })}\n          </View>\n        </View>\n\n        <View style={styles.rowGap}>\n          <TouchableOpacity\n            style={styles.extraCard}\n            activeOpacity={0.55}\n            accessibilityLabel=\"سرعة المروحة\"\n            accessibilityRole=\"button\"\n            onPress={() => {\n              const idx = FAN_SPEEDS.findIndex((f) => f.key === acState.fanSpeed);\n              const nextFan = FAN_SPEEDS[(idx + 1) % FAN_SPEEDS.length];\n              updateAcAndTransmit({\n                ...acState,\n                power: true,\n                fanSpeed: nextFan.key,\n              });\n            }}\n          >\n            <Text style={styles.extraCaption}>سرعة المروحة</Text>\n            <Text style={styles.extraValue}>{currentFanLabel}</Text>\n          </TouchableOpacity>\n\n          <TouchableOpacity\n            style={styles.extraCard}\n            activeOpacity={0.55}\n            accessibilityLabel=\"تأرجح الريش\"\n            accessibilityRole=\"button\"\n            onPress={() => {\n              const nextSwing = !acState.swing;\n              updateAcAndTransmit({ ...acState, power: true, swing: nextSwing });\n            }}\n          >\n            <Text style={styles.extraCaption}>تأرجح الريش</Text>\n            <Text style={styles.extraValue}>\n              {acState.swing ? 'يعمل' : 'متوقف'}\n            </Text>\n          </TouchableOpacity>\n        </View>\n      </View>\n    </ScrollView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  scrollArea: { flex: 1, width: '100%' },\n  scrollContent: {\n    paddingHorizontal: spacing.lg,\n    paddingTop: spacing.sm,\n    paddingBottom: spacing.xl,\n    flexGrow: 1,\n  },\n  sectionStack: { width: '100%', gap: spacing.lg },\n  rowGap: { flexDirection: 'row', gap: spacing.sm },\n  brandChip: {\n    flex: 1,\n    height: 38,\n    borderRadius: radii.capsule,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  brandChipActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  brandText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  brandTextActive: {\n    color: colors.textPrimary,\n  },\n\n  acLcd: {\n    backgroundColor: colors.surface,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.panel,\n    padding: spacing.lg,\n    alignItems: 'center',\n    gap: spacing.sm,\n  },\n  acLcdOff: { opacity: 0.45 },\n  acLcdTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between' },\n  acMeta: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n  acTemp: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.temp,\n    fontWeight: '300',\n    fontVariant: ['tabular-nums'],\n  },\n  acFooter: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n\n  powerRow: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'center',\n    gap: spacing.lg,\n  },\n  tempStepBtn: {\n    width: 64,\n    height: 64,\n    borderRadius: radii.capsule,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  acPowerCircleBtn: {\n    width: 64,\n    height: 64,\n    borderRadius: 32,\n    backgroundColor: colors.danger,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n\n  modeSection: { gap: spacing.xs },\n  sectionCaption: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'right',\n  },\n  modeSegmentBar: {\n    flexDirection: 'row',\n    backgroundColor: colors.surface,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    padding: 3,\n    gap: 3,\n  },\n  modeSegmentItem: {\n    flex: 1,\n    height: 40,\n    borderRadius: 11,\n    borderWidth: 1,\n    borderColor: colors.transparent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  modeSegmentItemActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  modeSegmentText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n  modeSegmentTextActive: {\n    color: colors.textPrimary,\n    fontWeight: '600',\n  },\n\n  extraCard: {\n    flex: 1,\n    height: 62,\n    borderRadius: radii.button,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    padding: spacing.sm,\n    alignItems: 'center',\n    justifyContent: 'center',\n    gap: spacing.xs,\n  },\n  extraCaption: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n  extraValue: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n});\n\nexport default AcRemote;\n",
  },
  {
    id: "remote-icon-js",
    path: "src/components/RemoteIcon.js",
    titleAr: "مكوّن الأيقونات الهندسية (RemoteIcon.js)",
    category: "ui",
    language: "javascript",
    summaryAr:
      "أيقونات هندسية مبنية بـ View بدون الاعتماد على مكتبات أيقونات خارجية.",
    content: "import React from 'react';\nimport { StyleSheet, View } from 'react-native';\nimport { colors } from '../theme';\n\nfunction RemoteIcon({ name, color = colors.textPrimary, size = 20 }) {\n  if (name === 'power') {\n    const ringSize = Math.round(size * 0.84);\n    const stemH = Math.round(size * 0.42);\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View\n          style={{\n            width: ringSize,\n            height: ringSize,\n            borderRadius: ringSize / 2,\n            borderWidth: 2,\n            borderColor: color,\n            borderTopColor: colors.transparent,\n            position: 'absolute',\n            bottom: 1,\n          }}\n        />\n        <View\n          style={{\n            width: 2,\n            height: stemH,\n            borderRadius: 1,\n            backgroundColor: color,\n            position: 'absolute',\n            top: 1,\n          }}\n        />\n      </View>\n    );\n  }\n\n  if (name === 'mute') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View style={iconStyles.row}>\n          <View\n            style={{\n              width: 5,\n              height: 8,\n              backgroundColor: color,\n              borderTopLeftRadius: 1.5,\n              borderBottomLeftRadius: 1.5,\n            }}\n          />\n          <View\n            style={{\n              width: 0,\n              height: 0,\n              borderTopWidth: 7,\n              borderBottomWidth: 7,\n              borderRightWidth: 6,\n              borderTopColor: colors.transparent,\n              borderBottomColor: colors.transparent,\n              borderRightColor: color,\n              marginLeft: -1,\n            }}\n          />\n        </View>\n        <View\n          style={{\n            position: 'absolute',\n            width: size * 0.88,\n            height: 2,\n            borderRadius: 1,\n            backgroundColor: color,\n            transform: [{ rotate: '-42deg' }],\n          }}\n        />\n      </View>\n    );\n  }\n\n  if (name === 'volume') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View style={iconStyles.row}>\n          <View\n            style={{\n              width: 4,\n              height: 7,\n              backgroundColor: color,\n              borderTopLeftRadius: 1.5,\n              borderBottomLeftRadius: 1.5,\n            }}\n          />\n          <View\n            style={{\n              width: 0,\n              height: 0,\n              borderTopWidth: 6,\n              borderBottomWidth: 6,\n              borderRightWidth: 5,\n              borderTopColor: colors.transparent,\n              borderBottomColor: colors.transparent,\n              borderRightColor: color,\n              marginLeft: -1,\n            }}\n          />\n          <View\n            style={{\n              width: 4,\n              height: 9,\n              borderRightWidth: 1.8,\n              borderTopRightRadius: 5,\n              borderBottomRightRadius: 5,\n              borderColor: color,\n              marginLeft: 2,\n            }}\n          />\n        </View>\n      </View>\n    );\n  }\n\n  if (name === 'channel') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View\n          style={{\n            width: size * 0.84,\n            height: size * 0.58,\n            borderRadius: 3.5,\n            borderWidth: 1.8,\n            borderColor: color,\n            justifyContent: 'center',\n            alignItems: 'center',\n          }}\n        >\n          <View\n            style={{\n              width: 4,\n              height: 4,\n              borderRadius: 2,\n              backgroundColor: color,\n            }}\n          />\n        </View>\n        <View\n          style={{\n            width: size * 0.36,\n            height: 1.8,\n            backgroundColor: color,\n            borderRadius: 1,\n            marginTop: 2,\n          }}\n        />\n      </View>\n    );\n  }\n\n  if (name === 'input') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View\n          style={{\n            width: size * 0.84,\n            height: size * 0.62,\n            borderRadius: 3.5,\n            borderWidth: 2,\n            borderColor: color,\n            justifyContent: 'center',\n            alignItems: 'center',\n          }}\n        >\n          <View\n            style={{\n              width: 6,\n              height: 6,\n              borderTopWidth: 2,\n              borderRightWidth: 2,\n              borderColor: color,\n              transform: [{ rotate: '45deg' }],\n              marginLeft: -2,\n            }}\n          />\n        </View>\n      </View>\n    );\n  }\n\n  if (name === 'home') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View\n          style={{\n            width: 10,\n            height: 10,\n            borderTopWidth: 2,\n            borderLeftWidth: 2,\n            borderColor: color,\n            transform: [{ rotate: '45deg' }],\n            marginBottom: -4,\n          }}\n        />\n        <View\n          style={{\n            width: 12,\n            height: 9,\n            borderLeftWidth: 2,\n            borderRightWidth: 2,\n            borderBottomWidth: 2,\n            borderBottomLeftRadius: 2,\n            borderBottomRightRadius: 2,\n            borderColor: color,\n            alignItems: 'center',\n            justifyContent: 'flex-end',\n          }}\n        >\n          <View\n            style={{\n              width: 4,\n              height: 4,\n              backgroundColor: color,\n              borderTopLeftRadius: 1,\n              borderTopRightRadius: 1,\n            }}\n          />\n        </View>\n      </View>\n    );\n  }\n\n  if (name === 'back') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View style={iconStyles.row}>\n          <View\n            style={{\n              width: 7,\n              height: 7,\n              borderBottomWidth: 2,\n              borderLeftWidth: 2,\n              borderColor: color,\n              transform: [{ rotate: '45deg' }],\n              marginRight: -4,\n            }}\n          />\n          <View\n            style={{\n              width: 11,\n              height: 2,\n              backgroundColor: color,\n              borderRadius: 1,\n            }}\n          />\n        </View>\n      </View>\n    );\n  }\n\n  if (name === 'menu') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size, gap: 4 }]}>\n        <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />\n        <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />\n        <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: color }} />\n      </View>\n    );\n  }\n\n  if (name === 'plus') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View style={{ width: 13, height: 2, borderRadius: 1, backgroundColor: color }} />\n        <View\n          style={{\n            position: 'absolute',\n            width: 2,\n            height: 13,\n            borderRadius: 1,\n            backgroundColor: color,\n          }}\n        />\n      </View>\n    );\n  }\n\n  if (name === 'minus') {\n    return (\n      <View style={[iconStyles.box, { width: size, height: size }]}>\n        <View style={{ width: 13, height: 2, borderRadius: 1, backgroundColor: color }} />\n      </View>\n    );\n  }\n\n  const rotationMap = {\n    chevron_up: '-45deg',\n    chevron_right: '45deg',\n    chevron_down: '135deg',\n    chevron_left: '-135deg',\n  };\n  const rotation = rotationMap[name] || '0deg';\n  const armSize = Math.round(size * 0.44);\n\n  return (\n    <View style={[iconStyles.box, { width: size, height: size }]}>\n      <View\n        style={{\n          width: armSize,\n          height: armSize,\n          borderTopWidth: 2,\n          borderRightWidth: 2,\n          borderColor: color,\n          borderTopRightRadius: 1,\n          transform: [{ rotate: rotation }],\n        }}\n      />\n    </View>\n  );\n}\n\nconst iconStyles = StyleSheet.create({\n  box: {\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  row: {\n    flexDirection: 'row',\n    alignItems: 'center',\n  },\n});\n\nexport default RemoteIcon;\n",
  },
  {
    id: "repeatable-button-js",
    path: "src/components/RepeatableButton.js",
    titleAr: "زر التكرار بالضغط المطوّل (RepeatableButton.js)",
    category: "ui",
    language: "javascript",
    summaryAr:
      "زر يدعم الإرسال المتكرر عند الضغط المطوّل لاتجاهات D-Pad والصوت والقنوات.",
    content: "import React, { useEffect, useRef } from 'react';\nimport { TouchableOpacity } from 'react-native';\n\nfunction RepeatableButton({\n  onAction,\n  repeatIntervalMs = 150,\n  initialDelayMs = 260,\n  style,\n  activeOpacity = 0.55,\n  hitSlop,\n  accessibilityLabel,\n  accessibilityRole = 'button',\n  children,\n}) {\n  const holdTimerRef = useRef(null);\n  const repeatTimerRef = useRef(null);\n  const latestActionRef = useRef(onAction);\n\n  latestActionRef.current = onAction;\n\n  const clearTimers = () => {\n    if (holdTimerRef.current) {\n      clearTimeout(holdTimerRef.current);\n      holdTimerRef.current = null;\n    }\n    if (repeatTimerRef.current) {\n      clearInterval(repeatTimerRef.current);\n      repeatTimerRef.current = null;\n    }\n  };\n\n  useEffect(() => {\n    return () => clearTimers();\n  }, []);\n\n  const handlePressIn = () => {\n    clearTimers();\n    if (latestActionRef.current) {\n      latestActionRef.current();\n    }\n    holdTimerRef.current = setTimeout(() => {\n      repeatTimerRef.current = setInterval(() => {\n        if (latestActionRef.current) {\n          latestActionRef.current();\n        }\n      }, repeatIntervalMs);\n    }, initialDelayMs);\n  };\n\n  return (\n    <TouchableOpacity\n      style={style}\n      activeOpacity={activeOpacity}\n      hitSlop={hitSlop}\n      accessibilityLabel={accessibilityLabel}\n      accessibilityRole={accessibilityRole}\n      onPressIn={handlePressIn}\n      onPressOut={clearTimers}\n    >\n      {children}\n    </TouchableOpacity>\n  );\n}\n\nexport default RepeatableButton;\n",
  },
  {
    id: "wifi-sheet-js",
    path: "src/components/WifiSheet.js",
    titleAr: "نافذة إعداد الشاشة الذكية والاقتران (WifiSheet.js)",
    category: "ui",
    language: "javascript",
    summaryAr:
      "نافذة إعدادات الشاشة والاتصال: تبديل وضع IR/Wi-Fi، اختيار الماركة (Samsung / LG)، استكشاف شاشات Samsung Tizen / Android TV / Roku، وحفظ Token.",
    content: "import React from 'react';\nimport {\n  ActivityIndicator,\n  Modal,\n  ScrollView,\n  StyleSheet,\n  Text,\n  TextInput,\n  TouchableOpacity,\n  View,\n} from 'react-native';\nimport { TV_IR_BRANDS } from '../ir/encoders';\nimport { colors, fontSizes, radii, spacing } from '../theme';\n\nfunction WifiSheet({\n  visible,\n  onClose,\n  tvTransport,\n  setTvTransport,\n  tvBrand,\n  setTvBrand,\n  wifiProtocol,\n  setWifiProtocol,\n  tvPort,\n  setTvPort,\n  dialPort,\n  setDialPort,\n  subnetPrefix,\n  setSubnetPrefix,\n  isDiscovering,\n  scanProgress,\n  hasScannedOnce,\n  isConnectingWifi,\n  discoveredTvs,\n  tvIp,\n  setTvIp,\n  wifiStatus,\n  getSubnetFromIp,\n  onScanSmartTvs,\n  onSelectDiscoveredTv,\n  onClearSavedToken,\n  onSaveWifi,\n}) {\n  return (\n    <Modal visible={visible} transparent animationType=\"fade\">\n      <View style={styles.modalBackdrop}>\n        <View style={styles.modalCard}>\n          <ScrollView\n            style={styles.modalScroll}\n            contentContainerStyle={styles.modalScrollContent}\n            showsVerticalScrollIndicator={false}\n            keyboardShouldPersistTaps=\"handled\"\n          >\n            <Text style={styles.modalTitle}>إعدادات الشاشة والاتصال</Text>\n\n            <View style={styles.segmentBox}>\n              <TouchableOpacity\n                style={[styles.segmentBtn, tvTransport === 'ir' && styles.segmentActive]}\n                activeOpacity={0.55}\n                onPress={() => setTvTransport('ir')}\n              >\n                <Text\n                  style={[\n                    styles.segmentText,\n                    tvTransport === 'ir' && styles.segmentTextActive,\n                  ]}\n                >\n                  أشعة IR\n                </Text>\n              </TouchableOpacity>\n              <TouchableOpacity\n                style={[styles.segmentBtn, tvTransport === 'wifi' && styles.segmentActive]}\n                activeOpacity={0.55}\n                onPress={() => setTvTransport('wifi')}\n              >\n                <Text\n                  style={[\n                    styles.segmentText,\n                    tvTransport === 'wifi' && styles.segmentTextActive,\n                  ]}\n                >\n                  واي فاي (Wi-Fi)\n                </Text>\n              </TouchableOpacity>\n            </View>\n\n            {tvTransport === 'ir' ? (\n              <View style={styles.sectionBlock}>\n                <Text style={styles.inputLabel}>اختر ماركة الشاشة (IR 38kHz)</Text>\n                <View style={styles.rowGap}>\n                  {['samsung', 'lg'].map((key) => (\n                    <TouchableOpacity\n                      key={key}\n                      style={[styles.chipBtn, tvBrand === key && styles.chipBtnActive]}\n                      activeOpacity={0.55}\n                      onPress={() => setTvBrand(key)}\n                    >\n                      <Text\n                        style={[styles.chipText, tvBrand === key && styles.chipTextActive]}\n                      >\n                        {TV_IR_BRANDS[key].label}\n                      </Text>\n                    </TouchableOpacity>\n                  ))}\n                </View>\n\n                <TouchableOpacity style={styles.doneBtn} activeOpacity={0.55} onPress={onClose}>\n                  <Text style={styles.btnTextBold}>تم</Text>\n                </TouchableOpacity>\n              </View>\n            ) : (\n              <View style={styles.sectionBlock}>\n                <View style={styles.rowGap}>\n                  <TouchableOpacity\n                    style={[\n                      styles.chipBtn,\n                      wifiProtocol === 'samsung_tizen' && styles.chipBtnActive,\n                    ]}\n                    activeOpacity={0.55}\n                    onPress={() => {\n                      setWifiProtocol('samsung_tizen');\n                      setTvPort('8002');\n                      setDialPort('8080');\n                    }}\n                  >\n                    <Text\n                      style={[\n                        styles.chipText,\n                        wifiProtocol === 'samsung_tizen' && styles.chipTextActive,\n                      ]}\n                    >\n                      Samsung Tizen\n                    </Text>\n                  </TouchableOpacity>\n                  <TouchableOpacity\n                    style={[\n                      styles.chipBtn,\n                      wifiProtocol === 'android_tv' && styles.chipBtnActive,\n                    ]}\n                    activeOpacity={0.55}\n                    onPress={() => {\n                      setWifiProtocol('android_tv');\n                      setTvPort('8080');\n                      setDialPort('8008');\n                    }}\n                  >\n                    <Text\n                      style={[\n                        styles.chipText,\n                        wifiProtocol === 'android_tv' && styles.chipTextActive,\n                      ]}\n                    >\n                      Android TV\n                    </Text>\n                  </TouchableOpacity>\n                  <TouchableOpacity\n                    style={[styles.chipBtn, wifiProtocol === 'roku' && styles.chipBtnActive]}\n                    activeOpacity={0.55}\n                    onPress={() => {\n                      setWifiProtocol('roku');\n                      setTvPort('8060');\n                      setDialPort('8060');\n                    }}\n                  >\n                    <Text\n                      style={[\n                        styles.chipText,\n                        wifiProtocol === 'roku' && styles.chipTextActive,\n                      ]}\n                    >\n                      Roku ECP\n                    </Text>\n                  </TouchableOpacity>\n                </View>\n\n                <View style={styles.modalScanRow}>\n                  <View style={styles.portField}>\n                    <Text style={styles.inputLabel}>نطاق الشبكة (Subnet)</Text>\n                    <TextInput\n                      style={styles.input}\n                      value={subnetPrefix}\n                      onChangeText={setSubnetPrefix}\n                      keyboardType=\"numeric\"\n                      placeholder=\"192.168.1\"\n                      placeholderTextColor={colors.textTertiary}\n                    />\n                  </View>\n                  <TouchableOpacity\n                    style={[styles.modalScanBtn, isDiscovering && styles.scanBtnActive]}\n                    activeOpacity={0.55}\n                    onPress={() => onScanSmartTvs()}\n                  >\n                    {isDiscovering ? (\n                      <View style={styles.scanBtnInner}>\n                        <ActivityIndicator size=\"small\" color={colors.textPrimary} />\n                        <Text style={styles.btnTextBold}>إيقاف</Text>\n                      </View>\n                    ) : (\n                      <Text style={styles.btnTextBold}>البحث عن الشاشات</Text>\n                    )}\n                  </TouchableOpacity>\n                </View>\n\n                {isConnectingWifi ? (\n                  <View style={styles.statusCard}>\n                    <ActivityIndicator size=\"small\" color={colors.accent} />\n                    <Text style={styles.statusText}>\n                      جاري الاقتران والاتصال بـ {tvIp}:{tvPort}...\n                    </Text>\n                  </View>\n                ) : null}\n\n                {isDiscovering ? (\n                  <Text style={styles.scanProgressText}>\n                    جاري فحص الشبكة ({subnetPrefix}.1 - 254)... {scanProgress.scanned}/\n                    {scanProgress.total}\n                  </Text>\n                ) : null}\n\n                {discoveredTvs.length > 0 ? (\n                  <View style={styles.modalDiscoveryList}>\n                    {discoveredTvs.map((device) => {\n                      const isSelected = device.ip === tvIp;\n                      return (\n                        <TouchableOpacity\n                          key={`modal-${device.ip}-${device.protocol}`}\n                          style={[\n                            styles.discoveredItem,\n                            isSelected && styles.discoveredItemActive,\n                          ]}\n                          activeOpacity={0.55}\n                          onPress={() => onSelectDiscoveredTv(device)}\n                        >\n                          <View style={styles.discoveredMeta}>\n                            <Text style={styles.discoveredName}>{device.name}</Text>\n                            <Text style={styles.discoveredSub}>\n                              {device.modelName} · {device.ip}:{device.port}\n                            </Text>\n                          </View>\n                          <Text style={styles.discoveredConnectTag}>\n                            {isSelected && wifiStatus.isConnected ? 'متصل' : 'اتصال'}\n                          </Text>\n                        </TouchableOpacity>\n                      );\n                    })}\n                  </View>\n                ) : !isDiscovering && hasScannedOnce ? (\n                  <Text style={styles.emptySearchText}>\n                    لم يتم العثور على شاشات على النطاق {subnetPrefix}.x\n                  </Text>\n                ) : null}\n\n                <View>\n                  <Text style={styles.inputLabel}>عنوان IP المحلي للشاشة</Text>\n                  <TextInput\n                    style={styles.input}\n                    value={tvIp}\n                    onChangeText={(val) => {\n                      setTvIp(val);\n                      const detectedSubnet = getSubnetFromIp(val);\n                      if (detectedSubnet !== subnetPrefix && val.split('.').length >= 3) {\n                        setSubnetPrefix(detectedSubnet);\n                      }\n                    }}\n                    keyboardType=\"numeric\"\n                    placeholder=\"192.168.1.50\"\n                    placeholderTextColor={colors.textTertiary}\n                  />\n                </View>\n\n                <View style={styles.rowGap}>\n                  <View style={styles.portField}>\n                    <Text style={styles.inputLabel}>منفذ التحكم (8002 / 8001)</Text>\n                    <TextInput\n                      style={styles.input}\n                      value={tvPort}\n                      onChangeText={setTvPort}\n                      keyboardType=\"numeric\"\n                      placeholder=\"8002\"\n                      placeholderTextColor={colors.textTertiary}\n                    />\n                  </View>\n                  <View style={styles.portField}>\n                    <Text style={styles.inputLabel}>منفذ DIAL Cast</Text>\n                    <TextInput\n                      style={styles.input}\n                      value={dialPort}\n                      onChangeText={setDialPort}\n                      keyboardType=\"numeric\"\n                      placeholder=\"8080\"\n                      placeholderTextColor={colors.textTertiary}\n                    />\n                  </View>\n                </View>\n\n                {wifiProtocol === 'samsung_tizen' ? (\n                  <View style={styles.tokenStatusBox}>\n                    <Text style={styles.tokenStatusLabel}>\n                      حالة الاقتران:{' '}\n                      {wifiStatus.hasSavedToken\n                        ? 'Token محفوظ محلياً'\n                        : 'سيتم طلب الموافقة عند أول اتصال'}\n                    </Text>\n                    {wifiStatus.hasSavedToken ? (\n                      <TouchableOpacity\n                        style={styles.clearTokenBtn}\n                        activeOpacity={0.55}\n                        onPress={onClearSavedToken}\n                      >\n                        <Text style={styles.clearTokenText}>مسح التوكن</Text>\n                      </TouchableOpacity>\n                    ) : null}\n                  </View>\n                ) : null}\n\n                <View style={styles.rowGap}>\n                  <TouchableOpacity\n                    style={styles.modalCancelBtn}\n                    activeOpacity={0.55}\n                    onPress={onClose}\n                  >\n                    <Text style={styles.btnText}>إلغاء</Text>\n                  </TouchableOpacity>\n                  <TouchableOpacity\n                    style={[styles.modalCancelBtn, styles.modalSaveBtn]}\n                    activeOpacity={0.55}\n                    onPress={onSaveWifi}\n                  >\n                    <Text style={styles.btnTextBold}>حفظ واتصال</Text>\n                  </TouchableOpacity>\n                </View>\n              </View>\n            )}\n          </ScrollView>\n        </View>\n      </View>\n    </Modal>\n  );\n}\n\nconst styles = StyleSheet.create({\n  modalBackdrop: {\n    flex: 1,\n    backgroundColor: colors.backdrop,\n    justifyContent: 'center',\n    padding: spacing.lg,\n  },\n  modalCard: {\n    backgroundColor: colors.surface,\n    borderRadius: radii.panel,\n    borderWidth: 1,\n    borderColor: colors.border,\n    maxHeight: '88%',\n    overflow: 'hidden',\n  },\n  modalScroll: {\n    width: '100%',\n  },\n  modalScrollContent: {\n    padding: spacing.lg,\n    gap: spacing.md,\n  },\n  modalTitle: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.title,\n    fontWeight: '700',\n    textAlign: 'right',\n  },\n  segmentBox: {\n    flexDirection: 'row',\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.capsule,\n    padding: 3,\n    gap: spacing.xs,\n  },\n  segmentBtn: {\n    flex: 1,\n    height: 40,\n    borderRadius: radii.capsule,\n    borderWidth: 1,\n    borderColor: colors.transparent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  segmentActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  segmentText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  segmentTextActive: {\n    color: colors.textPrimary,\n  },\n\n  sectionBlock: {\n    gap: spacing.md,\n  },\n  rowGap: { flexDirection: 'row', gap: spacing.sm },\n  chipBtn: {\n    flex: 1,\n    height: 44,\n    borderRadius: radii.capsule,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n    paddingHorizontal: spacing.sm,\n  },\n  chipBtnActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  chipText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'center',\n  },\n  chipTextActive: {\n    color: colors.textPrimary,\n    fontWeight: '600',\n  },\n\n  doneBtn: {\n    height: 46,\n    borderRadius: radii.button,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.accent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n\n  scanBtnActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  scanBtnInner: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: spacing.xs,\n  },\n  statusCard: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: spacing.sm,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    padding: spacing.md,\n  },\n  statusText: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n  scanProgressText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'right',\n  },\n  emptySearchText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'center',\n    paddingVertical: spacing.xs,\n  },\n\n  discoveredItem: {\n    minHeight: 50,\n    flexDirection: 'row',\n    justifyContent: 'space-between',\n    alignItems: 'center',\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    paddingHorizontal: spacing.md,\n    paddingVertical: spacing.sm,\n    gap: spacing.sm,\n  },\n  discoveredItemActive: {\n    borderColor: colors.accent,\n    backgroundColor: colors.accentSoft,\n  },\n  discoveredMeta: { flex: 1, gap: 2 },\n  discoveredName: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n    textAlign: 'right',\n  },\n  discoveredSub: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'right',\n  },\n  discoveredConnectTag: {\n    color: colors.accent,\n    fontSize: fontSizes.label,\n    fontWeight: '600',\n  },\n\n  btnText: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  btnTextBold: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n\n  inputLabel: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'right',\n    marginBottom: spacing.xs,\n  },\n  portField: { flex: 1 },\n  input: {\n    height: 44,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    paddingHorizontal: spacing.md,\n    color: colors.textPrimary,\n    fontFamily: 'monospace',\n    textAlign: 'left',\n  },\n  modalScanRow: {\n    flexDirection: 'row',\n    alignItems: 'flex-end',\n    gap: spacing.sm,\n  },\n  modalScanBtn: {\n    height: 44,\n    paddingHorizontal: spacing.md,\n    borderRadius: radii.button,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.accent,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  modalDiscoveryList: {\n    gap: spacing.xs,\n  },\n  tokenStatusBox: {\n    minHeight: 44,\n    flexDirection: 'row',\n    justifyContent: 'space-between',\n    alignItems: 'center',\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    borderRadius: radii.button,\n    paddingHorizontal: spacing.md,\n  },\n  tokenStatusLabel: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    flex: 1,\n    textAlign: 'right',\n  },\n  clearTokenBtn: {\n    height: 44,\n    justifyContent: 'center',\n    paddingHorizontal: spacing.sm,\n  },\n  clearTokenText: {\n    color: colors.accent,\n    fontSize: fontSizes.label,\n    fontWeight: '600',\n  },\n  modalCancelBtn: {\n    flex: 1,\n    height: 46,\n    borderRadius: radii.button,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  modalSaveBtn: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n});\n\nexport default WifiSheet;\n",
  },
  {
    id: "app-js",
    path: "App.js",
    titleAr: "الملف الجذري للتطبيق (App.js)",
    category: "ui",
    language: "javascript",
    summaryAr:
      "يدير الحالة المشتركة، الهيدر، شريط التبويب السفلي، ويربط مكونات TvRemote و AcRemote و WifiSheet.",
    content: "import React, { useEffect, useRef, useState } from 'react';\nimport {\n  I18nManager,\n  NativeModules,\n  Platform,\n  SafeAreaView,\n  StatusBar,\n  StyleSheet,\n  Text,\n  TouchableOpacity,\n  Vibration,\n  View,\n} from 'react-native';\nimport AcRemote from './src/components/AcRemote';\nimport RemoteIcon from './src/components/RemoteIcon';\nimport TvRemote from './src/components/TvRemote';\nimport WifiSheet from './src/components/WifiSheet';\nimport {\n  CARRIER_38KHZ,\n  TV_IR_BRANDS,\n  buildAcIrPattern,\n  encodeNecToMicroseconds,\n  encodeSamsungDual0707,\n} from './src/ir/encoders';\nimport WifiControl from './src/services/WifiControl';\nimport { colors, fontSizes, radii, spacing } from './src/theme';\n\nconst IrManagerModule = Platform.OS === 'web' ? null : NativeModules?.IrManagerModule;\n\nif (Platform.OS !== 'web' && I18nManager && !I18nManager.isRTL) {\n  I18nManager.allowRTL(true);\n  I18nManager.forceRTL(true);\n}\n\nfunction triggerHaptic(type = 'impactLight') {\n  try {\n    if (Platform.OS === 'web') return;\n    const nativeHaptic =\n      NativeModules?.RNReactNativeHapticFeedback || NativeModules?.RNHapticFeedback;\n    if (nativeHaptic && typeof nativeHaptic.trigger === 'function') {\n      nativeHaptic.trigger(type, {\n        enableVibrateFallback: true,\n        ignoreAndroidSystemSettings: false,\n      });\n      return;\n    }\n    const duration =\n      type === 'impactMedium' ? 14 : type === 'notificationSuccess' ? 18 : 8;\n    if (Vibration && typeof Vibration.vibrate === 'function') {\n      Vibration.vibrate(duration);\n    }\n  } catch (_) {\n    // تجاهل أي خطأ إذا كان الاهتزاز غير مدعوم\n  }\n}\n\nfunction getSubnetFromIp(ip) {\n  const parts = String(ip || '')\n    .trim()\n    .split('.');\n  if (parts.length >= 3 && parts.slice(0, 3).every((p) => /^\\d{1,3}$/.test(p))) {\n    return `${parts[0]}.${parts[1]}.${parts[2]}`;\n  }\n  return '192.168.1';\n}\n\nfunction App() {\n  const [activeTab, setActiveTab] = useState('tv');\n  const [hasIrHardware, setHasIrHardware] = useState(null);\n  const [feedback, setFeedback] = useState({\n    text: '',\n    tone: 'neutral',\n  });\n\n  // حالة ريموت الشاشة والواي فاي والاقتران التلقائي\n  const [tvTransport, setTvTransport] = useState('ir');\n  const [tvBrand, setTvBrand] = useState('samsung');\n  const [wifiProtocol, setWifiProtocol] = useState('samsung_tizen');\n  const [tvIp, setTvIp] = useState('192.168.1.50');\n  const [tvPort, setTvPort] = useState('8002');\n  const [dialPort, setDialPort] = useState('8080');\n  const [subnetPrefix, setSubnetPrefix] = useState('192.168.1');\n  const [showWifiModal, setShowWifiModal] = useState(false);\n\n  const [wifiStatus, setWifiStatus] = useState(WifiControl.getStatus());\n  const [isDiscovering, setIsDiscovering] = useState(false);\n  const [scanProgress, setScanProgress] = useState({ scanned: 0, total: 254 });\n  const [discoveredTvs, setDiscoveredTvs] = useState([]);\n  const [hasScannedOnce, setHasScannedOnce] = useState(false);\n  const [isConnectingWifi, setIsConnectingWifi] = useState(false);\n\n  // حالة البحث وبث يوتيوب\n  const [isLaunchingYouTube, setIsLaunchingYouTube] = useState(false);\n  const [searchQuery, setSearchQuery] = useState('');\n  const [isSearching, setIsSearching] = useState(false);\n  const [hasSearchedOnce, setHasSearchedOnce] = useState(false);\n  const [searchResults, setSearchResults] = useState([]);\n  const [castingVideoId, setCastingVideoId] = useState(null);\n\n  // حالة ريموت التكييف\n  const [acBrand, setAcBrand] = useState('gree');\n  const [acState, setAcState] = useState({\n    power: true,\n    temperature: 22,\n    mode: 'cool',\n    fanSpeed: 'auto',\n    swing: true,\n  });\n\n  const lastCommandTimeRef = useRef(0);\n\n  useEffect(() => {\n    let mounted = true;\n\n    const unsubscribe = WifiControl.subscribe((status) => {\n      if (mounted) {\n        setWifiStatus(status);\n      }\n    });\n\n    WifiControl.loadSavedConfig().then((saved) => {\n      if (!mounted || !saved) return;\n      if (saved.ipAddress) {\n        setTvIp(saved.ipAddress);\n        setSubnetPrefix(getSubnetFromIp(saved.ipAddress));\n      }\n      if (saved.protocol) setWifiProtocol(saved.protocol);\n      if (saved.port) setTvPort(String(saved.port));\n      if (saved.dialPort) setDialPort(String(saved.dialPort));\n    });\n\n    if (Platform.OS === 'web') {\n      setHasIrHardware(true);\n    } else if (Platform.OS === 'android' && IrManagerModule) {\n      IrManagerModule.hasIrEmitter()\n        .then((supported) => {\n          if (mounted) {\n            setHasIrHardware(Boolean(supported));\n          }\n        })\n        .catch(() => {\n          if (mounted) {\n            setHasIrHardware(false);\n          }\n        });\n    } else {\n      setHasIrHardware(false);\n    }\n\n    return () => {\n      mounted = false;\n      unsubscribe();\n      WifiControl.abortDiscovery();\n    };\n  }, []);\n\n  // التبديل التلقائي إلى Wi-Fi إذا كان الهاتف لا يدعم IR\n  useEffect(() => {\n    if (hasIrHardware === false) {\n      setTvTransport('wifi');\n    }\n  }, [hasIrHardware]);\n\n  // إخفاء شريط التنبيه تلقائياً بعد 1200ms\n  useEffect(() => {\n    if (!feedback.text) return undefined;\n    const timer = setTimeout(() => {\n      setFeedback({ text: '', tone: 'neutral' });\n    }, 1200);\n    return () => clearTimeout(timer);\n  }, [feedback]);\n\n  const transmitIrPattern = async (pattern) => {\n    if (Platform.OS === 'web') {\n      return { mocked: true, pulseCount: pattern.length, carrierFrequency: CARRIER_38KHZ };\n    }\n    if (Platform.OS !== 'android' || !IrManagerModule) {\n      throw new Error('وحدة IrManagerModule متاحة فقط على أجهزة أندرويد.');\n    }\n    const available = await IrManagerModule.hasIrEmitter();\n    if (!available) {\n      throw new Error('هذا الهاتف لا يحتوي على مستشعر IR Blaster.');\n    }\n    await IrManagerModule.transmitIR(pattern, CARRIER_38KHZ);\n  };\n\n  const handleTvCommand = async (commandKey) => {\n    triggerHaptic(commandKey === 'POWER' ? 'impactMedium' : 'impactLight');\n    const now = Date.now();\n    if (now - lastCommandTimeRef.current < 80) {\n      // السماح بالضغطات المتكررة فوراً مع تجنب النقر المزدوج اللحظي فقط\n      lastCommandTimeRef.current = now;\n    } else {\n      lastCommandTimeRef.current = now;\n    }\n\n    try {\n      if (tvTransport === 'ir') {\n        const brand = TV_IR_BRANDS[tvBrand];\n        const cmdHex = brand.commands[commandKey];\n        if (cmdHex === undefined) {\n          throw new Error(`الأمر ${commandKey} غير معرف لجهاز ${brand.label}`);\n        }\n        const pattern =\n          brand.protocol === 'samsung_dual'\n            ? encodeSamsungDual0707(cmdHex, brand.addressHigh, brand.addressLow)\n            : encodeNecToMicroseconds(brand.address, cmdHex);\n        await transmitIrPattern(pattern);\n      } else {\n        await WifiControl.sendCommand(commandKey);\n      }\n      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });\n    } catch (error) {\n      setFeedback({\n        text: error && error.message ? error.message : 'تعذر تنفيذ الأمر',\n        tone: 'error',\n      });\n    }\n  };\n\n  const handleScanSmartTvs = async (overrideSubnet) => {\n    triggerHaptic('impactLight');\n    if (isDiscovering) {\n      WifiControl.abortDiscovery();\n      setIsDiscovering(false);\n      return;\n    }\n\n    const activeSubnet = getSubnetFromIp(\n      overrideSubnet || tvIp || `${subnetPrefix}.1`\n    );\n    setSubnetPrefix(activeSubnet);\n    setIsDiscovering(true);\n    setHasScannedOnce(true);\n    setDiscoveredTvs([]);\n    setScanProgress({ scanned: 0, total: 254 });\n\n    try {\n      const devices = await WifiControl.discoverSmartTvs({\n        subnetPrefix: activeSubnet,\n        onProgress: ({ scanned, total, foundDevices }) => {\n          setScanProgress({ scanned, total });\n          setDiscoveredTvs(foundDevices);\n        },\n      });\n      setDiscoveredTvs(devices);\n    } catch (error) {\n      setFeedback({\n        text:\n          error && error.message\n            ? error.message\n            : 'تعذر إتمام البحث عن الشاشات في الشبكة المحلية.',\n        tone: 'error',\n      });\n    } finally {\n      setIsDiscovering(false);\n    }\n  };\n\n  const handleSelectDiscoveredTv = async (device) => {\n    triggerHaptic('impactLight');\n    WifiControl.abortDiscovery();\n    setIsDiscovering(false);\n\n    const nextPort = String(\n      device.port || (device.protocol === 'roku' ? 8060 : device.protocol === 'samsung_tizen' ? 8002 : 8080)\n    );\n    const nextDial = String(device.dialPort || (device.protocol === 'roku' ? 8060 : 8080));\n\n    setWifiProtocol(device.protocol);\n    setTvIp(device.ip);\n    setTvPort(nextPort);\n    setDialPort(nextDial);\n    setSubnetPrefix(getSubnetFromIp(device.ip));\n\n    WifiControl.configure({\n      protocol: device.protocol,\n      ipAddress: device.ip,\n      port: Number(nextPort),\n      dialPort: Number(nextDial),\n      deviceName: device.name,\n    });\n\n    setShowWifiModal(false);\n    setIsConnectingWifi(true);\n    try {\n      await WifiControl.connect();\n      triggerHaptic('notificationSuccess');\n      setFeedback({ text: 'تم الاتصال بالشاشة', tone: 'success' });\n    } catch (error) {\n      setFeedback({\n        text:\n          error && error.message\n            ? error.message\n            : `تم اختيار ${device.name} (${device.ip}) ولكن تعذر الاتصال الفوري.`,\n        tone: 'error',\n      });\n    } finally {\n      setIsConnectingWifi(false);\n    }\n  };\n\n  const handleSaveWifi = async () => {\n    triggerHaptic('impactLight');\n    const defaultPort =\n      wifiProtocol === 'roku' ? 8060 : wifiProtocol === 'samsung_tizen' ? 8002 : 8080;\n    const defaultDial =\n      wifiProtocol === 'roku' ? 8060 : wifiProtocol === 'samsung_tizen' ? 8080 : 8008;\n\n    const parsedPort = Number(tvPort) || defaultPort;\n    const parsedDialPort = Number(dialPort) || defaultDial;\n\n    WifiControl.configure({\n      protocol: wifiProtocol,\n      ipAddress: tvIp,\n      port: parsedPort,\n      dialPort: parsedDialPort,\n    });\n    setSubnetPrefix(getSubnetFromIp(tvIp));\n    setShowWifiModal(false);\n    setIsConnectingWifi(true);\n    try {\n      await WifiControl.connect();\n      triggerHaptic('notificationSuccess');\n      setFeedback({ text: 'تم الاتصال بالشاشة', tone: 'success' });\n    } catch (error) {\n      setFeedback({\n        text: error && error.message ? error.message : 'تعذر الاتصال بالواي فاي',\n        tone: 'error',\n      });\n    } finally {\n      setIsConnectingWifi(false);\n    }\n  };\n\n  const handleClearSavedToken = async () => {\n    triggerHaptic('impactLight');\n    await WifiControl.clearToken(tvIp);\n    setFeedback({ text: 'تم مسح التوكن', tone: 'success' });\n  };\n\n  const handleLaunchYouTube = async () => {\n    triggerHaptic('impactLight');\n    setIsLaunchingYouTube(true);\n    try {\n      await WifiControl.launchYouTube();\n      triggerHaptic('notificationSuccess');\n      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });\n    } catch (error) {\n      setFeedback({\n        text: error && error.message ? error.message : 'تعذر فتح تطبيق يوتيوب',\n        tone: 'error',\n      });\n    } finally {\n      setIsLaunchingYouTube(false);\n    }\n  };\n\n  const handleSearchYouTube = async () => {\n    triggerHaptic('impactLight');\n    setIsSearching(true);\n    setHasSearchedOnce(true);\n    try {\n      const results = await WifiControl.searchYouTubeVideos(searchQuery);\n      setSearchResults(results);\n    } catch (error) {\n      setFeedback({\n        text: error && error.message ? error.message : 'تعذر البحث في يوتيوب',\n        tone: 'error',\n      });\n    } finally {\n      setIsSearching(false);\n    }\n  };\n\n  const handleCastVideo = async (video) => {\n    if (!video || !video.videoId) return;\n    triggerHaptic('impactLight');\n    setCastingVideoId(video.videoId);\n    try {\n      await WifiControl.castYouTubeVideo(video.videoId);\n      triggerHaptic('notificationSuccess');\n      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });\n    } catch (error) {\n      setFeedback({\n        text: error && error.message ? error.message : 'تعذر بث الفيديو على الشاشة',\n        tone: 'error',\n      });\n    } finally {\n      setCastingVideoId(null);\n    }\n  };\n\n  const updateAcAndTransmit = async (nextAcState) => {\n    triggerHaptic(nextAcState.power !== acState.power ? 'impactMedium' : 'impactLight');\n    setAcState(nextAcState);\n    try {\n      const pattern = buildAcIrPattern(acBrand, nextAcState);\n      await transmitIrPattern(pattern);\n      setFeedback({ text: 'تم إرسال الأمر', tone: 'success' });\n    } catch (error) {\n      setFeedback({\n        text: error && error.message ? error.message : 'تعذر إرسال أمر التكييف',\n        tone: 'error',\n      });\n    }\n  };\n\n  const isStatusConnected =\n    tvTransport === 'wifi' ? Boolean(wifiStatus.isConnected) : Boolean(hasIrHardware);\n  const statusLabel =\n    tvTransport === 'wifi'\n      ? wifiStatus.isConnected\n        ? 'متصل Wi-Fi'\n        : 'غير متصل'\n      : hasIrHardware\n      ? 'IR جاهز'\n      : 'بلا IR';\n\n  return (\n    <SafeAreaView style={styles.root}>\n      <StatusBar barStyle=\"light-content\" backgroundColor={colors.background} />\n\n      {/* [أ] Header مدمج ارتفاع 44: يمين زر طاقة 40×40 + \"ريموت\"، يسار نقطة 6px + نص 11px */}\n      <View style={styles.header}>\n        <View style={styles.headerStart}>\n          <TouchableOpacity\n            style={styles.headerPowerBtn}\n            activeOpacity={0.55}\n            accessibilityLabel=\"الطاقة\"\n            accessibilityRole=\"button\"\n            onPress={() => handleTvCommand('POWER')}\n          >\n            <RemoteIcon name=\"power\" color={colors.textPrimary} size={18} />\n          </TouchableOpacity>\n          <Text style={styles.headerTitle}>ريموت</Text>\n        </View>\n\n        <View style={styles.headerStatus}>\n          <View\n            style={[\n              styles.statusDot,\n              isStatusConnected ? styles.statusDotOn : styles.statusDotOff,\n            ]}\n          />\n          <Text style={styles.statusText}>{statusLabel}</Text>\n        </View>\n      </View>\n\n      {/* شريط إشعار رفيع ارتفاع 28 لا يزيح التخطيط */}\n      <View style={styles.feedbackSlot}>\n        {feedback.text ? (\n          <View\n            style={[\n              styles.feedbackPill,\n              feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess,\n            ]}\n          >\n            <Text style={styles.feedbackText} numberOfLines={1}>\n              {feedback.text}\n            </Text>\n          </View>\n        ) : null}\n      </View>\n\n      <View style={styles.mainContent}>\n        {activeTab === 'tv' ? (\n          <TvRemote\n            tvTransport={tvTransport}\n            setTvTransport={(mode) => {\n              triggerHaptic('impactLight');\n              setTvTransport(mode);\n            }}\n            tvBrand={tvBrand}\n            setTvBrand={(brand) => {\n              triggerHaptic('impactLight');\n              setTvBrand(brand);\n            }}\n            wifiProtocol={wifiProtocol}\n            tvIp={tvIp}\n            tvPort={tvPort}\n            wifiStatus={wifiStatus}\n            isDiscovering={isDiscovering}\n            discoveredTvs={discoveredTvs}\n            hasScannedOnce={hasScannedOnce}\n            onOpenSettings={() => {\n              triggerHaptic('impactLight');\n              setShowWifiModal(true);\n            }}\n            onScanSmartTvs={handleScanSmartTvs}\n            onSelectDiscoveredTv={handleSelectDiscoveredTv}\n            onTvCommand={handleTvCommand}\n            onLaunchYouTube={handleLaunchYouTube}\n            isLaunchingYouTube={isLaunchingYouTube}\n            searchQuery={searchQuery}\n            setSearchQuery={setSearchQuery}\n            onSearchYouTube={handleSearchYouTube}\n            isSearching={isSearching}\n            hasSearchedOnce={hasSearchedOnce}\n            searchResults={searchResults}\n            castingVideoId={castingVideoId}\n            onCastVideo={handleCastVideo}\n          />\n        ) : (\n          <AcRemote\n            acBrand={acBrand}\n            setAcBrand={(brand) => {\n              triggerHaptic('impactLight');\n              setAcBrand(brand);\n            }}\n            acState={acState}\n            updateAcAndTransmit={updateAcAndTransmit}\n          />\n        )}\n      </View>\n\n      {/* [و] شريط التبويب السفلي بارتفاع 52 وحد علوي فقط */}\n      <View style={styles.tabBar}>\n        <TouchableOpacity\n          style={[styles.tabBtn, activeTab === 'tv' && styles.tabBtnActive]}\n          activeOpacity={0.55}\n          accessibilityLabel=\"الشاشة\"\n          accessibilityRole=\"button\"\n          onPress={() => {\n            triggerHaptic('impactLight');\n            setActiveTab('tv');\n          }}\n        >\n          <Text style={[styles.tabText, activeTab === 'tv' && styles.tabTextActive]}>\n            الشاشة\n          </Text>\n        </TouchableOpacity>\n\n        <TouchableOpacity\n          style={[styles.tabBtn, activeTab === 'ac' && styles.tabBtnActive]}\n          activeOpacity={0.55}\n          accessibilityLabel=\"التكييف\"\n          accessibilityRole=\"button\"\n          onPress={() => {\n            triggerHaptic('impactLight');\n            setActiveTab('ac');\n          }}\n        >\n          <Text style={[styles.tabText, activeTab === 'ac' && styles.tabTextActive]}>\n            التكييف\n          </Text>\n        </TouchableOpacity>\n      </View>\n\n      <WifiSheet\n        visible={showWifiModal}\n        onClose={() => setShowWifiModal(false)}\n        tvTransport={tvTransport}\n        setTvTransport={setTvTransport}\n        tvBrand={tvBrand}\n        setTvBrand={setTvBrand}\n        wifiProtocol={wifiProtocol}\n        setWifiProtocol={setWifiProtocol}\n        tvPort={tvPort}\n        setTvPort={setTvPort}\n        dialPort={dialPort}\n        setDialPort={setDialPort}\n        subnetPrefix={subnetPrefix}\n        setSubnetPrefix={setSubnetPrefix}\n        isDiscovering={isDiscovering}\n        scanProgress={scanProgress}\n        hasScannedOnce={hasScannedOnce}\n        isConnectingWifi={isConnectingWifi}\n        discoveredTvs={discoveredTvs}\n        tvIp={tvIp}\n        setTvIp={setTvIp}\n        wifiStatus={wifiStatus}\n        getSubnetFromIp={getSubnetFromIp}\n        onScanSmartTvs={handleScanSmartTvs}\n        onSelectDiscoveredTv={handleSelectDiscoveredTv}\n        onClearSavedToken={handleClearSavedToken}\n        onSaveWifi={handleSaveWifi}\n      />\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  root: {\n    flex: 1,\n    width: '100%',\n    backgroundColor: colors.background,\n  },\n  header: {\n    height: 44,\n    width: '100%',\n    flexDirection: 'row',\n    justifyContent: 'space-between',\n    alignItems: 'center',\n    paddingHorizontal: spacing.md,\n  },\n  headerStart: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: spacing.sm,\n  },\n  headerPowerBtn: {\n    width: 40,\n    height: 40,\n    borderRadius: radii.capsule,\n    backgroundColor: colors.danger,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  headerTitle: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.title,\n    fontWeight: '700',\n  },\n  headerStatus: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: 6,\n  },\n  statusDot: {\n    width: 6,\n    height: 6,\n    borderRadius: radii.capsule,\n  },\n  statusDotOn: {\n    backgroundColor: colors.accent,\n  },\n  statusDotOff: {\n    backgroundColor: colors.textTertiary,\n  },\n  statusText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n  },\n\n  feedbackSlot: {\n    height: 28,\n    width: '100%',\n    paddingHorizontal: spacing.md,\n    justifyContent: 'center',\n  },\n  feedbackPill: {\n    height: 26,\n    borderRadius: radii.button,\n    borderWidth: 1,\n    paddingHorizontal: spacing.md,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  feedbackSuccess: {\n    backgroundColor: colors.accentSoft,\n    borderColor: colors.accent,\n  },\n  feedbackError: {\n    backgroundColor: colors.dangerSoft,\n    borderColor: colors.danger,\n  },\n  feedbackText: {\n    color: colors.textPrimary,\n    fontSize: fontSizes.label,\n    fontWeight: '500',\n    letterSpacing: 0.3,\n    textAlign: 'center',\n  },\n\n  mainContent: {\n    flex: 1,\n    width: '100%',\n  },\n\n  tabBar: {\n    height: 52,\n    width: '100%',\n    flexDirection: 'row',\n    backgroundColor: colors.background,\n    borderTopWidth: 1,\n    borderTopColor: colors.border,\n    paddingHorizontal: spacing.md,\n    paddingVertical: 6,\n    gap: spacing.sm,\n  },\n  tabBtn: {\n    flex: 1,\n    borderRadius: radii.capsule,\n    backgroundColor: colors.surfaceRaised,\n    borderWidth: 1,\n    borderColor: colors.border,\n    justifyContent: 'center',\n    alignItems: 'center',\n  },\n  tabBtnActive: {\n    backgroundColor: colors.accentSegment,\n    borderColor: colors.accent,\n  },\n  tabText: {\n    color: colors.textSecondary,\n    fontSize: fontSizes.button,\n    fontWeight: '600',\n  },\n  tabTextActive: {\n    color: colors.textPrimary,\n  },\n});\n\nexport default App;\n",
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
