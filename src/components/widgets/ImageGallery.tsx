"use client";

import { useState, useCallback, useEffect } from "react";

function proxy(url: string) { if (url.startsWith("/api") || url.startsWith("data:")) return url; return `/api/v1/image-proxy?url=${encodeURIComponent(url)}`; }

export default function ImageGallery({ images }: { images: string[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const close = useCallback(() => { setLightbox(null); setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const next = useCallback(() => {
    if (lightbox === null) return;
    setLightbox((lightbox + 1) % images.length);
    setZoom(1); setPan({ x: 0, y: 0 });
  }, [lightbox, images.length]);

  const prev = useCallback(() => {
    if (lightbox === null) return;
    setLightbox((lightbox - 1 + images.length) % images.length);
    setZoom(1); setPan({ x: 0, y: 0 });
  }, [lightbox, images.length]);

  const toggleZoom = useCallback(() => {
    setZoom((z) => (z === 1 ? 2.5 : 1));
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (lightbox === null) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "f" || e.key === "F") toggleZoom();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox, close, next, prev, toggleZoom]);

  const src = lightbox !== null ? images[lightbox] : null;

  return (
    <>
      <div className={`grid gap-2.5 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {images.map((src, i) => (
          <img key={i} src={proxy(src)} onClick={() => setLightbox(i)} loading="lazy" alt=""
            className="rounded-xl object-cover cursor-pointer border border-[var(--border-muted)] hover:border-[var(--accent-blue)] hover:shadow-md transition-all max-h-52 w-full bg-[var(--bg-tertiary)]"
            onError={(e) => { const el = e.currentTarget; if (el.src.includes("/api/v1/image-proxy")) { const orig = new URLSearchParams(el.src.split("?")[1]).get("url"); if (orig) el.src = orig; else el.style.display = "none"; } else el.style.display = "none"; }}/>
        ))}
      </div>

      {src && (
        <div className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.92)] backdrop-blur-sm flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-2 text-white/70 text-sm">
            <span>{lightbox! + 1} / {images.length}</span>
            <div className="flex items-center gap-3">
              <button onClick={toggleZoom} className="hover:text-white transition-colors" title="缩放 (F)">🔍</button>
              <a href={proxy(src)} download target="_blank" rel="noopener" className="hover:text-white transition-colors" title="下载" onClick={(e) => e.stopPropagation()}>⬇</a>
              <button onClick={close} className="text-lg hover:text-white transition-colors" title="关闭 (Esc)">✕</button>
            </div>
          </div>

          {/* Main image area */}
          <div className="flex-1 flex items-center justify-center relative overflow-hidden">
            {images.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-3 z-10 text-white/60 hover:text-white text-3xl transition-colors select-none">‹</button>
            )}
            <img src={proxy(src)}
              className="max-w-[92vw] max-h-[85vh] rounded-2xl object-contain shadow-2xl transition-transform duration-200 cursor-zoom-in select-none"
              style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }}
              onClick={(e) => { e.stopPropagation(); toggleZoom(); }}
              alt="" />
            {images.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-3 z-10 text-white/60 hover:text-white text-3xl transition-colors select-none">›</button>
            )}
          </div>

          {/* Thumbnail strip */}
          {images.length > 1 && (
            <div className="flex justify-center gap-1.5 px-4 py-2 overflow-x-auto">
              {images.map((img, i) => (
                <img key={i} src={proxy(img)}
                  onClick={(e) => { e.stopPropagation(); setLightbox(i); setZoom(1); setPan({ x: 0, y: 0 }); }}
                  className={`w-12 h-12 rounded-lg object-cover cursor-pointer border-2 transition-all shrink-0 ${i === lightbox ? "border-white/80" : "border-transparent opacity-50 hover:opacity-80"}`}
                  alt="" />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
