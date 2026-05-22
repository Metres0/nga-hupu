"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import PostCard from "@/components/widgets/PostCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import GlassNav from "@/components/widgets/GlassNav";
import { GlassSkeletonList } from "@/components/ui/GlassSkeleton";
import { buildReplyTree, flattenTree } from "@/lib/reply-tree";
import { getCacheKey } from "@/lib/nga-cache";
import { useCacheStore } from "@/store/cache-store";
import { useThreadStore } from "@/store/thread-store";
import { useScrollRestore } from "@/lib/scroll-restore";
import { markAsRead } from "@/lib/read-tracking";

export default function ThreadPageClient() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tid = parseInt(params.tid as string);
  const fid = parseInt(params.fid as string);
  const currentPage = parseInt(searchParams.get("page") || "1");
  const store = useThreadStore();
  const loadedRef = useRef<string>("");

  useScrollRestore(`thread:${tid}:${currentPage}`);
  useEffect(() => { markAsRead(tid); }, [tid]);
  useEffect(() => { return () => { useCacheStore.getState().evictByPrefix("thread"); }; }, [tid]);

  useEffect(() => {
    const loadKey = `${tid}:${currentPage}`;
    if (loadedRef.current === loadKey) return;
    loadedRef.current = loadKey;
    const cacheKey = getCacheKey("thread", tid, currentPage);
    const cacheApi = useCacheStore.getState();
    const cached = cacheApi.get<any>(cacheKey);
    if (cached) {
      store.setThread(cached.data.thread || { tid, fid } as any);
      store.setPosts(cached.data.posts || []);
      store.setTotalPages(cached.data.totalPages || 1);
      store.setLoading(false); store.setPageLoading(false);
      return;
    }
    if (currentPage !== 1) store.setPageLoading(true);
    else store.setLoading(true);
    store.setError(null);
    fetch(`/api/v1/threads/${tid}?page=${currentPage}`)
      .then((res) => { if (!res.ok) throw new Error("加载失败"); return res.json(); })
      .then((json) => {
        if (json.error) throw new Error(json.error);
        cacheApi.set(cacheKey, json);
        const ta = useThreadStore.getState();
        ta.setThread(json.thread || { tid, fid } as any);
        ta.setPosts(json.posts || []); ta.setTotalPages(json.totalPages || 1);
        ta.setLoading(false); ta.setPageLoading(false);
      })
      .catch((err) => {
        useThreadStore.getState().setError(err.message || "加载失败");
        useThreadStore.getState().setLoading(false);
        useThreadStore.getState().setPageLoading(false);
      });
  }, [tid, fid, currentPage]);

  function retryFetch() {
    const ta = useThreadStore.getState();
    ta.setError(null); ta.setLoading(true);
    const cacheKey = getCacheKey("thread", tid, currentPage);
    fetch(`/api/v1/threads/${tid}?page=${currentPage}`)
      .then((res) => { if (!res.ok) throw new Error("加载失败"); return res.json(); })
      .then((json) => {
        if (json.error) throw new Error(json.error);
        useCacheStore.getState().set(cacheKey, json);
        const ta = useThreadStore.getState();
        ta.setThread(json.thread || { tid, fid } as any);
        ta.setPosts(json.posts || []); ta.setTotalPages(json.totalPages || 1);
        ta.setLoading(false);
      })
      .catch((err) => { useThreadStore.getState().setError(err.message); useThreadStore.getState().setLoading(false); });
  }

  function goPage(p: number) {
    if (p < 1 || p > store.totalPages) return;
    const sp = new URLSearchParams(searchParams.toString());
    if (p === 1) sp.delete("page"); else sp.set("page", String(p));
    router.push(`${pathname}?${sp.toString()}`);
  }

  if (store.error && store.posts.length === 0) {
    return (
      <div>
        <GlassNav forumName={`帖子 #${tid}`} forumFid={fid} showBack />
        <div className="max-w-5xl mx-auto px-4 py-16 text-center">
          <p className="text-[var(--accent-red)] mb-4">{store.error}</p>
          <div className="flex justify-center gap-3">
            <GlassButton variant="primary" onClick={retryFetch}>重试</GlassButton>
            <Link href={`/forum/${fid}`} className="no-underline"><GlassButton variant="secondary">返回板块</GlassButton></Link>
          </div>
        </div>
      </div>
    );
  }

  const treeNodes = buildReplyTree(store.posts);
  const flatNodes = flattenTree(treeNodes);
  const [filter, setFilter] = useState("");

  const filtered = filter.trim()
    ? flatNodes.filter((n) =>
        n.post.author.includes(filter) ||
        n.post.content.includes(filter) ||
        String(n.post.floor).includes(filter)
      )
    : flatNodes;

  return (
    <div>
      <GlassNav forumName={store.thread?.title || `帖子 #${tid}`} forumFid={fid} showBack />
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2">
        <div className="flex-1 relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索作者/内容/楼层..."
            className="glass-input w-full pl-8 pr-3 py-1.5 rounded-lg text-xs" />
        </div>
        <button onClick={retryFetch} className="shrink-0 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] glass-card px-2.5 py-1.5 rounded-lg transition-colors" title="刷新">
          ↻
        </button>
        {store.lastRefresh && (
          <span className="text-[10px] text-[var(--text-tertiary)]">{Math.floor((Date.now() - store.lastRefresh) / 60000)}m前</span>
        )}
      </div>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {store.thread?.title && (
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{store.thread.title}</h1>
            <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
              <span>{store.thread.author}</span>
              <span>{store.thread.replyCount} 回复</span>
              {store.totalPages > 1 && <span>{currentPage}/{store.totalPages} 页</span>}
              {store.thread.sticky && <GlassBadge variant="sticky">置顶</GlassBadge>}
              {store.thread.digest && <GlassBadge variant="digest">精华</GlassBadge>}
            </div>
          </div>
        )}

        {store.pageLoading && (
          <div className="mb-3 h-0.5 bg-[var(--border-muted)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--accent-blue)] animate-pulse" style={{ width: "60%" }} />
          </div>
        )}

        {store.loading ? <GlassSkeletonList count={8} />
        : store.error ? (
          <div className="text-center py-16">
            <p className="text-[var(--accent-red)] mb-4">{store.error}</p>
            <GlassButton variant="primary" onClick={retryFetch}>重试</GlassButton>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-tertiary)]">{filter ? "无匹配内容" : "暂无回复"}</div>
        ) : (
          <div className="space-y-3">
            {filter.match(/^\d+$/) ? filtered.map(({ post }) => (
              <PostCard key={post.pid} post={post} isFirst={post.floor === 0} allPosts={store.posts} depth={0} />
            )) : filtered.map(({ post, depth }) => (
              <PostCard key={post.pid} post={post} isFirst={post.floor === 0 && depth === 0} allPosts={store.posts} depth={depth} />
            ))}
          </div>
        )}

        {store.totalPages > 1 && !store.loading && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <GlassButton variant="secondary" size="sm" disabled={currentPage <= 1} onClick={() => goPage(currentPage - 1)}>上一页</GlassButton>
            {Array.from({ length: Math.min(store.totalPages, 7) }, (_, i) => {
              let p: number;
              if (store.totalPages <= 7) p = i + 1;
              else if (currentPage <= 4) p = i + 1;
              else if (currentPage >= store.totalPages - 3) p = store.totalPages - 6 + i;
              else p = currentPage - 3 + i;
              return (
                <button key={p} onClick={() => goPage(p)}
                  className={`w-7 h-7 rounded-md text-xs font-medium border transition-colors
                    ${p === currentPage
                      ? "bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white"
                      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
                  {p}
                </button>
              );
            })}
            <GlassButton variant="secondary" size="sm" disabled={currentPage >= store.totalPages} onClick={() => goPage(currentPage + 1)}>下一页</GlassButton>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href={`/forum/${fid}`} className="no-underline"><GlassButton variant="ghost" size="sm">返回板块</GlassButton></Link>
        </div>
      </div>
    </div>
  );
}
