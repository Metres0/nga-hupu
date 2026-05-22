/**
 * NGA BBCode → HTML Parser v2
 * Handles mixed HTML + BBCode content.
 * Preserves existing HTML formatting (<br>, <b>, <a>, <table> etc).
 * Converts BBCode tags to HTML with proper CSS classes.
 */

const IMAGE_PROXY_PREFIX = "/api/v1/image-proxy?url=";
const NGA_ATTACH_BASE = "https://img.nga.178.com/attachments/";

function proxyImgUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith(IMAGE_PROXY_PREFIX)) return url;
  if (url.startsWith("/")) return url;
  if (url.startsWith("data:")) return url;
  return IMAGE_PROXY_PREFIX + encodeURIComponent(url);
}

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  let out = html;

  // Remove script and style blocks
  out = out.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove NGA event handlers and tracking attributes
  out = out.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\s+_orgt\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\s+_us\s*=\s*"[^"]*"/gi, "");

  return out;
}

export function bbcodeToHtml(raw: string): string {
  if (!raw) return "";

  let html = raw.replace(/\r\n/g, "\n");

  // Extract and protect code blocks BEFORE newline conversion
  const codeBlocks: string[] = [];
  html = html.replace(
    /\[code\]([\s\S]*?)\[\/code\]/gi,
    (_, code: string) => {
      codeBlocks.push(
        `<pre class="bb-code"><code>${code
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</code></pre>`
      );
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    }
  );

  // Replace raw newlines with <br/>
  html = html
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>");

  html = `<p>${html}</p>`;
  // Fix empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");

  // --- BBCode tag processing ---

  // [h] title [/h]
  html = html.replace(
    /\[h\](.*?)\[\/h\]/gs,
    '<h3 class="bb-heading">$1</h3>'
  );

  // [b] bold [/b]
  html = html.replace(/\[b\](.*?)\[\/b\]/gis, "<strong>$1</strong>");
  // [i] italic [/i]
  html = html.replace(/\[i\](.*?)\[\/i\]/gis, "<em>$1</em>");
  // [u] underline [/u]
  html = html.replace(/\[u\](.*?)\[\/u\]/gis, "<u>$1</u>");
  // [del] or [s] strikethrough
  html = html.replace(/\[del\](.*?)\[\/del\]/gis, "<del>$1</del>");
  html = html.replace(/\[s\](.*?)\[\/s\]/gis, "<del>$1</del>");

  // [color=red] text [/color]
  html = html.replace(
    /\[color=([^\]]+)\](.*?)\[\/color\]/gis,
    '<span style="color:$1">$2</span>'
  );

  // [size=1.5em] text [/size]
  html = html.replace(
    /\[size=([^\]]+)\](.*?)\[\/size\]/gis,
    '<span style="font-size:$1">$2</span>'
  );

  // [align=left|center|right] text [/align]
  html = html.replace(
    /\[align=(left|center|right|justify)\](.*?)\[\/align\]/gis,
    '<div style="text-align:$1">$2</div>'
  );

  // [url]link[/url]
  html = html.replace(
    /\[url\](https?:\/\/[^\[]+?)\[\/url\]/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="bb-link">$1</a>'
  );

  // [url=link]text[/url]
  html = html.replace(
    /\[url=(https?:\/\/[^\]]+?)\](.*?)\[\/url\]/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="bb-link">$2</a>'
  );

  // [img]url[/img] — with proxy
  html = html.replace(
    /\[img\](https?:\/\/[^\[]+?\.(?:jpg|jpeg|png|gif|webp|bmp)[^\[]*?)\[\/img\]/gi,
    (_, url: string) => {
      const cleanUrl = url.replace(/^https?:\/\//, "https://");
      return `<img src="${proxyImgUrl(cleanUrl)}" loading="lazy" class="bb-img" alt="" />`;
    }
  );

  // [quote]...[/quote]
  html = html.replace(
    /\[quote\](.*?)\[\/quote\]/gs,
    '<blockquote class="bb-quote">$1</blockquote>'
  );

  // [quote pid=123]...[/quote] or [quote uid=xxx name=yyy]...[/quote]
  html = html.replace(
    /\[quote\s+pid=(\d+)\](.*?)\[\/quote\]/gis,
    '<blockquote class="bb-quote" data-pid="$1"><span class="bb-quote-header">回复 #$1</span>$2</blockquote>'
  );
  html = html.replace(
    /\[quote\s+uid=(\d+)\s+name=([^\]]+)\](.*?)\[\/quote\]/gis,
    '<blockquote class="bb-quote" data-uid="$1"><span class="bb-quote-header">$2</span>$3</blockquote>'
  );
  html = html.replace(
    /\[quote\s+pid=(\d+)\s+uid=(\d+)\s+name=([^\]]+)\](.*?)\[\/quote\]/gis,
    '<blockquote class="bb-quote" data-pid="$1" data-uid="$2"><span class="bb-quote-header">$3 回复 #$1</span>$4</blockquote>'
  );

  // [@username] mention → link to user
  html = html.replace(
    /\[@([^\]]+)\]/g,
    '<a href="https://bbs.nga.cn/nuke.php?func=ucp&username=$1" target="_blank" rel="noopener noreferrer" class="bb-link">@$1</a>'
  );

  // [dice]XdY[/dice]
  html = html.replace(
    /\[dice\](\d+d\d+)\[\/dice\]/gi,
    '<span class="bb-dice">$1</span>'
  );

  // [tid=123] → thread link, [pid=123] → post link
  html = html.replace(
    /\[tid=(\d+)\]/gi,
    '/forum/0/thread/$1'
  );
  html = html.replace(
    /\[pid=(\d+)\]/gi,
    '#pid$1'
  );

  // [collapse=title]...[/collapse] or [collapse]...[/collapse]
  html = html.replace(
    /\[collapse(?:\s*=\s*(.+?))?\](.*?)\[\/collapse\]/gis,
    (_, title?: string, content?: string) => {
      const label = title || "展开";
      return `<details class="bb-collapse"><summary class="bb-collapse-summary">${label}</summary><div class="bb-collapse-content">${content || ""}</div></details>`;
    }
  );

  // [spoiler]...[/spoiler] — blur effect (FluxDO-style)
  html = html.replace(
    /\[spoiler\](.*?)\[\/spoiler\]/gis,
    '<span class="bb-spoiler" tabindex="0">$1</span>'
  );

  // [randomblock]...[/randomblock]
  html = html.replace(
    /\[randomblock\](.*?)\[\/randomblock\]/gis,
    '<div class="bb-randomblock">$1</div>'
  );

  // [list] items [*] [/list]
  html = html.replace(
    /\[list\](.*?)\[\/list\]/gis,
    (_, content: string) => {
      const items = content
        .split("[*]")
        .filter(Boolean)
        .map((item: string) => `<li>${item.trim()}</li>`)
        .join("");
      return `<ul class="bb-list">${items}</ul>`;
    }
  );

  html = html.replace(
    /\[list=1\](.*?)\[\/list\]/gis,
    (_, content: string) => {
      const items = content
        .split("[*]")
        .filter(Boolean)
        .map((item: string) => `<li>${item.trim()}</li>`)
        .join("");
      return `<ol class="bb-list">${items}</ol>`;
    }
  );

  // [table][tr][td]cell[/td][/tr][/table]
  html = html.replace(
    /\[table\](.*?)\[\/table\]/gis,
    (_, content: string) => {
      const rows = content.split("[tr]").filter(Boolean);
      const tableRows = rows
        .map((row: string) => {
          const cleanRow = row.replace("[/tr]", "").trim();
          const hasHeader = cleanRow.includes("[th]");
          const cellTag = hasHeader ? "th" : "td";
          const cells = cleanRow
            .replace(new RegExp(`\\[\\/?${cellTag}\\]`, "gi"), (m: string) =>
              m.startsWith("[/") ? `</${cellTag}>` : `<${cellTag}>`
            );
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<div class="bb-table-wrapper"><table class="bb-table">${tableRows}</table></div>`;
    }
  );

  // Clean up formatting from raw HTML extraction
  html = html
    .replace(/\s+style=""/g, "")
    .replace(/\s+class=""/g, "");

  // Restore protected code blocks
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, i: string) => codeBlocks[parseInt(i)]);

  // Restore protected code blocks
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, i: string) => codeBlocks[parseInt(i)]);

  // [audio]url[/audio]
  html = html.replace(
    /\[audio\](https?:\/\/[^\[]+?)\[\/audio\]/gi,
    '<audio controls class="bb-audio" src="$1" preload="metadata"></audio>'
  );

  // [video]url[/video]
  html = html.replace(
    /\[video\](.*?)\[\/video\]/gi,
    (_, url: string) => {
      if (/bilibili\.com|b23\.tv/i.test(url)) {
        const bvMatch = url.match(/BV[\w]+/) || url.match(/av\d+/);
        const src = bvMatch
          ? `//player.bilibili.com/player.html?bvid=${bvMatch[0]}`
          : url;
        return `<iframe class="bb-video" src="${src}" allowfullscreen loading="lazy"></iframe>`;
      }
      return `<video controls class="bb-video" src="${url}" preload="metadata"></video>`;
    }
  );

  // [smile]name[/smile]
  html = html.replace(
    /\[smile\](.*?)\[\/smile\]/gi,
    '<img class="bb-smile" src="https://img4.nga.178.com/ngabbs/face/$1.gif" alt="[$1]" loading="lazy" />'
  );

  // [anony]...[/anony]
  html = html.replace(
    /\[anony\](.*?)\[\/anony\]/gis,
    '<span class="bb-anony">匿名</span>'
  );

  // [sub] text [/sub]
  html = html.replace(/\[sub\](.*?)\[\/sub\]/gis, "<sub>$1</sub>");
  // [sup] text [/sup]
  html = html.replace(/\[sup\](.*?)\[\/sup\]/gis, "<sup>$1</sup>");

  // Clean up formatting from raw HTML extraction
  html = html
    .replace(/\s+style=""/g, "")
    .replace(/\s+class=""/g, "");

  // Pangu spacing: add space between CJK and Latin/numbers
  html = applyPangu(html);

  // Remove NGA attachment JavaScript
  html = cleanAttachmentsFromHtml(html);

  return html;
}

function applyPangu(text: string): string {
  return text
    .replace(/([\u4e00-\u9fff\u3400-\u4dbf])([a-zA-Z0-9])/g, "$1 $2")
    .replace(/([a-zA-Z0-9])([\u4e00-\u9fff\u3400-\u4dbf])/g, "$1 $2");
}

export function extractImagesFromBbcode(raw: string): string[] {
  const images: string[] = [];
  const imgRegex = /\[img\](https?:\/\/[^\[]+?\.(?:jpg|jpeg|png|gif|webp|bmp)[^\[]*?)\[\/img\]/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(raw)) !== null) {
    let url = match[1];
    if (url.startsWith("//")) url = "https:" + url;
    url = proxyImgUrl(url);
    if (!images.includes(url)) images.push(url);
  }
  return images;
}

export function stripBbcode(raw: string): string {
  return raw.replace(/\[[^\]]*\]/g, "").trim();
}

/**
 * Extract attachment image URLs from ubbcode.attach.load() calls.
 * NGA uses JavaScript to lazy-load attachment images.
 */
export function extractAttachmentsFromRaw(raw: string): string[] {
  const images: string[] = [];
  // Match ubbcode.attach.load('...','...',[{...url:'mon_YYYYMM/...',...}],...)
  const attachRegex = /ubbcode\.attach\.load\([^,]+,[^,]+,(\[[^\]]*\])/g;
  let match: RegExpExecArray | null;
  while ((match = attachRegex.exec(raw)) !== null) {
    try {
      const arrStr = match[1].replace(/'/g, '"');
      // Extract url fields
      const urlRegex = /url\s*:\s*"([^"]+)"/g;
      let urlMatch: RegExpExecArray | null;
      while ((urlMatch = urlRegex.exec(arrStr)) !== null) {
        let url = urlMatch[1];
        if (url.startsWith("mon_")) {
          url = NGA_ATTACH_BASE + url;
        }
        images.push(url);
      }
    } catch {}
  }
  return images;
}

/**
 * Clean up attachment JavaScript and button text from content for display.
 */
export function cleanAttachmentsFromHtml(html: string): string {
  // Remove ubbcode.attach.load() calls
  html = html.replace(/ubbcode\.attach\.load\([^)]+\)/g, "");
  // Remove "显示全部附件" text
  html = html.replace(/显示全部附件/g, "");
  // Clean up orphaned commas/semicolons/quotes
  html = html.replace(/\s*,\s*,/g, "").replace(/\s*'\s*,?\s*'/g, "").replace(/,\s*$/gm, "");
  return html;
}
