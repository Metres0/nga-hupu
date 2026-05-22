"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import type { Post } from "@/lib/types";
import { useFavoriteStore } from "@/store/favorite-store";

const ImageGallery = dynamic(() => import("./ImageGallery"), { ssr: true });
const ChunkedPostRenderer = dynamic(() => import("./ChunkedPostRenderer"), { ssr: true });

const AVATAR_GRADIENTS = [
  "from-indigo-400 to-blue-500", "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500", "from-purple-400 to-pink-500",
  "from-rose-400 to-red-500", "from-cyan-400 to-sky-500",
  "from-violet-400 to-purple-500", "from-lime-400 to-green-500",
];
const DEPTH_CARD_COLORS = [
  "var(--card-cream)",
  "var(--card-plum)",
  "var(--card-slate)",
  "var(--card-mint)",
  "var(--card-peach)",
];

interface PostCardProps { post: Post; isFirst?: boolean; allPosts?: Post[]; depth?: number; }

function avatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function PostHeader({ post }: { post: Post }) {
  const initials = post.author.replace(/^UID:/, "").slice(0, 2).toUpperCase();
  const grad = avatarGradient(post.author);
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-xs font-bold text-white/90 shadow-sm shrink-0 select-none ring-2 ring-white/80`}>
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/user/${encodeURIComponent(post.author)}`} className="text-[var(--text-primary)] font-semibold text-sm no-underline hover:text-[var(--text-link)]">{post.author}</Link>
          <span className="text-[var(--text-tertiary)] text-xs">#{post.floor}</span>
        </div>
        <div className="flex items-center gap-2.5 mt-0.5 text-xs text-[var(--text-tertiary)]">
          <span>{formatRelativeTime(post.createTime)}</span>
          {post.likes > 0 && (
            <span className="flex items-center gap-1 text-[var(--accent-red)]">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"/></svg>
              {post.likes}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyPreview({ target, allPosts }: { target: number; allPosts: Post[] }) {
  const replyTarget = allPosts.find((p) => p.floor === target);
  if (!replyTarget) return null;
  return (
    <div className="mb-3 p-3 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)]">
      <div className="flex items-center gap-1.5 mb-1">
        <svg className="w-3.5 h-3.5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
        </svg>
        <span className="text-[var(--text-link)] text-xs font-semibold">{replyTarget.author}</span>
        <span className="text-[var(--text-tertiary)] text-xs">#{replyTarget.floor}</span>
      </div>
      <div className="text-[var(--text-secondary)] text-xs leading-relaxed line-clamp-2">{replyTarget.content?.substring(0, 140) || "(无内容)"}</div>
    </div>
  );
}

function PostBody({ post }: { post: Post }) {
  return (
    <div className={`text-[var(--text-primary)] text-sm leading-relaxed
      [&_.bb-quote]:border-l-[3px] [&_.bb-quote]:border-[var(--accent-blue)]/50 [&_.bb-quote]:pl-3.5 [&_.bb-quote]:py-2 [&_.bb-quote]:my-3 [&_.bb-quote]:text-[var(--text-secondary)] [&_.bb-quote]:bg-[var(--surface-hover)] [&_.bb-quote]:rounded-r-xl [&_.bb-quote]:text-[13px]
      [&_.bb-quote-header]:text-xs [&_.bb-quote-header]:text-[var(--accent-blue)] [&_.bb-quote-header]:font-semibold [&_.bb-quote-header]:block
      [&_.bb-code]:bg-[var(--bg-tertiary)] [&_.bb-code]:rounded-xl [&_.bb-code]:p-3.5 [&_.bb-code]:overflow-x-auto [&_.bb-code]:my-3 [&_.bb-code]:text-[var(--text-secondary)] [&_.bb-code]:text-[13px] [&_.bb-code]:font-mono [&_.bb-code]:border [&_.bb-code]:border-[var(--border-muted)]
      [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--accent-blue)]/40 [&_blockquote]:pl-3.5
      [&_strong]:text-[var(--text-primary)] [&_strong]:font-semibold
      [&_pre]:bg-[var(--bg-tertiary)] [&_pre]:rounded-xl [&_pre]:p-3.5 [&_pre]:overflow-x-auto
      [&_code]:text-[13px] [&_code]:font-mono
      [&_p]:mb-2.5 [&_p]:text-[var(--text-primary)]
      [&_.bb-spoiler]:inline-block
    `}>
      <PostContent post={post} />
    </div>
  );
}

function PostContent({ post }: { post: Post }) {
  if (post.contentHtml) {
    if (post.contentHtml.length > 5000) return <ChunkedPostRenderer html={post.contentHtml} maxChunkSize={5000} />;
    return (
      <ErrorBoundary fallback={<div className="text-[var(--accent-red)] text-sm p-3 rounded-xl bg-[var(--surface-hover)]">渲染失败</div>}>
        <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
      </ErrorBoundary>
    );
  }
  if (post.content) return <div className="whitespace-pre-wrap">{post.content}</div>;
  return <span className="text-[var(--text-tertiary)] italic">(无内容)</span>;
}

function PostFooter({ post }: { post: Post }) {
  const faved = useFavoriteStore.getState().isPostFavorited(post.pid);
  return (
    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[var(--border-subtle)] text-[var(--text-tertiary)]">
      <button className="flex items-center gap-1.5 text-xs hover:text-[var(--accent-blue)] transition-colors ripple rounded-lg px-2 py-1">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
        </svg>
        回复
      </button>
      <button className="flex items-center gap-1.5 text-xs hover:text-[var(--accent-red)] transition-colors ripple rounded-lg px-2 py-1">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
        </svg>
        {post.likes > 0 ? post.likes : null}
      </button>
      <button className="flex items-center gap-1.5 text-xs hover:text-[var(--accent-green)] transition-colors ripple rounded-lg px-2 py-1 ml-auto">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"/>
        </svg>
      </button>
      <button onClick={() => useFavoriteStore.getState().togglePost({ pid: post.pid, tid: post.tid, author: post.author, content: post.content.substring(0, 80) })}
        className={`flex items-center gap-1.5 text-xs transition-colors rounded-lg px-2 py-1 ${faved ? "text-red-400" : "hover:text-red-300"}`}
        title={faved ? "取消收藏" : "收藏此回复"}>
        <svg className="w-3.5 h-3.5" fill={faved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
        </svg>
      </button>
    </div>
  );
}

export default function PostCard({ post, isFirst = false, allPosts = [], depth = 0 }: PostCardProps) {
  const bgColor = depth > 0 ? DEPTH_CARD_COLORS[Math.min(depth - 1, 4)] : isFirst ? "var(--card-cool)" : "var(--card-cream)";

  return (
    <div style={{ marginLeft: depth > 0 ? `${depth * 20}px` : 0 }} className="relative">
      <div className="rounded-3xl border border-[var(--border-subtle)] p-5 shadow-card backdrop-blur-sm transition-all duration-[var(--duration-medium)] ease-standard hover:shadow-elevated"
        style={{ backgroundColor: bgColor }}>
        <PostHeader post={post} />
        {post.replyTo && depth === 0 && <ReplyPreview target={post.replyTo} allPosts={allPosts} />}
        <PostBody post={post} />
        {post.images.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <ImageGallery images={post.images} />
          </div>
        )}
        <PostFooter post={post} />
      </div>
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}
