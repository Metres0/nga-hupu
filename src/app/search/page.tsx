"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { GlassSkeleton } from "@/components/ui/GlassSkeleton";
import { getPlugin } from "@/plugins/registry";

interface SearchResult { pid: number; tid: number; author: string; content: string; createTime: number; floor: number; }

function highlight(text: string, q: string) {
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase()
      ? `<mark class="bg-amber-200 text-amber-900 rounded px-0.5">${part}</mark>`
      : part
  ).join("");
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto px-5 py-12"><GlassSkeleton className="h-48 rounded-2xl" /></div>}>
      <SearchContent />
    </Suspense>
  );
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQ = searchParams.get("q") || "";
  const initialFid = searchParams.get("fid") || "";

  const [query, setQuery] = useState(initialQ);
  const [fid] = useState(initialFid);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const forumName = fid ? (getPlugin(parseInt(fid))?.name || `板块 ${fid}`) : null;

  const doSearch = useCallback(async (q: string, off: number = 0) => {
    if (!q.trim()) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ q: q.trim(), limit: "30", offset: String(off) });
      if (fid) params.set("fid", fid);
      const resp = await fetch(`/api/v1/search?${params}`);
      const data = await resp.json();
      if (off === 0) setResults(data.data || []);
      else setResults((prev) => [...prev, ...(data.data || [])]);
      setTotal(data.count || data.data?.length || 0);
      setOffset(off + (data.data?.length || 0));
      setHasMore(data.count > off + (data.data?.length || 0));
    } catch (e) {
      setError("搜索失败");
    } finally { setLoading(false); }
  }, [fid]);

  useEffect(() => {
    if (initialQ) doSearch(initialQ);
  }, [initialQ, doSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    params.set("q", query);
    if (fid) params.set("fid", fid);
    router.replace(`/search?${params}`);
    doSearch(query);
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href={fid ? `/forum/${fid}` : "/"} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] no-underline text-sm">← 返回</Link>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          搜索{forumName ? ` · ${forumName}` : ""}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={forumName ? `在 ${forumName} 中搜索...` : "搜索帖子内容..."}
          className="glass-input flex-1 px-4 py-2.5 rounded-xl text-sm" autoFocus />
        <button type="submit" disabled={loading}
          className="px-5 py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-sm font-semibold hover:shadow-elevated transition-all active:scale-[0.98] disabled:opacity-50">
          {loading ? "搜索中..." : "搜索"}
        </button>
      </form>

      {total > 0 && (
        <p className="text-xs text-[var(--text-tertiary)] mb-3">找到 {total} 条结果</p>
      )}

      {error && <p className="text-sm text-[var(--md-error)] mb-4">{error}</p>}

      {results.length === 0 && !loading && initialQ && !error && (
        <div className="glass-card rounded-2xl text-center py-16">
          <p className="text-[var(--text-secondary)] text-sm">未找到相关帖子</p>
          <p className="text-[var(--text-tertiary)] text-xs mt-1">尝试更换关键词</p>
        </div>
      )}

      <div className="space-y-3">
        {results.map((r, i) => (
          <Link key={`${r.pid}-${i}`} href={`/forum/thread/${r.tid}`}
            className="block glass-card rounded-2xl px-5 py-4 no-underline hover:shadow-elevated transition-all group">
            <div className="flex items-center gap-3 text-label text-[var(--text-tertiary)] mb-1.5">
              <span>{r.author}</span>
              <span>#{r.floor} 楼</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3"
              dangerouslySetInnerHTML={{ __html: highlight(r.content.substring(0, 300), query) }} />
          </Link>
        ))}
      </div>

      {loading && <GlassSkeleton className="h-32 rounded-2xl mt-3" />}

      {hasMore && !loading && (
        <div className="flex justify-center mt-4">
          <button onClick={() => doSearch(query, offset)}
            className="px-5 py-2 rounded-xl glass-card text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-all">
            加载更多
          </button>
        </div>
      )}
    </div>
  );
}
