"use client";

import { useState, useRef } from "react";
import { useReplyStore } from "@/store/reply-store";
import { useAuthStore } from "@/store/auth-store";

interface ReplyFormProps {
  tid: number;
  fid: number;
  pid: number;
  replyToAuthor?: string;
}

export default function ReplyForm({ tid, fid, pid, replyToAuthor }: ReplyFormProps) {
  const { closeReply } = useReplyStore();
  const { loggedIn, openLoginDialog } = useAuthStore();
  const [content, setContent] = useState("");
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!loggedIn) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm" onClick={closeReply}>
        <div className="glass-card-elevated rounded-3xl p-6 shadow-modal text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-[var(--text-secondary)] mb-2">请先登录后再回复</p>
          <button onClick={openLoginDialog}
            className="px-4 py-1.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-xs font-semibold">
            登录 NGA
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm" onClick={closeReply}>
        <div className="glass-card-elevated rounded-3xl p-6 shadow-modal text-center" onClick={(e) => e.stopPropagation()}>
          <span className="text-emerald-500 text-sm">回复已提交</span>
          <button onClick={() => { closeReply(); setSuccess(false); setContent(""); }}
            className="ml-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            关闭
          </button>
        </div>
      </div>
    );
  }

  function insertTag(tag: string, attr?: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = content.substring(start, end);
    const openTag = attr ? `[${tag}=${attr}]` : `[${tag}]`;
    const closeTag = `[/${tag}]`;
    const newContent = content.substring(0, start) + openTag + sel + closeTag + content.substring(end);
    setContent(newContent);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + openTag.length, start + openTag.length + sel.length); }, 0);
  }

  async function doReply() {
    if (!content.trim() || content.trim().length < 2) { setError("请输入回复内容"); return; }
    setLoading(true); setError(null);
    try {
      const resp = await fetch(`/api/v1/threads/${tid}/reply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, fid, content: content.trim(), subject: subject.trim() || undefined }),
      });
      const data = await resp.json();
      if (data.success) { setSuccess(true); } else { setError(data.error || "回复失败"); }
    } catch { setError("网络错误"); }
    finally { setLoading(false); }
  }

  const btnBase = "px-2 py-0.5 text-[10px] rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm" onClick={closeReply}>
      <div className="w-full max-w-lg mx-4 glass-card-elevated rounded-3xl p-6 shadow-modal max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {replyToAuthor ? `回复 @${replyToAuthor}` : "发表回复"}
          </span>
          <button onClick={closeReply} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-lg leading-none">✕</button>
        </div>

      <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
        placeholder="标题 (可选)" className="glass-input w-full px-3 py-1.5 rounded-lg text-xs mb-2" />

      <div className="flex gap-1 mb-2 flex-wrap">
        <button onClick={() => insertTag("b")} className={btnBase} title="加粗">B</button>
        <button onClick={() => insertTag("i")} className={btnBase} title="斜体"><i>I</i></button>
        <button onClick={() => insertTag("u")} className={btnBase} title="下划线"><u>U</u></button>
        <button onClick={() => insertTag("del")} className={btnBase} title="删除线">S</button>
        <button onClick={() => insertTag("color", "red")} className={btnBase} title="颜色">A</button>
        <button onClick={() => insertTag("quote")} className={btnBase} title="引用">引用</button>
        <button onClick={() => { const url = prompt("图片URL:"); if (url) insertTag("img", url); }}
          className={btnBase} title="图片">🖼</button>
        <button onClick={() => { const url = prompt("链接URL:"); if (url) insertTag("url", url); }}
          className={btnBase} title="链接">🔗</button>
        <button onClick={() => insertTag("code")} className={btnBase} title="代码">&lt;/&gt;</button>
      </div>

      <textarea ref={textareaRef} value={content} onChange={(e) => setContent(e.target.value)}
        placeholder="输入回复内容... (支持 BBCode)"
        className="glass-input w-full px-3 py-2 rounded-xl text-sm min-h-[100px] resize-y" />

      {error && <p className="text-xs text-[var(--md-error)] mt-1">{error}</p>}

      <div className="flex gap-2 mt-2">
        <button onClick={doReply} disabled={loading}
          className="px-5 py-2 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-sm font-semibold hover:shadow-elevated transition-all active:scale-[0.98] disabled:opacity-50">
          {loading ? "提交中..." : "发布回复"}
        </button>
        <button onClick={closeReply}
          className="px-4 py-2 rounded-xl border border-[var(--border-default)] text-xs text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] transition-colors">
          取消
        </button>
      </div>
    </div>
    </div>
  );
}
