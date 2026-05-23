"use client";

import { useEffect, useState } from "react";

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="glass-fab fixed bottom-6 right-6 md:right-20 md:bottom-6 z-45 w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer transition-all duration-[var(--duration-medium)] ease-standard hover:scale-105 active:scale-95 ripple text-xl font-light"
      title="新建 / 回到顶部"
    >
      +
    </button>
  );
}
