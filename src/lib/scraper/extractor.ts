import { load } from "cheerio";
import type { Thread, Post } from "@/lib/types";
import { sanitizeHtml, bbcodeToHtml, extractImagesFromBbcode, extractAttachmentsFromRaw, cleanAttachmentsFromHtml } from "@/lib/parser/bbcode";

export function isContentImage(src: string): boolean {
  if (!src || src === "about:blank" || src.startsWith("data:image/svg")) return false;
  if (/\/face\//.test(src) || /\/smile\//.test(src) || /smile_ac/i.test(src)) return false;
  return /\.(jpg|jpeg|png|gif|webp|bmp)/i.test(src);
}

export function extractImageSrc(el: any, $: any): string {
  let src =
    $(el).attr("_orgsrc") ||
    $(el).attr("data-srcorg") ||
    $(el).attr("data-src") ||
    $(el).attr("data-original") ||
    $(el).attr("_src") ||
    $(el).attr("data-url") ||
    $(el).attr("src");
  if (src) {
    if (src.startsWith("//")) src = "https:" + src;
    if (isContentImage(src)) return src;
  }
  const raw = $(el)[0];
  if (raw && raw.attribs && (!src || src === "about:blank")) {
    for (const key of Object.keys(raw.attribs)) {
      if (key.startsWith("data-") || (key.startsWith("_") && key !== "_orgt" && key !== "_us")) {
        const v = raw.attribs[key];
        if (typeof v === "string" && isContentImage(v)) {
          return v.startsWith("//") ? "https:" + v : v;
        }
      }
    }
  }
  return "";
}

export function isNgaEmoticon(el: any, $: any): boolean {
  const src = $(el).attr("src") || "";
  const cls = $(el).attr("class") || "";
  return /\/face\//.test(src) || /\/smile\//.test(src) || /smile_ac/i.test(cls) || /bb-smile/i.test(cls);
}

export interface ExtractedThreadList {
  threads: Thread[];
  totalPages: number;
  forumName: string;
  subForums: Array<{ fid: number; name: string }>;
}

export function extractThreadList(html: string, fid: number): ExtractedThreadList {
  return extractThreadListCheerio(html, fid);
}

function extractThreadListCheerio(html: string, fid: number): ExtractedThreadList {
  const $ = load(html);

  const forumName =
    $("#page_title, .forum-name").first().text().trim() ||
    $("title").text().replace("NGA玩家社区", "").trim() ||
    `板块 ${fid}`;

  const threads: Thread[] = [];

  $("a.topic, a[class*='topic']").each((_, el) => {
    const $el = $(el);
    const cls = $el.attr("class") || "";

    if (cls.includes("silver") || cls.includes("replydate") || cls.includes("nobr")) {
      return;
    }

    const href = $el.attr("href") || "";
    const tidMatch = href.match(/tid=(\d+)/);
    if (!tidMatch) return;

    const tid = parseInt(tidMatch[1]);
    const title = $el.text().trim();

    if (!title || title === "寂寞的车版头" || title.length < 2) return;

    const row = $el.closest(".topicrow, tr, td.c2");
    const authorEl = row.find("a.author, a[class*='author']").first();
    const author = authorEl.text().trim();
    const authorIdMatch = authorEl.attr("href")?.match(/uid=(\d+)/);
    const authorId = authorIdMatch ? parseInt(authorIdMatch[1]) : 0;

    const replyEl = row.find(".replies, a.replies").first();
    const replyCount = parseInt(replyEl.text().trim().replace(/\D/g, "")) || 0;

    const dateEl = row.find(".postdate, .f10, time, .replydate, .postdatec").first();
    const timeText = dateEl.text().trim();
    const createTime = parseNgaTime(timeText);

    const categories: string[] = [];
    const catMatch = title.match(/^\[(.+?)\]/);
    if (catMatch) categories.push(catMatch[1]);

    const sticky = cls.includes("red") || title.includes("锁定");
    const digest = cls.includes("green");

    threads.push({
      tid, fid, title,
      author: author || "未知",
      authorId, createTime,
      lastReplyTime: createTime,
      replyCount, sticky, digest, categories,
    });
  });

  const subForums: Array<{ fid: number; name: string }> = [];
  $(".subforum a, .subforums a, .childforum a, a[href*='fid=']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const subFidMatch = href.match(/fid=(-?\d+)/);
    const subName = $(el).text().trim();
    if (subFidMatch && subName && subName.length > 1) {
      const subFid = parseInt(subFidMatch[1]);
      if (!subForums.find((s) => s.fid === subFid) && subFid !== fid) {
        subForums.push({ fid: subFid, name: subName });
      }
    }
  });

  const pageText = $("a[href*='page=']:last-child, .pages a:last-child").text().trim();
  const totalPages = parseInt(pageText) || $("a[href*='page=']").length || 1;

  return { threads, totalPages, forumName, subForums };
}

function stripNgaJs(html: string): string {
  // Remove ubbcode.attach.load() calls using balanced parenthesis matching
  const startTag = "ubbcode.attach.load(";
  let idx = html.indexOf(startTag);
  while (idx !== -1) {
    let depth = 0;
    let end = idx + startTag.length;
    for (; end < html.length; end++) {
      if (html[end] === "(") depth++;
      if (html[end] === ")") {
        if (depth === 0) break;
        depth--;
      }
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

export function extractThreadDetail(html: string, tid: number, page: number): {
  thread: Thread;
  posts: Post[];
  totalPages: number;
} | null {
  const $ = load(html);

  const title =
    $("title").text().replace("NGA玩家社区", "").trim() ||
    $(".topic-title, #postsubject0").first().text().trim() ||
    `帖子 #${tid}`;

  const authorEl = $(".author, .posterinfo a").first();
  const author = authorEl.text().trim() || "未知";
  const replyCount = $("a.replies, .postcount").first().text().trim().replace(/\D/g, "") || "0";

  const pageText = $("a[href*='page=']:last-child, .pages a:last-child").text().trim();
  const totalPages = parseInt(pageText) || 1;

  const thread: Thread = {
    tid, fid: 0, title, author, authorId: 0,
    createTime: Date.now(), lastReplyTime: Date.now(),
    replyCount: parseInt(replyCount) || 0,
    sticky: false, digest: false, categories: [],
    pageCount: totalPages,
  };

  const posts: Post[] = [];
  $(".postrow").each((idx, el) => {
    const $el = $(el);

    let floor = idx + 1;
    const floorEl = $el.find("a[id^='postnum'], .postnum, a.postinfot").first();
    const floorText = floorEl.text().trim().replace("#", "");
    const parsedFloor = parseInt(floorText);
    if (!isNaN(parsedFloor)) floor = parsedFloor;

    const pidMatch = $el.attr("id")?.match(/\d+/);
    const pid = pidMatch ? parseInt(pidMatch[0]) : 1000000 + idx;

    const postAuthor = $el.find("a.userlink.author, a.userlink").first().text().trim() || "未知";

    let rawContent = "";
    let contentHtml = "";
    const images: string[] = [];
    let contentRawHtml = "";

    const contentCandidates = $el.find(
      "div.postcontent[id^='postcontent'], td.c2 div.postcontent, div[id^='postcontent']"
    );

    contentCandidates.each((_, candidate) => {
      if (rawContent.length > 5) return;
      const html = $(candidate).html() || "";
      if (html.includes("{") && html.includes("}") && html.length < 500) return;

      const cleanHtml = sanitizeHtml(html);
      const text = $(candidate).text().trim();
      if (text.length < 3) return;

      rawContent = text;
      contentRawHtml = cleanHtml;
      contentHtml = bbcodeToHtml(cleanHtml);
      if (!contentHtml || contentHtml.length < 5) {
        contentHtml = text.replace(/\n/g, "<br/>");
      }
      contentHtml = contentHtml.replace(
        /src="(https?:\/\/[^"]+)"/gi,
        (_, url: string) => `src="/api/v1/image-proxy?url=${encodeURIComponent(url)}" loading="lazy" decoding="async"`
      );

      $(candidate).find("img").each((_, imgEl) => {
        if (isNgaEmoticon(imgEl, $)) return;
        const src = extractImageSrc(imgEl, $);
        if (src && !images.includes(src)) images.push(src);
      });

      const bbImages = extractImagesFromBbcode(contentRawHtml || text);
      bbImages.forEach((img) => { if (!images.includes(img)) images.push(img); });

      const attachImages = extractAttachmentsFromRaw(contentRawHtml || text);
      attachImages.forEach((img) => { if (!images.includes(img)) images.push(img); });

      contentHtml = cleanAttachmentsFromHtml(contentHtml);
      // Inline: strip ubbcode.attach.load() and NGA JS if not already cleaned
      contentHtml = stripNgaJs(contentHtml);
    });

    if (!rawContent || rawContent.length < 3) {
      $el.find(".ubbcode, [class*='ubbcode']").each((_, uel) => {
        if (rawContent.length > 5) return;
        const html = $(uel).html() || "";
        if (html.includes("{") && html.includes("}") && html.length < 500) return;
        const text = $(uel).text().trim();
        if (text.length < 3) return;
        rawContent = text;
        const cleanHtml = sanitizeHtml(html);
        contentHtml = bbcodeToHtml(cleanHtml);
        if (!contentHtml) contentHtml = text.replace(/\n/g, "<br/>");
        contentHtml = contentHtml.replace(
          /src="(https?:\/\/[^"]+)"/gi,
          (_, url: string) => `src="/api/v1/image-proxy?url=${encodeURIComponent(url)}" loading="lazy" decoding="async"`
        );
        contentHtml = stripNgaJs(contentHtml);

        $(uel).find("img").each((_, imgEl) => {
          if (isNgaEmoticon(imgEl, $)) return;
          const src = extractImageSrc(imgEl, $);
          if (src && !images.includes(src)) images.push(src);
        });
      });
    }

    if (!rawContent || rawContent.length < 3) {
      const c2Text = $el.find("td.c2").text().trim();
      if (c2Text.length > 100) {
        rawContent = c2Text.substring(50, Math.min(c2Text.length - 50, 2000));
        contentHtml = rawContent.replace(/\n/g, "<br/>");
        contentHtml = stripNgaJs(contentHtml);
      }
    }

    let replyTo: number | undefined;
    $el.find("a[href*='pid=']").each((_, qel) => {
      if (replyTo) return;
      const pidMatch = $(qel).attr("href")?.match(/pid=(\d+)/);
      if (pidMatch) replyTo = parseInt(pidMatch[1]);
    });

    const dateEl = $el.find(".postdatec, .postdate, .postInfo, time").first();
    const dateText = dateEl.text().trim();
    const createTime = parseNgaTime(dateText);

    const likeText = $el.find(".likes, .agree").text().trim();
    const likes = parseInt(likeText.replace(/\D/g, "")) || 0;

    posts.push({
      pid, tid, author: postAuthor, authorId: 0,
      content: rawContent, contentHtml, createTime,
      replyTo, floor, images, attachments: [], likes,
    });
  });

  const pidToFloor = new Map<number, number>();
  posts.forEach((p) => { if (p.pid && p.floor !== undefined) pidToFloor.set(p.pid, p.floor); });
  posts.forEach((p) => {
    if (p.replyTo && pidToFloor.has(p.replyTo)) {
      p.replyTo = pidToFloor.get(p.replyTo);
    } else if (p.replyTo && p.replyTo > 1000) {
      p.replyTo = undefined;
    }
  });

  return { thread, posts, totalPages };
}

export function parseNgaTime(text: string): number {
  if (!text) return Date.now();
  const now = Date.now();

  const relMatch = text.match(/(\d+)\s*(分钟|小时|天|月|秒|年)/);
  if (relMatch) {
    const num = parseInt(relMatch[1]);
    const unit = relMatch[2];
    switch (unit) {
      case "秒": return now - num * 1000;
      case "分钟": return now - num * 60000;
      case "小时": return now - num * 3600000;
      case "天": return now - num * 86400000;
      case "月": return now - num * 2592000000;
      case "年": return now - num * 31536000000;
    }
  }

  const dateMatch = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*(\d{2})?:?(\d{2})?:?(\d{2})?/);
  if (dateMatch) {
    const y = parseInt(dateMatch[1]);
    const m = parseInt(dateMatch[2]) - 1;
    const d = parseInt(dateMatch[3]);
    const h = parseInt(dateMatch[4] || "0");
    const min = parseInt(dateMatch[5] || "0");
    return new Date(y, m, d, h, min).getTime();
  }

  return now;
}
