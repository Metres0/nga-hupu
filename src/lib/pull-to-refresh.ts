"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 60 }: PullToRefreshOptions) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pullDistance = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const touchStart = (e: TouchEvent) => {
      if (window.scrollY > 5) return;
      startY.current = e.touches[0].clientY;
      pullDistance.current = 0;
    };

    const touchMove = (e: TouchEvent) => {
      if (window.scrollY > 5 || startY.current === 0) return;
      const dy = e.touches[0].clientY - startY.current;
      pullDistance.current = Math.max(0, dy);
      if (dy > 20) setPulling(true);
    };

    const touchEnd = async () => {
      const dist = pullDistance.current;
      startY.current = 0;
      pullDistance.current = 0;
      setPulling(false);
      if (dist >= threshold) {
        setRefreshing(true);
        try { await onRefresh(); } catch {}
        setRefreshing(false);
      }
    };

    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: true });
    el.addEventListener("touchend", touchEnd);

    return () => {
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("touchend", touchEnd);
    };
  }, [onRefresh, threshold]);

  return { containerRef, pulling, refreshing };
}
