import { getCachedThreads, getCachedThreadCount } from "@/lib/cache/db";
import { getPlugin } from "@/plugins/registry";
import ForumPageClient from "@/components/widgets/ForumPageClient";
import AuthGate from "@/components/widgets/AuthGate";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function ForumPage({ params }: { params: { fid: string } }) {
  const fid = parseInt(params.fid);
  const plugin = getPlugin(fid);
  const cookieStore = cookies();
  const uidCookie = cookieStore.get("ngaPassportUid");
  const isLoggedIn = !!(uidCookie && uidCookie.value && uidCookie.value !== "guest");

  if (plugin?.requiresLogin && !isLoggedIn) {
    return <AuthGate fid={fid} forumName={plugin?.name} />;
  }
  const perPage = 50;
  const cached = getCachedThreads(fid, 0, perPage, 0) as any[];
  const totalCount = getCachedThreadCount(fid);

  const initialData = cached?.length > 0 ? cached.map((row: any) => ({
    tid: row.tid, title: row.title, author: row.author,
    createTime: row.create_time, lastReplyTime: row.last_reply_time,
    replyCount: row.reply_count, sticky: !!row.sticky,
    digest: !!row.digest, pageCount: row.page_count,
  })) : null;

  const initialMeta = {
    totalPages: Math.max(Math.ceil(totalCount / perPage), 1),
    forumName: plugin?.name || `板块 ${fid}`,
  };

  return <ForumPageClient fid={fid} initialThreads={initialData} initialMeta={initialMeta} />;
}
