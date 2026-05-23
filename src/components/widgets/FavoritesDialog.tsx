"use client";

import Link from "next/link";
import { useFavoriteStore } from "@/store/favorite-store";

export default function FavoritesDialog({ onClose }: { onClose: () => void }) {
  const { threads, posts, removeThread, removePost, threadCount, postCount } = useFavoriteStore();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md mx-4 max-h-[80vh] glass-card-elevated rounded-3xl p-5 shadow-modal overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="text-title text-[var(--text-primary)]">★ 我的收藏</h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-lg px-1">✕</button>
        </div>

        <div className="flex gap-1 mb-3 shrink-0">
          <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">帖子 {threadCount()}</span>
          <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">回复 {postCount()}</span>
        </div>

        <div className="overflow-y-auto flex-1 space-y-0.5">
          {threads.length === 0 && posts.length === 0 && (
            <p className="text-sm text-[var(--text-tertiary)] text-center py-8">还没有收藏内容<br/>在帖子或回复上悬停点击 ☆ 即可收藏</p>
          )}

          {threads.map((t) => (
            <div key={t.tid} className="flex items-center group/item rounded-xl hover:bg-[var(--surface-hover)] transition-all">
              <Link href={`/forum/${t.fid}/thread/${t.tid}`} onClick={onClose}
                className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-sm no-underline text-[var(--text-secondary)] min-w-0">
                <span className="text-amber-400 shrink-0">★</span>
                <span className="truncate">{t.title}</span>
                <span className="text-[var(--text-tertiary)] text-xs shrink-0">{t.author}</span>
              </Link>
              <button onClick={() => removeThread(t.tid)}
                className="shrink-0 px-2 py-2 text-[var(--text-tertiary)] hover:text-[var(--md-error)] transition-colors opacity-0 group-hover/item:opacity-100 rounded-r-lg"
                title="取消收藏">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          ))}

          {posts.map((p) => (
            <div key={p.pid} className="flex items-center group/item rounded-xl hover:bg-[var(--surface-hover)] transition-all">
              <Link href={`/forum/thread/${p.tid}`} onClick={onClose}
                className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-sm no-underline text-[var(--text-secondary)] min-w-0">
                <span className="text-purple-400 shrink-0 text-xs">◆</span>
                <span className="truncate">{p.content.substring(0, 60)}</span>
                <span className="text-[var(--text-tertiary)] text-xs shrink-0">{p.author}</span>
              </Link>
              <button onClick={() => removePost(p.pid)}
                className="shrink-0 px-2 py-2 text-[var(--text-tertiary)] hover:text-[var(--md-error)] transition-colors opacity-0 group-hover/item:opacity-100 rounded-r-lg"
                title="取消收藏">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
