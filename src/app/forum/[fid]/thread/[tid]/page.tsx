import { getCachedPosts, getThreadPageInfo } from "@/lib/cache/db";
import { getPlugin } from "@/plugins/registry";
import ThreadPageClient from "@/components/widgets/ThreadPageClient";
import AuthGate from "@/components/widgets/AuthGate";
import { getSession } from "@/lib/auth/session-store";

export const dynamic = "force-dynamic";

function cleanPostHtml(html: string): string {
  if (!html) return "";
  // Remove ubbcode.attach.load() calls using balanced parenthesis matching
  const startTag = "ubbcode.attach.load(";
  let idx = html.indexOf(startTag);
  while (idx !== -1) {
    let depth = 0, end = idx + startTag.length;
    for (; end < html.length; end++) {
      if (html[end] === "(") depth++;
      if (html[end] === ")") { if (depth === 0) break; depth--; }
    }
    if (end < html.length && html[end] === ")") {
      let after = end + 1;
      while (after < html.length && (html[after] === " " || html[after] === ";")) after++;
      html = html.substring(0, idx) + html.substring(after);
    } else break;
    idx = html.indexOf(startTag);
  }
  html = html.replace(/显示全部附件/g, "");
  html = html.replace(/commonui\.\w+\s*\([^)]*\)\s*;?/g, "");
  html = html.replace(/改动在\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}修改/g, "");
  html = html.replace(/#\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\d+/g, "");
  return html;
}

export default async function ThreadPage({ params, searchParams }: {
  params: { fid: string; tid: string };
  searchParams: { page?: string };
}) {
  const tid = parseInt(params.tid);
  const fid = parseInt(params.fid);
  const page = parseInt(searchParams.page || "1");

  const plugin = getPlugin(fid);
  const session = getSession();
  const isLoggedIn = !!(session && session.expiresAt > Date.now());

  if (plugin?.requiresLogin && !isLoggedIn) {
    return <AuthGate fid={fid} forumName={plugin?.name} />;
  }

  const posts = getCachedPosts(tid, 0, page) as any[] | null;
  const pageInfo = getThreadPageInfo(tid);

  const initialPosts = (posts && posts.length > 0) ? posts.map((p: any) => ({
    pid: p.pid, tid: p.tid, author: p.author,
    content: p.content, contentHtml: cleanPostHtml(p.content_html),
    createTime: p.create_time, replyTo: p.reply_to,
    floor: p.floor, images: JSON.parse(p.images || "[]"),
    likes: p.likes || 0,
  })) : null;

  return (
    <ThreadPageClient
      tid={tid} fid={fid} page={page}
      initialPosts={initialPosts}
      threadInfo={pageInfo ? { title: pageInfo.title, author: pageInfo.author, replyCount: pageInfo.reply_count, totalPages: pageInfo.page_count } : null}
    />
  );
}
