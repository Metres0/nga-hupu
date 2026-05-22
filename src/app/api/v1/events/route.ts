import { NextRequest } from "next/server";
import { getAllCachedForums } from "@/lib/cache/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fidStr = searchParams.get("fid");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const check = () => {
        if (closed) return;
        try {
          const forums = getAllCachedForums();
          const data = JSON.stringify({
            type: "ping",
            timestamp: Date.now(),
            forumCount: forums.length,
            lastUpdated: Date.now(),
            fid: fidStr ? parseInt(fidStr) : null,
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping", timestamp: Date.now() })}\n\n`));
        }
      };

      check();
      const interval = setInterval(check, 30000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
