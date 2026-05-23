"use client";

import { ReactNode } from "react";
import { useAuthStore } from "@/store/auth-store";
import { GlassSkeleton } from "@/components/ui/GlassSkeleton";

interface AuthGateProps {
  children?: ReactNode;
  forumName?: string;
  fid?: number;
}

export default function AuthGate({ children, forumName, fid }: AuthGateProps) {
  const { loggedIn, loading, openLoginDialog } = useAuthStore();

  if (loading) return <GlassSkeleton className="h-48 rounded-2xl" />;

  if (!loggedIn) {
    const source = forumName || (fid ? `板块 ${fid}` : null);
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <div className="text-5xl mb-4 opacity-40">🔒</div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">此内容需要登录</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-6 text-center max-w-xs">
          {source ? `"${source}" 需要登录 NGA 账号后才能访问` : "请先登录 NGA 账号查看此内容"}
        </p>
        <button onClick={openLoginDialog}
          className="px-6 py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-sm font-semibold hover:shadow-elevated transition-all active:scale-[0.98]">
          去登录 NGA
        </button>
        <p className="text-xs text-[var(--text-tertiary)] mt-4">登录后可解锁 晴风村 等受限板块</p>
      </div>
    );
  }

  return <>{children}</>;
}
