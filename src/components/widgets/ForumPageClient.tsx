"use client";

import Link from "next/link";
import { useEffect, useRef, useCallback, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ThreadList } from "@/components/widgets/ThreadList";
import { GlassSkeletonList } from "@/components/ui/GlassSkeleton";
import { GlassButton } from "@/components/ui/GlassButton";
import GlassNav from "@/components/widgets/GlassNav";
import AuthGate from "@/components/widgets/AuthGate";
import { getPlugin } from "@/plugins/registry";
import { useCacheStore, getCacheKey } from "@/store/cache-store";
import { useForumStore } from "@/store/forum-store";
import { useAuthStore } from "@/store/auth-store";
import { useScrollRestore } from "@/lib/scroll-restore";
import { usePullToRefresh } from "@/lib/pull-to-refresh";
import type { Thread } from "@/lib/types";

interface ForumPageProps {
  fid: number;
  initialThreads?: any[] | null;
  initialMeta?: { totalPages: number; forumName: string };
}

export default function ForumPageClient({ fid: propFid, initialThreads, initialMeta }: ForumPageProps) {
  const params = useParams(); const searchParams = useSearchParams();
  const fid = propFid || parseInt(params.fid as string); const currentPage = parseInt(searchParams.get("page") || "1");
  const store = useForumStore(); const plugin = getPlugin(fid);
  const loadedRef = useRef(""); const prefetchedRef = useRef(new Set<string>());
  const openLoginDialog = useAuthStore((s) => s.openLoginDialog);
  const [authError, setAuthError] = useState(false);
  const [ssrUsed, setSsrUsed] = useState(false);
  useScrollRestore(`forum:${fid}`);

  const refreshPage = useCallback(async () => {
    const fa = useForumStore.getState();
    fa.setPageLoading(true);
    const resp = await fetch(`/api/v1/forums/${fid}?page=${currentPage}&refresh=1`);
    if (!resp.ok) throw new Error("刷新失败");
    const json = await resp.json();
    const key = getCacheKey("forum", fid, currentPage);
    useCacheStore.getState().set(key, json);
    fa.setThreads(json.data || []);
    fa.setTotalPages(json.totalPages || 1);
    fa.setCached(json.cached || false);
    fa.setPageLoading(false);
  }, [fid, currentPage]);

  const { containerRef, pulling, refreshing } = usePullToRefresh({ onRefresh: refreshPage });

  // SSR initial data injection — avoids loading spinner on first render
  useEffect(() => {
    if (initialThreads && !ssrUsed && currentPage === 1) {
      setSsrUsed(true);
      const fa = useForumStore.getState();
      fa.setThreads(initialThreads);
      fa.setTotalPages(initialMeta?.totalPages || 1);
      fa.setForumName(initialMeta?.forumName || "");
      fa.setFid(fid);
      fa.setLoading(false);
      fa.setCached(true);
      // Also write to cache-store so subsequent navigations hit L1
      const cacheKey = getCacheKey("forum", fid, currentPage);
      useCacheStore.getState().set(cacheKey, {
        data: initialThreads,
        totalPages: initialMeta?.totalPages || 1,
        hasMore: (initialMeta?.totalPages || 1) > 1,
        forum: { name: initialMeta?.forumName || "" },
        cached: true,
      });
    }
  }, [initialThreads, ssrUsed, currentPage, fid, initialMeta]);

  useEffect(() => {
    const loadKey = `${fid}:${currentPage}`; if (loadedRef.current === loadKey) return; loadedRef.current = loadKey;
    const fa = useForumStore.getState(); fa.setFid(fid); setAuthError(false);
    const cacheKey = getCacheKey("forum", fid, currentPage);
    const ca = useCacheStore.getState(); const cached = ca.get<any>(cacheKey);
    if (cached) {
      // Use cached data immediately
      fa.setThreads(cached.data.data || cached.data || []);
      fa.setTotalPages(cached.data.totalPages || 1);
      fa.setHasMore(cached.data.hasMore || false);
      fa.setForumName(cached.data.forum?.name || "");
      fa.setCached(cached.data.cached || false);
      fa.setLoading(false); fa.setPageLoading(false);
      // If stale, trigger background refresh (SWR pattern)
      if (cached.stale) {
        ca.prefetch(`/api/v1/forums/${fid}?page=${currentPage}`, cacheKey);
      }
      return;
    }
    if (currentPage === 1) fa.setLoading(true); else fa.setPageLoading(true); fa.setError(null);
    fetch(`/api/v1/forums/${fid}?page=${currentPage}`)
      .then((res) => {
        if (res.status === 403 || res.status === 401) { setAuthError(true); throw new Error("需要登录"); }
        if (!res.ok) throw new Error("加载失败");
        return res.json();
      })
      .then((json) => {
        ca.set(cacheKey, json); const fa = useForumStore.getState();
        fa.setThreads(json.data || []); fa.setTotalPages(json.totalPages || 1);
        fa.setHasMore(json.hasMore || false); fa.setForumName(json.forum?.name || "");
        fa.setCached(json.cached || false); fa.setLoading(false); fa.setPageLoading(false);
      }).catch((err) => {
        if (!authError) { const fa = useForumStore.getState(); fa.setError(err.message); fa.setLoading(false); fa.setPageLoading(false); }
      });
  }, [fid, currentPage]);

  useEffect(() => {
    const threads = useForumStore.getState().threads; if (!threads || threads.length === 0) return;
    const ca = useCacheStore.getState(); const top = threads.filter((t: Thread) => t.replyCount > 0).slice(0, 10);
    for (const t of top) { const key = getCacheKey("thread", t.tid); if (prefetchedRef.current.has(key)) continue; prefetchedRef.current.add(key); if (!ca.get(key)?.data) ca.prefetch(`/api/v1/threads/${t.tid}?page=1`, key); }
  }, [store.threads, currentPage]);

  useEffect(() => {
    return () => { useCacheStore.getState().evictByPrefix(`forum:${fid}`); };
  }, [fid]);

  const requiresLogin = plugin?.requiresLogin || false;

  if (requiresLogin) {
    return (
      <AuthGate forumName={plugin?.name}>
        <ForumContent fid={fid} currentPage={currentPage} store={store} plugin={plugin}
          containerRef={containerRef} pulling={pulling} refreshing={refreshing}
          authError={authError} openLoginDialog={openLoginDialog} onRefresh={refreshPage} />
      </AuthGate>
    );
  }

  return (
    <ForumContent fid={fid} currentPage={currentPage} store={store} plugin={plugin}
      containerRef={containerRef} pulling={pulling} refreshing={refreshing}
      authError={authError} openLoginDialog={openLoginDialog} onRefresh={refreshPage} />
  );
}

function ForumContent({ fid, currentPage, store, plugin, containerRef, pulling, refreshing, authError, openLoginDialog, onRefresh }: any) {
  const filtered = !plugin || plugin.categories.length <= 1 || store.activeCategory === "all"
    ? store.threads
    : store.threads.filter((t: any) => { const cat = plugin.categories.find((c: any) => c.id === store.activeCategory); return cat ? (t.title.includes(`[${cat.name}]`) || t.categories?.includes(cat.name)) : true; });

  const sorted = [...filtered].sort((a: any, b: any) => {
    const dir = store.sortAsc ? 1 : -1;
    if (store.sortBy === "replyCount") return (b.replyCount - a.replyCount) * dir;
    if (store.sortBy === "createTime") return (b.createTime - a.createTime) * dir;
    return (b.lastReplyTime - a.lastReplyTime) * dir;
  });

  return (
    <div ref={containerRef}>
      {(pulling || refreshing) && (
        <div className="flex justify-center py-3 text-xs text-[var(--text-tertiary)]">
          {refreshing ? "刷新中..." : "下拉刷新"}
        </div>
      )}
      <GlassNav forumName={plugin?.name || store.forumName || `板块 ${fid}`} forumFid={fid} showBack={true} />
      {!authError && !store.loading && (
        <div className="px-4 py-2 flex items-center gap-2">
          <Link href={`/search?fid=${fid}`} className="shrink-0 flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] glass-card px-2.5 py-1.5 rounded-lg no-underline transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            搜索
          </Link>
          <SortBar fid={fid} />
          <button onClick={() => onRefresh()} className="shrink-0 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] glass-card px-2 py-1 rounded-lg transition-colors ml-auto" title="刷新论坛列表">
            ↻ 刷新
          </button>
        </div>
      )}
      {authError && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <span className="text-3xl mb-3">🚫</span>
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            {plugin?.requiresLogin ? "此板块需要登录后才能访问" : "登录已过期，需要重新登录"}
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mb-4">{"请登录 NGA 账号后查看此内容"}</p>
          <button onClick={openLoginDialog}
            className="px-5 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-sm font-semibold hover:shadow-elevated transition-all active:scale-[0.98]">
            立即登录
          </button>
        </div>
      )}
      {!authError && store.loading && <GlassSkeletonList count={8} />}
      {!authError && store.error && !store.loading && (
        <div className="text-center py-16 glass-card rounded-2xl mx-4 mt-4">
          <p className="text-[var(--md-error)] text-sm mb-4">{store.error}</p>
          <GlassButton variant="secondary" onClick={() => window.location.reload()}>重试</GlassButton>
        </div>
      )}
      {!authError && !store.loading && !store.error && (
        <>
          {plugin && plugin.categories.length > 1 && (
            <div className="px-4 py-2 flex gap-2 overflow-x-auto">
              {plugin.categories.map((cat: { id: string; name: string }) => (
                <button key={cat.id} onClick={() => useForumStore.getState().setActiveCategory(cat.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs transition-all ${store.activeCategory === cat.id ? "bg-[var(--md-primary)] text-[var(--md-on-primary)]" : "glass-card text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
                  {cat.name}
                </button>
              ))}
            </div>
          )}
          <ThreadList threads={sorted} fid={fid} />
          {store.hasMore && (
            <div className="flex justify-center py-4">
              <Link href={`/forum/${fid}?page=${currentPage + 1}`} className="no-underline">
                <GlassButton variant="secondary" size="sm">下一页</GlassButton>
              </Link>
            </div>
          )}
          {store.pageLoading && <div className="text-center text-xs text-[var(--text-tertiary)] py-3">加载中...</div>}
        </>
      )}
    </div>
  );
}

function SortBar({ fid }: { fid: number }) {
  const { sortBy, sortAsc, setSortBy, toggleSortOrder } = useForumStore();
  const options = [
    { value: "lastReply" as const, label: "最新回复" },
    { value: "createTime" as const, label: "最新发帖" },
    { value: "replyCount" as const, label: "最多回复" },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map((o) => (
        <button key={o.value} onClick={() => { if (sortBy === o.value) toggleSortOrder(); else setSortBy(o.value); }}
          className={`px-2.5 py-1 rounded-full text-xs transition-all ${sortBy === o.value ? "bg-[var(--md-primary)] text-[var(--md-on-primary)]" : "glass-card text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
          {o.label}
          {sortBy === o.value && (sortAsc ? " ↑" : " ↓")}
        </button>
      ))}
    </div>
  );
}
