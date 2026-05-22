"use client";

import { useState } from "react";

function proxy(url: string) { if (url.startsWith("/api") || url.startsWith("data:")) return url; return `/api/v1/image-proxy?url=${encodeURIComponent(url)}`; }

export default function ImageGallery({ images }: { images: string[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  return (
    <>
      <div className={`grid gap-2.5 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {images.map((src, i) => (
          <img key={i} src={proxy(src)} onClick={() => setLightbox(src)} loading="lazy" alt=""
            className="rounded-xl object-cover cursor-pointer border border-[var(--border-muted)] hover:border-[var(--accent-blue)] hover:shadow-md transition-all max-h-52 w-full bg-[var(--bg-tertiary)]"
            onError={(e) => { const el = e.currentTarget; if (el.src.includes("/api/v1/image-proxy")) { const orig = new URLSearchParams(el.src.split("?")[1]).get("url"); if (orig) el.src = orig; else el.style.display = "none"; } else el.style.display = "none"; }}/>
        ))}
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.9)] backdrop-blur-sm flex items-center justify-center cursor-pointer" onClick={() => setLightbox(null)}>
          <img src={proxy(lightbox)} className="max-w-[92vw] max-h-[92vh] rounded-2xl object-contain shadow-2xl" alt="" />
        </div>
      )}
    </>
  );
}
