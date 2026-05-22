"use client";

import Link from "next/link";
import { GlassButton } from "@/components/ui/GlassButton";
import { useAuthStore } from "@/store/auth-store";
import { getPlugin } from "@/plugins/registry";

export default function GlassNav({ forumName, forumFid, showBack = true }: { forumName: string; forumFid: number; showBack?: boolean }) {
  const loggedIn = useAuthStore((s) => s.loggedIn);
  const plugin = getPlugin(forumFid);
  const requiresLogin = plugin?.requiresLogin || false;

  return (
    <nav className="sticky top-0 z-40 glass-nav">
      <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {showBack && (
            <Link href="/" className="shrink-0 no-underline">
              <GlassButton variant="ghost" size="sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </GlassButton>
            </Link>
          )}
          <div className="flex items-center gap-1.5 min-w-0">
            {requiresLogin && (
              <span className={`shrink-0 w-2 h-2 rounded-full ${loggedIn ? "bg-emerald-400" : "bg-amber-400"}`}
                title={loggedIn ? "已登录可访问" : "需要登录"} />
            )}
            <Link href={`/forum/${forumFid}`} className="no-underline min-w-0">
              <h1 className="text-[var(--text-primary)] font-semibold text-sm truncate hover:text-[var(--text-link)] transition-colors">{forumName}</h1>
            </Link>
            {requiresLogin && !loggedIn && (
              <span className="text-[10px] text-amber-600 shrink-0">需登录</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/" className="no-underline"><GlassButton variant="ghost" size="sm">板块</GlassButton></Link>
        </div>
      </div>
    </nav>
  );
}
