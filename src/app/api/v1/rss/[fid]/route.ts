import { NextRequest, NextResponse } from "next/server";
import { getCachedThreads, getAllCachedForums } from "@/lib/cache/db";
import type { Thread } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: { fid: string } }
) {
  const fid = parseInt(params.fid);

  try {
    const forum = getAllCachedForums().find((f) => f.fid === fid);
    const rawThreads = getCachedThreads(fid, 7 * 24 * 60 * 60 * 1000);
    const threads = rawThreads as Thread[];

    if (!threads || threads.length === 0) {
      return NextResponse.json({ error: "论坛无数据" }, { status: 404 });
    }

    const { getPlugin } = await import("@/plugins/registry");
    const plugin = getPlugin(fid);
    const forumName = plugin?.name || forum?.name || `板块 ${fid}`;

    const rssItems = threads.slice(0, 20).map((t) => ({
      title: t.title,
      link: `https://bbs.nga.cn/read.php?tid=${t.tid}`,
      description: `${t.author} - ${t.replyCount} 回复`,
      pubDate: new Date(t.createTime).toUTCString(),
      guid: `nga-thread-${t.tid}`,
      author: t.author,
    }));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${forumName} - NGA镜像</title>
    <link>https://bbs.nga.cn/thread.php?fid=${fid}</link>
    <description>${forumName} 帖子 RSS</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${rssItems
      .map(
        (item) => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <description><![CDATA[${item.description}]]></description>
      <pubDate>${item.pubDate}</pubDate>
      <guid>${item.guid}</guid>
      <author>${item.author}</author>
    </item>`
      )
      .join("")}
  </channel>
</rss>`;

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "RSS 生成失败" }, { status: 500 });
  }
}
