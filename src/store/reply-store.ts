"use client";

import { create } from "zustand";

interface ReplyState {
  openPid: number | null;
  openReply: (pid: number) => void;
  closeReply: () => void;
}

export const useReplyStore = create<ReplyState>((set) => ({
  openPid: null,
  openReply: (pid) => set({ openPid: pid }),
  closeReply: () => set({ openPid: null }),
}));
