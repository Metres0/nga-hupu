import type { Post } from "@/lib/types";
import { parseNgaTime } from "./extractor";

export function resolveReplyTargets(posts: Post[]): Post[] {
  const pidToFloor = new Map<number, number>();
  posts.forEach((p) => {
    if (p.pid && p.floor !== undefined) pidToFloor.set(p.pid, p.floor);
  });

  return posts.map((p) => {
    if (p.replyTo && pidToFloor.has(p.replyTo)) {
      return { ...p, replyTo: pidToFloor.get(p.replyTo) };
    }
    if (p.replyTo && p.replyTo > 1000) {
      return { ...p, replyTo: undefined };
    }
    return p;
  });
}

export function deduplicatePosts(posts: Post[]): Post[] {
  const seen = new Map<number, Post>();
  for (const p of posts) {
    if (!seen.has(p.pid) || p.content.length > seen.get(p.pid)!.content.length) {
      seen.set(p.pid, p);
    }
  }
  return Array.from(seen.values());
}

export function chunkHtmlForRendering(html: string, maxChunkLength: number = 5000): string[] {
  if (html.length <= maxChunkLength) return [html];

  const chunks: string[] = [];
  const parts = html.split(/(<\/p>|<\/div>|<br\s*\/?>|<br>)/gi);

  let current = "";
  for (const part of parts) {
    if (current.length + part.length > maxChunkLength && current.length > 0) {
      chunks.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

export { parseNgaTime };
