"use client";

import { useEffect, useRef } from "react";

export function useScrollRestore(key: string) {
  const restored = useRef(false);

  useEffect(() => {
    if (!restored.current && typeof window !== "undefined") {
      const saved = sessionStorage.getItem(`scroll:${key}`);
      if (saved) {
        window.scrollTo(0, parseInt(saved));
      }
      restored.current = true;
    }

    const handleScroll = () => {
      sessionStorage.setItem(`scroll:${key}`, String(window.scrollY));
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [key]);
}
