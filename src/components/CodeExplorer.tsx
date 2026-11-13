import React, { useMemo, useState } from 'react';
import { Check, Copy, FileCode2, FolderOpen, Search } from 'lucide-react';
import {
  CATEGORY_LABELS,
  ProjectFileCategory,
  ProjectFileEntry,
  RN_PROJECT_FILES,
} from '../data/rnProjectFiles';

interface CodeExplorerProps {
  selectedFileId: string;
  onSelectFile: (fileId: string) => void;
}

export default function CodeExplorer({ selectedFileId, onSelectFile }: CodeExplorerProps) {
  const [category, setCategory] = useState<'all' | ProjectFileCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return RN_PROJECT_FILES.filter((file) => {
      const matchesCategory = category === 'all' || file.category === category;
      const matchesSearch =
        !q ||
        file.path.toLowerCase().includes(q) ||
        file.titleAr.toLowerCase().includes(q) ||
        file.content.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [category, searchQuery]);

  const activeFile: ProjectFileEntry = useMemo(() => {
    return (
      RN_PROJECT_FILES.find((f) => f.id === selectedFileId) ||
      filteredFiles[0] ||
      RN_PROJECT_FILES[0]
    );
  }, [selectedFileId, filteredFiles]);

  const codeLines = useMemo(() => activeFile.content.split('\n'), [activeFile.content]);

  const handleCopy = async (file: ProjectFileEntry) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedId(file.id);
      setTimeout(() => setCopiedId((prev) => (prev === file.id ? null : prev)), 2000);
    } catch {
      // Fallback textarea copy
      const textarea = document.createElement('textarea');
      textarea.value = file.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(file.id);
      setTimeout(() => setCopiedId((prev) => (prev === file.id ? null : prev)), 2000);
    }
  };

  return (
    <div className="space-y-5">
      {/* شريط التصنيف والبحث */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[#131720] border border-[#1E2532]">
          {(['all', 'android', 'services', 'ui', 'cicd'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                category === cat
                  ? 'bg-[#1E2635] text-slate-100 border border-[#2D384D]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث في المسارات أو الدوال..."
            className="w-full min-h-[42px] pr-10 pl-3 rounded-xl bg-[#131720] border border-[#1E2532] text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* تخطيط مستعرض الملفات + محرر القراءة */}
      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-2xl bg-[#131720] border border-[#1E2532] overflow-hidden">
        {/* قائمة الملفات بالمسارات الدقيقة */}
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-l border-[#1E2532] flex flex-col max-h-[620px]">
          <div className="px-4 py-3 border-b border-[#1E2532] flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-2 font-medium text-slate-200">
              <FolderOpen className="w-4 h-4 text-sky-400" />
              هيكل مستودع GitHub
            </span>
            <span className="tabular-nums font-mono">{filteredFiles.length} ملف</span>
          </div>

          <div className="overflow-y-auto divide-y divide-[#1A202C]">
            {filteredFiles.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-sm text-slate-400">لا توجد ملفات مطابقة لعبارة البحث.</p>
                <button
                  type="button"
                  onClick={() => {
                    setCategory('all');
                    setSearchQuery('');
                  }}
                  className="text-xs font-semibold text-sky-400 hover:underline"
                >
                  إعادة ضبط التصفية
                </button>
              </div>
            ) : (
              filteredFiles.map((file) => {
                const isSelected = file.id === activeFile.id;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => onSelectFile(file.id)}
                    className={`w-full text-right px-4 py-3.5 transition-colors flex flex-col gap-1 ${
                      isSelected ? 'bg-[#1A2231]' : 'hover:bg-[#171C27]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          isSelected ? 'text-sky-400' : 'text-slate-200'
                        }`}
                      >
                        {file.titleAr}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 uppercase shrink-0">
                        {file.language}
                      </span>
                    </div>
                    <span
                      dir="ltr"
                      className="text-[11px] font-mono text-slate-400 truncate text-left w-full"
                    >
                      {file.path}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* نافذة عرض الكود بمسار الملف وزر النسخ */}
        <div className="lg:col-span-8 flex flex-col bg-[#0B0D11]">
          <div className="px-5 py-3.5 bg-[#131720] border-b border-[#1E2532] flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <FileCode2 className="w-4 h-4 text-sky-400 shrink-0" />
              <code
                dir="ltr"
                className="text-xs sm:text-sm font-mono font-medium text-slate-100 truncate"
              >
                {activeFile.path}
              </code>
            </div>

            <button
              type="button"
              onClick={() => handleCopy(activeFile)}
              className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
                copiedId === activeFile.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#1A202C] hover:bg-[#232B3A] border border-[#2A3446] text-slate-100'
              }`}
            >
              {copiedId === activeFile.id ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>تم النسخ</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>نسخ الملف</span>
                </>
              )}
            </button>
          </div>

          <div className="px-5 py-3 bg-[#10141C] border-b border-[#1E2532] text-xs text-slate-300 leading-relaxed">
            {activeFile.summaryAr}
          </div>

          <div
            dir="ltr"
            className="overflow-auto max-h-[510px] p-4 font-mono text-[12.5px] leading-6 text-slate-200"
          >
            <table className="w-full border-collapse">
              <tbody>
                {codeLines.map((line, index) => (
                  <tr key={index} className="hover:bg-[#131720]/70">
                    <td className="select-none pr-4 text-right text-slate-600 tabular-nums w-10 align-top">
                      {index + 1}
                    </td>
                    <td className="whitespace-pre text-slate-200 align-top">{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
