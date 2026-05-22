"use client";

import { useState, useMemo } from "react";
import BoardCard from "./BoardCard";
import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { getPlugin } from "@/plugins/registry";
import type { BoardNode } from "@/lib/types";

const NAME_OVERRIDES: Record<number, string> = { [-343809]: "汽车俱乐部", [-7]: "网事杂谈", [7]: "议事厅" };
function displayName(board: BoardNode): string { return NAME_OVERRIDES[board.fid] || board.name; }

interface BoardExplorerProps { boards: BoardNode[]; }

export default function BoardExplorer({ boards }: BoardExplorerProps) {
  const { toggleSubscribe, isSubscribed } = useUiStore();
  const loggedIn = useAuthStore((s) => s.loggedIn);
  const [search, setSearch] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showRestricted, setShowRestricted] = useState(false);

  const { publicBoards, restrictedBoards } = useMemo(() => {
    const pub: BoardNode[] = [];
    const rst: BoardNode[] = [];
    const q = search.toLowerCase();
    for (const b of boards) {
      const name = displayName(b);
      if (q && !name.toLowerCase().includes(q) && !b.name.toLowerCase().includes(q)) continue;
      const plugin = getPlugin(b.fid);
      if (plugin?.requiresLogin) rst.push(b); else pub.push(b);
    }
    return { publicBoards: pub, restrictedBoards: rst };
  }, [search, boards]);

  const allVisible = [...publicBoards, ...(showRestricted ? restrictedBoards : [])];

  return (
    <div className="space-y-4">
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`搜索 ${boards.length} 个板块...`}
          className="glass-input w-full pl-10 pr-4 py-3 rounded-xl text-[var(--text-primary)] text-sm placeholder:text-[var(--text-placeholder)]"/>
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm font-medium">X</button>
        )}
      </div>

      {/* Restricted boards section */}
      {!loggedIn && restrictedBoards.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <button onClick={() => setShowRestricted(!showRestricted)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-[var(--surface-hover)] transition-colors">
            <span className="text-[var(--text-secondary)] text-sm font-medium flex items-center gap-2">
              🔒 需登录板块 <span className="text-[var(--text-tertiary)] text-xs">{restrictedBoards.length}</span>
            </span>
            <span className="text-[var(--text-tertiary)] text-xs">{showRestricted ? "收起" : "展开"}</span>
          </button>
          {showRestricted && (
            <div className="divide-y divide-[var(--border-muted)]">
              {restrictedBoards.map((b) => {
                const name = displayName(b);
                const subscribed = isSubscribed(b.fid);
                return <BoardCard key={b.fid} fid={b.fid} name={name} isSubscribed={subscribed} onToggle={() => toggleSubscribe(b.fid, name)} />;
              })}
            </div>
          )}
        </div>
      )}

      <div className="glass-card rounded-2xl overflow-hidden">
        <button onClick={() => setShowMore(!showMore)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-[var(--surface-hover)] transition-colors">
          <span className="text-[var(--text-secondary)] text-sm font-medium">
            {search ? "搜索结果" : "全部板块"}<span className="text-[var(--text-tertiary)] text-xs ml-1.5">{search ? allVisible.length : publicBoards.length}</span>
          </span>
          <span className="text-[var(--text-tertiary)] text-xs">{showMore ? "收起" : "展开"}</span>
        </button>
        {showMore && (
          <div className="divide-y divide-[var(--border-muted)] max-h-[420px] overflow-y-auto">
            {allVisible.length === 0 ? (
              <p className="text-[var(--text-tertiary)] text-sm py-12 text-center">无匹配板块</p>
            ) : allVisible.map((b) => {
              const name = displayName(b);
              const subscribed = isSubscribed(b.fid);
              return (
                <BoardCard key={b.fid} fid={b.fid} name={name} isSubscribed={subscribed} onToggle={() => toggleSubscribe(b.fid, name)} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
