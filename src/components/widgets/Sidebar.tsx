"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { getPlugin } from "@/plugins/registry";
import UserMenu from "@/components/widgets/UserMenu";

export default function Sidebar() {
  const pathname = usePathname();
  const { subscriptions, toggleSubscribe } = useUiStore();
  const { loggedIn, username, loading, expiringSoon, expiresAt, initAuth, openLoginDialog } = useAuthStore();

  useEffect(() => { initAuth(); }, []);

  const subs = subscriptions.map((s) => ({
    fid: s.fid,
    name: getPlugin(s.fid)?.name || s.name,
    requiresLogin: getPlugin(s.fid)?.requiresLogin || false,
  }));

  const initials = username ? username.slice(0, 2).toUpperCase() : "?";
  const AVATAR_GRADIENTS = ["from-indigo-400 to-blue-500","from-emerald-400 to-teal-500","from-amber-400 to-orange-500","from-purple-400 to-pink-500"];
  const gradIdx = username ? Math.abs(username.split("").reduce((h, c) => h + c.charCodeAt(0), 0)) % 4 : 0;

  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000))) : null;

  return (
    <aside className="hidden md:flex flex-col w-54 shrink-0 glass-sidebar border-r border-[var(--glass-border)] min-h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-[var(--glass-border)]">
        <Link href="/" className="flex items-center gap-2.5 no-underline group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--md-primary)] via-[var(--md-secondary)] to-[var(--md-tertiary)] flex items-center justify-center text-white font-bold text-sm shadow-sm shadow-[var(--md-primary)]/20 group-hover:shadow-md transition-shadow">N</div>
          <span className="text-[var(--text-primary)] font-bold text-sm">NGA 镜像</span>
        </Link>
      </div>

      {!loading && (
        <div className="px-3 pt-2 pb-1 border-b border-[var(--glass-border)]">
          {loggedIn ? (
            <div>
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <div className="relative">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[gradIdx]} flex items-center justify-center text-xs font-bold text-white shadow-sm ring-2 ring-white/80 shrink-0`}>
                    {initials}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white" title="在线" />
                </div>
                <div className="min-w-0">
                  <span className="text-[var(--text-primary)] text-sm font-semibold truncate block">{username}</span>
                  {daysLeft !== null && !expiringSoon && (
                    <span className="text-[10px] text-[var(--text-tertiary)]">剩余 {daysLeft} 天</span>
                  )}
                  {expiringSoon && daysLeft !== null && (
                    <span className="text-[10px] text-amber-600 font-medium">即将过期 ({daysLeft}d)</span>
                  )}
                </div>
              </div>
              {expiringSoon && (
                <div className="px-2 mt-1">
                  <div className="h-1 bg-[var(--border-muted)] rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.max(5, ((expiresAt! - Date.now()) / (7 * 24 * 60 * 60 * 1000)) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <button onClick={openLoginDialog}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium bg-[var(--md-primary)] text-[var(--md-on-primary)] hover:shadow-elevated transition-all active:scale-[0.98] w-full">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>
                登录 NGA
              </button>
              <p className="text-[10px] text-[var(--text-tertiary)] px-3 mt-1.5 leading-relaxed">
                登录后可访问晴风村等板块
              </p>
            </div>
          )}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto">
        {loggedIn && <UserMenu />}
        <div className="px-3 pt-3 pb-1">
          <Link href="/"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm no-underline transition-all
              ${pathname === "/"
                ? "bg-[var(--md-primary-container)]/20 text-[var(--md-primary)] font-semibold ring-1 ring-[var(--md-primary)]/15"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={pathname === "/" ? 2 : 1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>
            </svg>
            首页
          </Link>
        </div>

        {subs.length > 0 ? (
          <div className="px-3 py-1">
            <div className="text-[var(--text-tertiary)] text-[11px] font-semibold uppercase tracking-wider px-2 pt-2 pb-1.5">我的订阅</div>
            <div className="space-y-0.5">
              {subs.map(({ fid, name, requiresLogin }) => {
                const active = pathname.startsWith(`/forum/${fid}`);
                const dotColor = ["var(--md-primary)","var(--md-secondary)","var(--accent-green)","var(--accent-orange)"][Math.abs(fid) % 4];
                const locked = requiresLogin && !loggedIn;
                return (
                  <div key={fid} className={`flex items-center group/item rounded-xl transition-all ${active ? "bg-[var(--md-primary-container)]/20 ring-1 ring-[var(--md-primary)]/15" : locked ? "opacity-50" : "hover:bg-[var(--surface-hover)]"}`}>
                    <Link href={locked ? "#" : `/forum/${fid}`}
                      onClick={locked ? ((e) => { e.preventDefault(); openLoginDialog(); }) : undefined}
                      className={`flex-1 flex items-center gap-2 px-2.5 py-2 text-sm no-underline ${active ? "text-[var(--md-primary)] font-semibold" : "text-[var(--text-secondary)]"}`}>
                      <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: dotColor }} />
                      <span className="truncate">{name}</span>
                      {locked && <span className="text-[10px]" title="需要登录">🔒</span>}
                      {requiresLogin && loggedIn && <span className="text-[10px] text-emerald-500" title="已登录可访问">✓</span>}
                    </Link>
                    <button onClick={() => toggleSubscribe(fid)}
                      className="shrink-0 px-1.5 py-1.5 text-[var(--text-tertiary)] hover:text-[var(--md-error)] transition-colors opacity-0 group-hover/item:opacity-100 rounded-r-lg" title="取消订阅">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="px-3 py-3">
            <div className="text-[var(--text-tertiary)] text-[11px] font-semibold uppercase tracking-wider px-2 pb-1.5">我的订阅</div>
            <p className="text-[var(--text-tertiary)] text-xs px-2 leading-relaxed">暂无订阅<br/>去首页发现板块</p>
          </div>
        )}

        <div className="px-3 pt-2 pb-1">
          <div className="text-[var(--text-tertiary)] text-[11px] font-semibold uppercase tracking-wider px-2 pt-2 pb-1.5">探索</div>
          <Link href="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm no-underline text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/>
            </svg>
            全部板块
          </Link>
        </div>
      </nav>

      <div className="px-2.5 py-3 border-t border-[var(--glass-border)]">
        <a href="https://github.com/Metres0/nga-hupu" target="_blank" rel="noopener"
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] no-underline hover:bg-[var(--surface-hover)] transition-all">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          GitHub
        </a>
      </div>
    </aside>
  );
}
