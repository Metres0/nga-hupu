"use client";

import { create } from "zustand";

interface FavoriteThread { tid: number; title: string; fid: number; author: string; addedAt: number; }
interface FavoritePost { pid: number; tid: number; author: string; content: string; addedAt: number; }

interface FavoriteState {
  threads: FavoriteThread[];
  posts: FavoritePost[];
  toggleThread: (t: Omit<FavoriteThread, "addedAt">) => void;
  togglePost: (p: Omit<FavoritePost, "addedAt">) => void;
  isThreadFavorited: (tid: number) => boolean;
  isPostFavorited: (pid: number) => boolean;
  removeThread: (tid: number) => void;
  removePost: (pid: number) => void;
  loadFromStorage: () => void;
  threadCount: () => number;
  postCount: () => number;
}

function persist(state: Pick<FavoriteState, "threads" | "posts">) {
  if (typeof window !== "undefined") {
    localStorage.setItem("nga_favorites", JSON.stringify(state));
  }
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  threads: [],
  posts: [],

  toggleThread: (t) => {
    const { threads } = get();
    if (threads.find((f) => f.tid === t.tid)) {
      const next = threads.filter((f) => f.tid !== t.tid);
      set({ threads: next });
      persist({ threads: next, posts: get().posts });
    } else {
      const next = [...threads, { ...t, addedAt: Date.now() }];
      set({ threads: next });
      persist({ threads: next, posts: get().posts });
    }
  },

  togglePost: (p) => {
    const { posts } = get();
    if (posts.find((f) => f.pid === p.pid)) {
      const next = posts.filter((f) => f.pid !== p.pid);
      set({ posts: next });
      persist({ threads: get().threads, posts: next });
    } else {
      const next = [...posts, { ...p, addedAt: Date.now() }];
      set({ posts: next });
      persist({ threads: get().threads, posts: next });
    }
  },

  isThreadFavorited: (tid) => get().threads.some((f) => f.tid === tid),
  isPostFavorited: (pid) => get().posts.some((f) => f.pid === pid),

  removeThread: (tid) => {
    const next = get().threads.filter((f) => f.tid !== tid);
    set({ threads: next });
    persist({ threads: next, posts: get().posts });
  },

  removePost: (pid) => {
    const next = get().posts.filter((f) => f.pid !== pid);
    set({ posts: next });
    persist({ threads: get().threads, posts: next });
  },

  threadCount: () => get().threads.length,
  postCount: () => get().posts.length,

  loadFromStorage: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("nga_favorites");
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.threads)) set({ threads: data.threads });
        if (Array.isArray(data.posts)) set({ posts: data.posts });
      }
    } catch {}
  },
}));
