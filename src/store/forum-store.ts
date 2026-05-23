"use client";

import { create } from "zustand";
import type { Thread } from "@/lib/types";

interface ForumState {
  threads: Thread[];
  page: number;
  totalPages: number;
  hasMore: boolean;
  forumName: string;
  fid: number;
  cached: boolean;
  loading: boolean;
  pageLoading: boolean;
  error: string | null;
  activeCategory: string;
  sortBy: "lastReply" | "createTime" | "replyCount";
  sortAsc: boolean;

  setThreads: (threads: Thread[]) => void;
  setPage: (page: number) => void;
  setTotalPages: (v: number) => void;
  setHasMore: (v: boolean) => void;
  setForumName: (name: string) => void;
  setFid: (fid: number) => void;
  setCached: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  setPageLoading: (v: boolean) => void;
  setError: (err: string | null) => void;
  setActiveCategory: (id: string) => void;
  setSortBy: (sort: ForumState["sortBy"]) => void;
  toggleSortOrder: () => void;
  reset: () => void;
}

export const useForumStore = create<ForumState>((set) => ({
  threads: [],
  page: 1,
  totalPages: 1,
  hasMore: false,
  forumName: "",
  fid: 0,
  cached: false,
  loading: true,
  pageLoading: false,
  error: null,
  activeCategory: "all",
  sortBy: "lastReply" as ForumState["sortBy"],
  sortAsc: false,

  setFid: (fid) => set({ fid }),
  setThreads: (threads) => set({ threads }),
  setPage: (page) => set({ page }),
  setTotalPages: (total) => set({ totalPages: total }),
  setHasMore: (v) => set({ hasMore: v }),
  setForumName: (name) => set({ forumName: name }),
  setCached: (v) => set({ cached: v }),
  setLoading: (v) => set({ loading: v }),
  setPageLoading: (v) => set({ pageLoading: v }),
  setError: (err) => set({ error: err }),
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  setSortBy: (sort) => set({ sortBy: sort }),
  toggleSortOrder: () => set((s) => ({ sortAsc: !s.sortAsc })),
  reset: () =>
    set({
      threads: [],
      page: 1,
      totalPages: 1,
      hasMore: false,
      forumName: "",
      fid: 0,
      cached: false,
      loading: true,
      pageLoading: false,
      error: null,
  activeCategory: "all",
  sortBy: "lastReply" as ForumState["sortBy"],
  sortAsc: false,
    }),
}));
