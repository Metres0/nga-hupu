import { describe, it, expect } from "vitest";
import {
  bbcodeToHtml,
  sanitizeHtml,
  extractImagesFromBbcode,
  stripBbcode,
} from "./bbcode";

describe("sanitizeHtml", () => {
  it("removes script tags", () => {
    expect(sanitizeHtml('<script>alert("x")</script><p>good</p>')).toBe("<p>good</p>");
  });

  it("removes style tags", () => {
    expect(sanitizeHtml("<style>.x{}</style>text")).toBe("text");
  });

  it("removes NGA event handlers", () => {
    expect(sanitizeHtml('<div onclick="x" onX=\'y\' _orgt="1">a</div>')).toBe("<div>a</div>");
  });

  it("handles empty input", () => {
    expect(sanitizeHtml("")).toBe("");
  });
});

describe("bbcodeToHtml", () => {
  it("converts bold", () => {
    expect(bbcodeToHtml("[b]hello[/b]")).toContain("<strong>hello</strong>");
  });

  it("converts italic", () => {
    expect(bbcodeToHtml("[i]hello[/i]")).toContain("<em>hello</em>");
  });

  it("converts underline", () => {
    expect(bbcodeToHtml("[u]hello[/u]")).toContain("<u>hello</u>");
  });

  it("converts color", () => {
    const r = bbcodeToHtml("[color=red]text[/color]");
    expect(r).toContain('color:red');
    expect(r).toContain("text");
  });

  it("converts url with text", () => {
    const r = bbcodeToHtml("[url=https://example.com]click[/url]");
    expect(r).toContain('href="https://example.com"');
    expect(r).toContain("click");
  });

  it("converts plain url", () => {
    const r = bbcodeToHtml("[url]https://example.com[/url]");
    expect(r).toContain('href="https://example.com"');
  });

  it("converts image with proxy", () => {
    const r = bbcodeToHtml("[img]https://img.nga.178.com/test.jpg[/img]");
    expect(r).toContain("/api/v1/image-proxy?url=");
  });

  it("converts quote", () => {
    const r = bbcodeToHtml("[quote]hello[/quote]");
    expect(r).toContain("bb-quote");
    expect(r).toContain("hello");
  });

  it("converts quote with pid", () => {
    const r = bbcodeToHtml("[quote pid=123]hello[/quote]");
    expect(r).toContain("data-pid=\"123\"");
    expect(r).toContain("回复 #123");
  });

  it("converts quote with uid and name", () => {
    const r = bbcodeToHtml("[quote uid=456 name=testuser]hello[/quote]");
    expect(r).toContain("data-uid=\"456\"");
    expect(r).toContain("testuser");
  });

  it("converts quote with pid, uid and name", () => {
    const r = bbcodeToHtml("[quote pid=1 uid=2 name=user]text[/quote]");
    expect(r).toContain("data-pid=\"1\"");
    expect(r).toContain("data-uid=\"2\"");
    expect(r).toContain("user");
  });

  it("converts list items", () => {
    const r = bbcodeToHtml("[list][*]one[*]two[/list]");
    expect(r).toContain("<li>one</li>");
    expect(r).toContain("<li>two</li>");
  });

  it("converts code block without br in code", () => {
    const r = bbcodeToHtml("[code]const x = 1;\nconst y = 2;[/code]");
    expect(r).toContain("<pre class=\"bb-code\"><code>");
    expect(r).toContain("const x = 1;\nconst y = 2;");
    expect(r).not.toContain("<br");
  });

  it("converts collapse", () => {
    const r = bbcodeToHtml("[collapse=title]hidden[/collapse]");
    expect(r).toContain("<details");
    expect(r).toContain("title");
  });

  it("converts strikethrough", () => {
    const r = bbcodeToHtml("[del]removed[/del]");
    expect(r).toContain("<del>removed</del>");
  });

  it("converts mention", () => {
    const r = bbcodeToHtml("[@username]");
    expect(r).toContain("@username");
    expect(r).toContain("nuke.php");
  });

  it("converts dice", () => {
    const r = bbcodeToHtml("[dice]2d6[/dice]");
    expect(r).toContain("bb-dice");
    expect(r).toContain("2d6");
  });

  it("converts newlines to br", () => {
    const r = bbcodeToHtml("line1\nline2");
    expect(r).toContain("line1<br/>line2");
  });

  it("converts double newlines to paragraph", () => {
    const r = bbcodeToHtml("para1\n\npara2");
    expect(r).toContain("</p><p>");
  });

  it("handles empty input", () => {
    expect(bbcodeToHtml("")).toBe("");
  });
});

describe("extractImagesFromBbcode", () => {
  it("extracts image URLs", () => {
    const imgs = extractImagesFromBbcode("[img]https://img.nga.178.com/a.jpg[/img]");
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0]).toContain("/api/v1/image-proxy");
  });

  it("returns empty for no images", () => {
    expect(extractImagesFromBbcode("no images here")).toEqual([]);
  });
});

describe("stripBbcode", () => {
  it("strips all BBCode tags", () => {
    expect(stripBbcode("[b]hello[/b] [i]world[/i]")).toBe("hello world");
  });
});
