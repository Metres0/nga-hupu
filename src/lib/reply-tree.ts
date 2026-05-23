import type { Post } from "@/lib/types";

export interface ReplyNode {
  post: Post;
  depth: number;
  children: ReplyNode[];
}

/**
 * Build a reply tree from flat posts using replyTo field.
 * Top-level posts: replyTo is undefined/null, or floor 0 (OP).
 */
export function buildReplyTree(posts: Post[]): ReplyNode[] {
  const roots: ReplyNode[] = [];
  const nodeMap = new Map<number, ReplyNode>();

  // Create nodes for all posts
  posts.forEach((post) => {
    nodeMap.set(post.floor, { post, depth: 0, children: [] });
  });

  // Build parent-child relationships
  posts.forEach((post) => {
    const node = nodeMap.get(post.floor)!;
    if (post.replyTo != null && nodeMap.has(post.replyTo)) {
      const parent = nodeMap.get(post.replyTo)!;
      node.depth = Math.min(parent.depth + 1, 5); // Max depth 5
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort: OP first (floor 0), then by floor order
  roots.sort((a, b) => a.post.floor - b.post.floor);
  roots.forEach(sortChildren);

  return roots;
}

function sortChildren(node: ReplyNode) {
  node.children.sort((a, b) => a.post.floor - b.post.floor);
  node.children.forEach(sortChildren);
}

/** Flatten tree to array with depth, preserving visual order */
export function flattenTree(nodes: ReplyNode[]): { post: Post; depth: number }[] {
  const result: { post: Post; depth: number }[] = [];
  function walk(list: ReplyNode[]) {
    list.forEach((node) => {
      result.push({ post: node.post, depth: node.depth });
      walk(node.children);
    });
  }
  walk(nodes);
  return result;
}
