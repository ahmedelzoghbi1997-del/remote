import React from 'react';
import NativeRemoteApp from '../App.js';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'حدث خطأ أثناء معاينة الواجهة',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="h-full w-full bg-[#0B0D11] text-slate-100 flex flex-col items-center justify-center p-6 text-center gap-3"
        >
          <p className="text-sm font-bold text-amber-400">تعذر عرض المعاينة</p>
          <p className="text-xs text-slate-400 font-mono break-all">
            {this.state.errorMessage}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[#07090D] text-slate-100 flex flex-col items-center justify-center p-3 sm:p-6"
    >
      <div className="w-full max-w-[400px] h-[780px] max-h-[92vh] rounded-[36px] border-[3px] border-[#1E2532] bg-[#0B0D11] shadow-2xl overflow-hidden flex flex-col">
        <PreviewErrorBoundary>
          <NativeRemoteApp />
        </PreviewErrorBoundary>
      </div>
    </div>
  );
}
