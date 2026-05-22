"use client";

export { ErrorBoundary, PostErrorFallback } from "@/components/ui/ErrorBoundary";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center px-4">
        <p className="text-[var(--accent-red)] text-lg mb-2">页面加载出错</p>
        <p className="text-[var(--text-secondary)] text-sm mb-6">{error.message || "未知错误"}</p>
        <button onClick={reset} className="px-5 py-2 rounded-md bg-[var(--surface-hover)] border border-[var(--border-default)] text-[var(--text-primary)] text-sm hover:bg-[var(--surface-active)] transition-colors">重试</button>
      </div>
    </div>
  );
}
