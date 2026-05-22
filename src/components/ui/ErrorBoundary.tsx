"use client";

import { Component, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error.message);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-[200px] flex items-center justify-center">
            <div className="text-center p-8 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
              <p className="text-red-300 text-lg mb-2">页面加载出错</p>
              <p className="text-white/40 text-sm mb-4">
                {this.state.error?.message || "未知错误"}
              </p>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 transition-all text-sm"
              >
                重试
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export function PostErrorFallback({ message }: { message?: string }) {
  return (
    <div className="p-4 rounded-xl bg-white/5 border border-red-400/20">
      <p className="text-red-300/60 text-sm">
        {message || "帖子内容加载失败"}
      </p>
    </div>
  );
}
