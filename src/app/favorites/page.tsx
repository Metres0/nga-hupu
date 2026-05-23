"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useFavoriteStore } from "@/store/favorite-store";
import { GlassSkeleton } from "@/components/ui/GlassSkeleton";

export default function FavoritesPage() {
  const { threads, posts, removeThread, removePost, threadCount, postCount, loadFromStorage } = useFavoriteStore();

  useEffect(() => { loadFromStorage(); }, []);

  return (
    <div className="max-w-2xl mx-auto px-5 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] no-underline text-sm">← 返回首页</Link>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">★ 我的收藏</h1>
      </div>

      <div className="flex gap-2 mb-6">
        <span className="text-xs px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 font-medium">帖子 {threadCount()}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-purple-100 text-purple-700 font-medium">回复 {postCount()}</span>
      </div>

      {threads.length === 0 && posts.length === 0 && (
        <div className="glass-card rounded-3xl text-center py-16">
          <div className="text-4xl mb-3 opacity-20">☆</div>
          <p className="text-[var(--text-secondary)] text-sm">还没有收藏内容</p>
          <p className="text-[var(--text-tertiary)] text-xs mt-2 leading-relaxed">浏览论坛时悬停在帖子上<br/>点击右上角 ☆ 即可收藏</p>
        </div>
      )}

      {threads.length > 0 && (
        <div className="mb-8">
          <div className="text-[var(--text-tertiary)] text-[11px] font-semibold uppercase tracking-wider px-2 pb-2">收藏的帖子</div>
          <div className="space-y-1.5">
            {threads.map((t) => (
              <div key={t.tid} className="flex items-center group/item rounded-2xl hover:bg-[var(--surface-hover)] transition-all glass-card px-4 py-3">
                <Link href={`https://bbs.nga.cn/read.php?tid=${t.tid}`} target="_blank" rel="noopener"
                  className="flex-1 flex items-center gap-3 text-sm no-underline text-[var(--text-secondary)] min-w-0">
                  <span className="text-amber-400 shrink-0">★</span>
                  <span className="truncate">{t.title}</span>
                </Link>
                <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] shrink-0 ml-3">
                  <Link href={`/forum/${t.fid}`} className="no-underline hover:text-[var(--text-link)]">{t.author}</Link>
                  <button onClick={() => removeThread(t.tid)}
                    className="text-[var(--text-tertiary)] hover:text-[var(--md-error)] transition-all px-1.5 py-1.5 rounded-lg hover:bg-[var(--surface-active)]"
                    title="取消收藏">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {posts.length > 0 && (
        <div>
          <div className="text-[var(--text-tertiary)] text-[11px] font-semibold uppercase tracking-wider px-2 pb-2">收藏的回复</div>
          <div className="space-y-1.5">
            {posts.map((p) => (
              <div key={p.pid} className="flex items-center group/item rounded-2xl hover:bg-[var(--surface-hover)] transition-all glass-card px-4 py-3">
                <Link href={`https://bbs.nga.cn/read.php?tid=${p.tid}&pid=${p.pid}`} target="_blank" rel="noopener"
                  className="flex-1 flex items-center gap-3 text-sm no-underline text-[var(--text-secondary)] min-w-0">
                  <span className="text-purple-400 shrink-0 text-xs">◆</span>
                  <span className="truncate">{p.content.substring(0, 80)}</span>
                </Link>
                <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] shrink-0 ml-3">
                  <span>{p.author}</span>
                  <button onClick={() => removePost(p.pid)}
                    className="text-[var(--text-tertiary)] hover:text-[var(--md-error)] transition-all px-1.5 py-1.5 rounded-lg hover:bg-[var(--surface-active)]"
                    title="取消收藏">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
