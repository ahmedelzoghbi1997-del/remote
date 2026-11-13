import React, { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import CiCdGuideSection from './components/CiCdGuideSection';
import CodeExplorer from './components/CodeExplorer';
import PhoneRemoteSimulator from './components/PhoneRemoteSimulator';
import { RN_PROJECT_FILES } from './data/rnProjectFiles';
import { buildProjectZipBlob, triggerDownloadBlob } from './utils/zipBuilder';

export default function App() {
  const [selectedFileId, setSelectedFileId] = useState<string>('ir-module-kt');
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);
  const codeSectionRef = useRef<HTMLElement | null>(null);

  const handleJumpToSourceFile = (fileId: string) => {
    setSelectedFileId(fileId);
    codeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDownloadProjectZip = () => {
    const zipBlob = buildProjectZipBlob(
      RN_PROJECT_FILES.map((file) => ({
        path: file.path,
        content: file.content,
      }))
    );
    triggerDownloadBlob(zipBlob, 'universal-remote-react-native.zip');
    setDownloadFeedback('تم تجهيز وتحميل حزمة المشروع الكاملة (ZIP)');
    setTimeout(() => setDownloadFeedback(null), 3500);
  };

  return (
    <div className="min-h-screen bg-[#0B0D11] text-slate-100 flex flex-col">
      {/* شريط التنقل العلوي: 3 مناطق متوازنة في سطر واحد */}
      <header className="sticky top-0 z-30 bg-[#0B0D11]/90 backdrop-blur-md border-b border-[#1E2532]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="#simulator"
            className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            الريموت الشامل
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
            <a
              href="#simulator"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              المحاكي الحي
            </a>
            <a
              href="#code-studio"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              شيفرة المشروع
            </a>
            <a
              href="#cicd"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              البناء السحابي
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleDownloadProjectZip}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-xs font-semibold text-white flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تحميل المشروع ZIP</span>
            </button>
          </div>
        </div>
      </header>

      {/* إشعار التحميل عند التفعيل */}
      {downloadFeedback && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4">
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs font-medium text-emerald-200 text-center">
            {downloadFeedback}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 space-y-16">
        {/* القسم الأول: الترويسة + المحاكي التفاعلي */}
        <section id="simulator" className="space-y-8 scroll-mt-20">
          <div className="max-w-3xl space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>React Native Bare Workflow</span>
              <span aria-hidden="true">·</span>
              <span>Kotlin ConsumerIrManager</span>
              <span aria-hidden="true">·</span>
              <span>Roku ECP &amp; Android TV WebSocket</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">com.universalremote</span>
            </div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-slate-100 leading-tight [text-wrap:balance]">
              تطبيق ريموت كنترول شامل للأندرويد عبر الأشعة تحت الحمراء والواي فاي
            </h1>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl">
              اختبر واجهة الريموت العربية في المحاكي الحي وشاهد نبضات الـ IR أو حزم الواي فاي
              لحظياً، ثم انسخ أو حمّل الشيفرة الإنتاجية الكاملة جاهزة للرفع إلى GitHub وبناء الـ
              APK.
            </p>
          </div>

          <PhoneRemoteSimulator onSelectSourceFile={handleJumpToSourceFile} />
        </section>

        <hr className="border-[#1E2532]" />

        {/* القسم الثاني: مستعرض الشيفرة المصدرية الكاملة */}
        <section id="code-studio" ref={codeSectionRef} className="space-y-6 scroll-mt-20">
          <div className="space-y-1.5">
            <h2 className="font-display font-bold text-2xl text-slate-100">
              ملفات المشروع الجاهزة للإنتاج
            </h2>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              جميع الملفات مسماة بمساراتها الدقيقة داخل مشروع React Native Android Bare Workflow
              وجاهزة للنسخ المباشر أو التصدير كملف مضغوط.
            </p>
          </div>

          <CodeExplorer selectedFileId={selectedFileId} onSelectFile={setSelectedFileId} />
        </section>

        <hr className="border-[#1E2532]" />

        {/* القسم الثالث: دليل البناء السحابي GitHub Actions */}
        <section id="cicd" className="scroll-mt-20">
          <CiCdGuideSection
            onOpenFile={handleJumpToSourceFile}
            onDownloadZip={handleDownloadProjectZip}
          />
        </section>
      </main>

      <footer className="border-t border-[#1E2532] py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>حزمة الأندرويد: com.universalremote · React Native 0.76 · Kotlin Native Bridge</span>
          <button
            type="button"
            onClick={handleDownloadProjectZip}
            className="text-sky-400 hover:text-sky-300 font-medium transition-colors"
          >
            تنزيل جميع الملفات (.zip)
          </button>
        </div>
      </footer>
    </div>
  );
}
