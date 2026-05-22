import { describe, it, expect, vi } from "vitest";
import { buildReplyTree, flattenTree } from "./reply-tree";
import type { Post } from "./types";

function makePost(pid: number, floor: number, replyTo?: number): Post {
  return {
    pid, tid: 1, floor, replyTo,
    author: "test", authorId: 0, content: "", contentHtml: "",
    createTime: 0, images: [], attachments: [], likes: 0,
  };
}

describe("buildReplyTree", () => {
  it("handles empty posts", () => {
    expect(buildReplyTree([])).toEqual([]);
  });

  it("creates single root for no replies", () => {
    const posts = [makePost(1, 0), makePost(2, 1)];
    const tree = buildReplyTree(posts);
    expect(tree.length).toBe(2);
  });

  it("builds nested reply chain", () => {
    const posts = [makePost(1, 1), makePost(2, 2, 1), makePost(3, 3, 2)];
    const tree = buildReplyTree(posts);
    expect(tree.length).toBe(1);
    expect(tree[0].children.length).toBe(1);
    expect(tree[0].children[0].children.length).toBe(1);
  });

  it("handles reply to non-existent floor", () => {
    const posts = [makePost(1, 1), makePost(2, 2, 99)];
    const tree = buildReplyTree(posts);
    expect(tree.length).toBe(2);
  });

  it("handles reply to floor 0 as root", () => {
    const posts = [makePost(1, 0), makePost(2, 1, 0)];
    const tree = buildReplyTree(posts);
    expect(tree.length).toBe(1);
    expect(tree[0].children.length).toBe(1);
  });
});

describe("flattenTree", () => {
  it("flattens with depth", () => {
    const posts = [makePost(1, 1), makePost(2, 2, 1)];
    const tree = buildReplyTree(posts);
    const flat = flattenTree(tree);
    expect(flat.length).toBe(2);
    expect(flat[0].depth).toBe(0);
    expect(flat[1].depth).toBe(1);
  });
});
