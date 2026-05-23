export interface Forum {
  fid: number;
  name: string;
  parent?: number;
  description?: string;
  icon?: string;
  threadCount?: number;
}

export interface Thread {
  tid: number;
  fid: number;
  title: string;
  author: string;
  authorId: number;
  createTime: number;
  lastReplyTime: number;
  replyCount: number;
  sticky: boolean;
  digest: boolean;
  categories: string[];
  pageCount?: number;
}

export interface Post {
  pid: number;
  tid: number;
  author: string;
  authorId: number;
  content: string;
  contentHtml: string;
  createTime: number;
  replyTo?: number;
  floor: number;
  images: string[];
  attachments: Attachment[];
  likes: number;
  userLiked?: boolean;
  userDisliked?: boolean;
}

export interface Attachment {
  url: string;
  type: "image" | "video" | "audio" | "file";
  thumb?: string;
  filename?: string;
}

export interface ThreadDetail {
  thread: Thread;
  posts: Post[];
  totalPages: number;
}

export interface BoardNode {
  fid: number;
  name: string;
  parentFid: number | null;
  children: BoardNode[];
  threadCount?: number;
}

export interface ForumConfig {
  fid: number;
  name: string;
  baseUrl: string;
  categories: ForumCategory[];
  subForums: SubForum[];
  requiresLogin?: boolean;
}

export interface ForumCategory {
  id: string;
  name: string;
  fid?: number;
}

export interface SubForum {
  fid: number;
  name: string;
  description?: string;
}

export interface ScrapeResult<T> {
  data: T | null;
  cached: boolean;
  cachedAt?: number;
  error?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  totalPages: number;
  hasMore: boolean;
}
