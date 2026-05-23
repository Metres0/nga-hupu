"use client";

import { useAuthStore } from "@/store/auth-store";

export default function UserMenu() {
  const { username, setLoggedOut, expiresAt, expiringSoon, hasCredential } = useAuthStore();

  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000))) : null;
  const pctLeft = expiresAt ? Math.max(0, Math.min(100, ((expiresAt - Date.now()) / (7 * 24 * 60 * 60 * 1000)) * 100)) : 100;

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    setLoggedOut();
  }

  async function handleRenew() {
    try {
      const resp = await fetch("/api/v1/auth/renew", { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        location.reload();
      }
    } catch {}
  }

  return (
    <div className="px-3 py-1">
      <div className="text-[var(--text-tertiary)] text-[11px] font-semibold uppercase tracking-wider px-2 pt-2 pb-1.5">
        {username}
      </div>
      {daysLeft !== null && (
        <div className="px-2 mb-2">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className={expiringSoon ? "text-amber-600 font-medium" : "text-[var(--text-tertiary)]"}>
              Session 剩余 {daysLeft} 天
            </span>
            {hasCredential && <span className="text-emerald-600">可自动续期</span>}
          </div>
          <div className="h-1 bg-[var(--border-muted)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${expiringSoon ? "bg-amber-400" : pctLeft > 50 ? "bg-emerald-400" : "bg-amber-400"}`}
              style={{ width: `${pctLeft}%` }}
            />
          </div>
        </div>
      )}
      <div className="space-y-0.5">
        <a href="#" className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm no-underline text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
          个人中心
        </a>
        <a href="#" className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm no-underline text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>
          我的收藏
        </a>
        <a href="#" className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm no-underline text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg>
          通知
        </a>
        {expiringSoon && hasCredential && (
          <button onClick={handleRenew}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-emerald-600 hover:bg-[var(--surface-hover)] transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/></svg>
            手动续期
          </button>
        )}
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-tertiary)] hover:text-[var(--md-error)] hover:bg-[var(--surface-hover)] transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>
          退出登录
        </button>
      </div>
    </div>
  );
}
