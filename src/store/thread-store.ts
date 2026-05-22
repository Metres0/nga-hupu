"use client";

import { create } from "zustand";
import type { Thread, Post } from "@/lib/types";

interface ThreadState {
  thread: Thread | null;
  posts: Post[];
  totalPages: number;
  loading: boolean;
  pageLoading: boolean;
  error: string | null;
  lastRefresh: number | null;

  setThread: (t: Thread) => void;
  setPosts: (posts: Post[]) => void;
  setTotalPages: (n: number) => void;
  setLoading: (v: boolean) => void;
  setPageLoading: (v: boolean) => void;
  setError: (err: string | null) => void;
  setLastRefresh: (ts: number) => void;
  reset: () => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  thread: null,
  posts: [],
  totalPages: 1,
  loading: true,
  pageLoading: false,
  error: null,
  lastRefresh: null,

  setThread: (t) => set({ thread: t }),
  setPosts: (posts) => set({ posts }),
  setTotalPages: (n) => set({ totalPages: n }),
  setLoading: (v) => set({ loading: v }),
  setPageLoading: (v) => set({ pageLoading: v }),
  setError: (err) => set({ error: err }),
  setLastRefresh: (ts) => set({ lastRefresh: ts }),
  reset: () =>
    set({
      thread: null,
      posts: [],
      totalPages: 1,
      loading: true,
      pageLoading: false,
      error: null,
      lastRefresh: null,
    }),
}));
