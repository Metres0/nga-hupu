"use client";

import { create } from "zustand";

interface AuthState {
  loggedIn: boolean;
  username: string | null;
  loading: boolean;
  loginDialogOpen: boolean;
  expiresAt: number | null;
  expiringSoon: boolean;
  hasCredential: boolean;
  resumable: boolean;

  setLoggedIn: (username: string) => void;
  setLoggedOut: () => void;
  setLoading: (v: boolean) => void;
  openLoginDialog: () => void;
  closeLoginDialog: () => void;
  setSessionInfo: (info: { expiresAt?: number | null; expiringSoon?: boolean; hasCredential?: boolean; resumable?: boolean }) => void;
  initAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  loggedIn: false,
  username: null,
  loading: true,
  loginDialogOpen: false,
  expiresAt: null,
  expiringSoon: false,
  hasCredential: false,
  resumable: false,

  setLoggedIn: (username) => set({
    loggedIn: true, username, loginDialogOpen: false,
    resumable: false,
  }),
  setLoggedOut: () => set({
    loggedIn: false, username: null, expiresAt: null,
    expiringSoon: false, hasCredential: false,
  }),
  setLoading: (v) => set({ loading: v }),
  openLoginDialog: () => set({ loginDialogOpen: true }),
  closeLoginDialog: () => set({ loginDialogOpen: false }),

  setSessionInfo: (info) => set({
    ...(info.expiresAt !== undefined && { expiresAt: info.expiresAt }),
    ...(info.expiringSoon !== undefined && { expiringSoon: info.expiringSoon }),
    ...(info.hasCredential !== undefined && { hasCredential: info.hasCredential }),
    ...(info.resumable !== undefined && { resumable: info.resumable }),
  }),

  initAuth: async () => {
    try {
      const resp = await fetch("/api/v1/auth/status");
      const data = await resp.json();
      if (data.loggedIn) {
        set({
          loggedIn: true,
          username: data.username,
          expiresAt: data.expiresAt,
          expiringSoon: data.expiringSoon || false,
          loading: false,
        });
      } else {
        set({ loggedIn: false, loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },
}));
