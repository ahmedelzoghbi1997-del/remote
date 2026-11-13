import React from 'react';
import { CheckCircle2, CloudCog, Cpu, GitBranch, KeyRound, PackageCheck } from 'lucide-react';

interface CiCdGuideSectionProps {
  onOpenFile: (fileId: string) => void;
  onDownloadZip: () => void;
}

const PIPELINE_STEPS = [
  {
    step: '01',
    title: 'تهيئة بيئة البناء',
    detail: 'تشغيل ubuntu-latest وضبط Node.js 20 و Java 17 (Temurin) و Android SDK تلقائياً.',
    icon: CloudCog,
  },
  {
    step: '02',
    title: 'تخزين Gradle مؤقتاً',
    detail: 'تسريع عمليات البناء اللاحقة عبر caching لمجلدات ~/.gradle/caches و npm.',
    icon: Cpu,
  },
  {
    step: '03',
    title: 'توقيع وبناء Release APK',
    detail: 'تشغيل ./gradlew assembleRelease مع دعم أسرار Keystore أو التراجع الآمن لتوقيع التجربة.',
    icon: KeyRound,
  },
  {
    step: '04',
    title: 'رفع الـ APK كـ Artifact',
    detail: 'حفظ android/app/build/outputs/apk/release/*.apk لمدة 30 يوماً للتحميل المباشر.',
    icon: PackageCheck,
  },
];

export default function CiCdGuideSection({
  onOpenFile,
  onDownloadZip,
}: CiCdGuideSectionProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h2 className="font-display font-bold text-2xl text-slate-100">
            سير عمل البناء السحابي (GitHub Actions CI/CD)
          </h2>
          <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
            عند رفع المشروع إلى فرع <code className="font-mono text-slate-200">main</code>، يقوم ملف{' '}
            <code className="font-mono text-sky-400">.github/workflows/build-apk.yml</code> ببناء ملف
            التثبيت النهائي وتجهيزه للتحميل بدون الحاجة لفتح Android Studio محلياً.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onOpenFile('github-actions-yml')}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#131720] hover:bg-[#1A202C] border border-[#232B3A] text-xs font-semibold text-slate-200 whitespace-nowrap transition-colors"
          >
            عرض ملف build-apk.yml
          </button>
          <button
            type="button"
            onClick={onDownloadZip}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-xs font-semibold text-white whitespace-nowrap transition-colors"
          >
            تحميل الحزمة الكاملة ZIP
          </button>
        </div>
      </div>

      {/* مراحل البناء الأربع */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PIPELINE_STEPS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.step}
              className="rounded-2xl bg-[#131720] border border-[#1E2532] p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono tabular-nums text-xs font-semibold text-sky-400">
                  {item.step}
                </span>
                <Icon className="w-4 h-4 text-slate-400" />
              </div>
              <h3 className="font-display font-semibold text-base text-slate-100">{item.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{item.detail}</p>
            </div>
          );
        })}
      </div>

      {/* أوامر الرفع وأسرار التوقيع */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-[#131720] border border-[#1E2532] p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <GitBranch className="w-4 h-4 text-sky-400" />
            <span>أوامر الرفع السريع إلى مستودع GitHub</span>
          </div>
          <pre
            dir="ltr"
            className="rounded-xl bg-[#0B0D11] border border-[#1E2532] p-4 font-mono text-xs text-slate-300 overflow-x-auto leading-6"
          >{`git init
git add .
git commit -m "feat: universal remote IR + Wi-Fi + CI/CD"
git branch -M main
git remote add origin https://github.com/<USERNAME>/universal-remote-rn.git
git push -u origin main`}</pre>
        </div>

        <div className="rounded-2xl bg-[#131720] border border-[#1E2532] p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>أسرار التوقيع الإنتاجي (GitHub Repository Secrets)</span>
          </div>
          <div className="divide-y divide-[#1E2532] text-xs">
            {[
              { name: 'ANDROID_KEYSTORE_BASE64', desc: 'ملف مفتاح التوقيع مشفراً بصيغة Base64' },
              { name: 'ANDROID_KEYSTORE_PASSWORD', desc: 'كلمة مرور مخزن المفاتيح (Store)' },
              { name: 'ANDROID_KEY_ALIAS', desc: 'الاسم المستعار للمفتاح داخل Keystore' },
              { name: 'ANDROID_KEY_PASSWORD', desc: 'كلمة مرور المفتاح الخاص' },
            ].map((secret) => (
              <div key={secret.name} className="py-2.5 flex items-center justify-between gap-4">
                <code dir="ltr" className="font-mono text-sky-400 shrink-0">
                  {secret.name}
                </code>
                <span className="text-slate-400 text-left">{secret.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
