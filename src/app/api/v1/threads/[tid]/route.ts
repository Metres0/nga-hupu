import { NextRequest, NextResponse } from "next/server";
import { getCachedPosts, getThreadPageInfo } from "@/lib/cache/db";
import { pipeline } from "@/lib/middleware/pipeline";

export async function GET(
  request: NextRequest,
  { params }: { params: { tid: string } }
) {
  const piped = pipeline(async (req: Request) => {
    const tid = parseInt(params.tid);
    const page = parseInt(new URL(req.url).searchParams.get("page") || "1");

    const cachedPosts = getCachedPosts(tid, 0, page);
    if (cachedPosts && cachedPosts.length > 0) {
      const pageInfo = getThreadPageInfo(tid);
      return NextResponse.json(
        {
          thread: pageInfo ? {
            tid, title: pageInfo.title, author: pageInfo.author,
            replyCount: pageInfo.reply_count, pageCount: pageInfo.page_count,
          } : { tid },
          posts: cachedPosts.map((row: any) => ({
            pid: row.pid, tid: row.tid, author: row.author,
            authorId: row.author_id, content: row.content,
            contentHtml: row.content_html, createTime: row.create_time,
            replyTo: row.reply_to, floor: row.floor,
            images: JSON.parse(row.images || "[]"),
            attachments: JSON.parse(row.attachments || "[]"),
            likes: row.likes,
          })),
          totalPages: pageInfo?.page_count ?? 1,
          cached: true,
        },
        { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } }
      );
    }

    const { dedupedScrape } = await import("@/lib/cache/db");
    const result = await dedupedScrape(
      `thread:${tid}:${page}`,
      async () => {
        const { scrapeThreadDetail } = await import("@/lib/scraper/engine");
        const { cachePosts, updateThreadCacheTime } = await import("@/lib/cache/db");
        const data = await scrapeThreadDetail(tid, page);
        if (data && data.posts.length > 0) {
          cachePosts(data.posts, tid, page);
          updateThreadCacheTime(tid);
        }
        return data;
      }
    );
    if (result && result.posts.length > 0) {
      return NextResponse.json(
        { thread: result.thread, posts: result.posts, totalPages: result.totalPages, cached: false },
        { headers: { "Cache-Control": "public, max-age=60" } }
      );
    }
    return NextResponse.json(
      { thread: { tid }, posts: [], totalPages: 0, cached: false },
      { headers: { "Cache-Control": "public, max-age=30" } }
    );
  });

  return piped(request);
}
