import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import MobileRemoteApp from '../App.js';

interface PreviewBoundaryState {
  errorMessage: string | null;
}

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  PreviewBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): PreviewBoundaryState {
    return { errorMessage: error?.message || 'حدث خطأ أثناء عرض الواجهة.' };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    if (this.state.errorMessage) {
      return (
        <div
          dir="rtl"
          className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-[#0B0D11] text-slate-200 gap-3"
        >
          <p className="text-sm font-bold text-amber-400">تعذر عرض المعاينة</p>
          <p className="text-xs text-slate-400 font-mono">{this.state.errorMessage}</p>
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
      className="min-h-screen bg-[#07090D] text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6"
    >
      <div className="w-full max-w-[400px] h-[820px] max-h-[92vh] rounded-[42px] bg-[#0B0D11] border-[6px] border-[#1F2735] shadow-2xl overflow-hidden flex flex-col relative">
        <PreviewErrorBoundary>
          <MobileRemoteApp />
        </PreviewErrorBoundary>
      </div>
    </div>
  );
}
