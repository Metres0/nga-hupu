"use client";

import { useEffect, useRef, useCallback } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const pendingFetches = new Map<string, Promise<any>>();
const TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(type: string, id: number, page: number = 1): string {
  return `${type}:${id}:${page}`;
}

export function getCachedData<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < TTL) {
    return entry.data as T;
  }
  return null;
}

export function setCachedData<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export function clearAllCache(): void {
  cache.clear();
  pendingFetches.clear();
}

/**
 * Pre-fetch data into cache without returning it.
 * Deduplicates in-flight requests.
 */
export async function prefetchData<T>(
  url: string,
  key: string
): Promise<T | null> {
  // Return cached immediately if fresh
  const cached = getCachedData<T>(key);
  if (cached) return cached;

  // Deduplicate in-flight fetches
  if (pendingFetches.has(key)) {
    return pendingFetches.get(key) as Promise<T>;
  }

  const promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error("prefetch failed");
      return res.json();
    })
    .then((json) => {
      if (json.error) return null;
      setCachedData(key, json);
      return json as T;
    })
    .catch(() => null)
    .finally(() => {
      pendingFetches.delete(key);
    });

  pendingFetches.set(key, promise);
  return promise;
}

/**
 * Pre-fetch thread data from forum page using IntersectionObserver
 */
export function usePrefetchThreads(fid: number) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  const prefetchThread = useCallback(
    (tid: number) => {
      const key = getCacheKey("thread", tid);
      if (getCachedData(key)) return;
      prefetchData(`/api/v1/threads/${tid}?page=1`, key);
    },
    []
  );

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const tidAttr = el.dataset.tid;
            if (tidAttr) {
              prefetchThread(parseInt(tidAttr));
            }
          }
        });
      },
      { rootMargin: "200px" }
    );

    // Observe all thread links
    document.querySelectorAll("[data-tid]").forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [fid, prefetchThread]);

  return prefetchThread;
}

export { getCacheKey };
