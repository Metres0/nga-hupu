import { getCachedPosts, getThreadPageInfo } from "@/lib/cache/db";
import ThreadPageClient from "@/components/widgets/ThreadPageClient";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params, searchParams }: {
  params: { fid: string; tid: string };
  searchParams: { page?: string };
}) {
  const tid = parseInt(params.tid);
  const fid = parseInt(params.fid);
  const page = parseInt(searchParams.page || "1");

  const posts = getCachedPosts(tid, 0, page) as any[] | null;
  const pageInfo = getThreadPageInfo(tid);

  const initialPosts = (posts && posts.length > 0) ? posts.map((p: any) => ({
    pid: p.pid, tid: p.tid, author: p.author,
    content: p.content, contentHtml: p.content_html,
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
