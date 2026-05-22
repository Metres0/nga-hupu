"use client";

import { useRef, useCallback } from "react";
import Link from "next/link";
import type { Thread } from "@/lib/types";
import { prefetchData, getCacheKey, getCachedData } from "@/lib/nga-cache";
import { isRead } from "@/lib/read-tracking";
import { useFavoriteStore } from "@/store/favorite-store";

interface ThreadListProps { threads: Thread[]; fid: number; }

const CARD_TINTS = ["var(--card-cream)", "var(--card-warm)", "var(--card-cream)", "var(--card-cool)"];

export function ThreadList({ threads, fid }: ThreadListProps) {
  const hoverTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const handleMouseEnter = useCallback((thread: Thread) => {
    if (thread.replyCount <= 0) return;
    const key = getCacheKey("thread", thread.tid);
    if (getCachedData(key)) return;
    hoverTimers.current.set(thread.tid, setTimeout(() => prefetchData(`/api/v1/threads/${thread.tid}?page=1`, key), 200));
  }, []);
  const handleMouseLeave = useCallback((tid: number) => {
    const t = hoverTimers.current.get(tid); if (t) { clearTimeout(t); hoverTimers.current.delete(tid); }
  }, []);

  if (threads.length === 0) {
    return (
      <div className="glass-card rounded-3xl text-center py-16">
        <div className="text-4xl mb-3 opacity-20">+</div>
        <p className="text-[var(--text-secondary)] text-sm">暂无帖子</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {threads.map((thread, idx) => {
        const read = isRead(thread.tid);
        const faved = useFavoriteStore.getState().isThreadFavorited(thread.tid);
        return (
          <div key={thread.tid} className="relative group/card card-enter">
            <Link href={`/forum/${fid}/thread/${thread.tid}`} data-tid={thread.tid}
              className="flex flex-col gap-2 px-5 py-4 rounded-3xl border border-[var(--border-subtle)] shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-[var(--duration-medium)] ease-standard no-underline block"
              style={{ backgroundColor: CARD_TINTS[idx % 4], "--index": idx } as React.CSSProperties}
              onMouseEnter={() => handleMouseEnter(thread)} onMouseLeave={() => handleMouseLeave(thread.tid)}>
              <div className="flex items-start gap-2 flex-wrap">
                {thread.sticky && <span className="shrink-0 text-label text-[var(--accent-red)] font-semibold bg-[rgba(198,40,40,0.08)] px-1.5 py-0.5 rounded-md">置顶</span>}
                {thread.digest && <span className="shrink-0 text-label text-[#b8860b] font-semibold bg-[rgba(184,134,11,0.08)] px-1.5 py-0.5 rounded-md">精华</span>}
                <span className={`text-sm font-semibold leading-snug ${read ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"}`}>
                  {thread.title}
                </span>
              </div>
              <div className="flex items-center justify-between mt-auto">
                <div className="flex items-center gap-3 text-label text-[var(--text-tertiary)]">
                  <Link href={`/user/${encodeURIComponent(thread.author)}`} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--text-secondary)] no-underline hover:text-[var(--text-link)]">{thread.author}</Link>
                  <span>{formatTime(thread.createTime)}</span>
                  {read && <span className="text-[var(--text-tertiary)]/50">已读</span>}
                </div>
                {thread.replyCount > 0 && (
                  <span className="text-xs font-semibold font-mono text-[var(--text-secondary)] tabular-nums">{thread.replyCount}<span className="text-[var(--text-tertiary)] font-normal ml-0.5">回复</span></span>
                )}
              </div>
            </Link>
            <button onClick={(e) => { e.preventDefault(); useFavoriteStore.getState().toggleThread({ tid: thread.tid, title: thread.title, fid: thread.fid, author: thread.author }); }}
              className={`absolute top-3 right-3 z-10 p-1 rounded-lg transition-all ${faved ? "text-red-400" : "text-[var(--text-tertiary)] hover:text-red-300"}`}
              title={faved ? "取消收藏" : "收藏帖子"}>
              <svg className="w-4 h-4" fill={faved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)}d`;
  return new Date(ts).toLocaleDateString("zh-CN");
}
