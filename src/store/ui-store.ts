"use client";

import { create } from "zustand";

interface SubEntry { fid: number; name: string; }

interface UiState {
  subscriptions: SubEntry[];
  loading: boolean;

  toggleSubscribe: (fid: number, name?: string) => void;
  isSubscribed: (fid: number) => boolean;
  setLoading: (v: boolean) => void;
  loadFromStorage: () => void;
}

function persist(list: SubEntry[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem("nga_subscriptions", JSON.stringify(list));
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  subscriptions: [],
  loading: true,

  toggleSubscribe: (fid, name) => {
    const { subscriptions } = get();
    if (subscriptions.find((s) => s.fid === fid)) {
      const next = subscriptions.filter((s) => s.fid !== fid);
      set({ subscriptions: next });
      persist(next);
    } else {
      const next = [...subscriptions, { fid, name: name || `板块 ${fid}` }];
      set({ subscriptions: next });
      persist(next);
    }
  },

  isSubscribed: (fid) => get().subscriptions.some((s) => s.fid === fid),

  setLoading: (v) => set({ loading: v }),

  loadFromStorage: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("nga_subscriptions");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          if (arr.length > 0 && typeof arr[0] === "object") {
            set({ subscriptions: arr as SubEntry[] });
          } else if (typeof arr[0] === "number") {
            const migrated = arr.map((fid: number) => ({ fid, name: `板块 ${fid}` }));
            set({ subscriptions: migrated });
          }
        }
      }
    } catch {}
  },
}));
