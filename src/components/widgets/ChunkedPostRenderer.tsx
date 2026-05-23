"use client";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

interface ChunkedPostRendererProps {
  html: string;
  maxChunkSize?: number;
}

function splitIntoChunks(html: string, maxSize: number): string[] {
  if (html.length <= maxSize) return [html];

  const chunks: string[] = [];
  const parts = html.split(/(<\/p>|<\/div>|<br\s*\/?>|<br>)/gi);

  let current = "";
  for (let i = 0; i < parts.length; i++) {
    if (current.length + parts[i].length > maxSize && current.length > 0) {
      chunks.push(current);
      current = parts[i];
    } else {
      current += parts[i];
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

export default function ChunkedPostRenderer({ html, maxChunkSize = 5000 }: ChunkedPostRendererProps) {
  if (!html) return <span className="text-white/30 italic">(无内容)</span>;

  const chunks = splitIntoChunks(html, maxChunkSize);

  return (
    <ErrorBoundary
      fallback={
        <div className="p-3 rounded-lg bg-white/5 border border-red-400/20">
          <p className="text-red-300/60 text-xs">内容渲染失败</p>
        </div>
      }
    >
      {chunks.map((chunk, i) => (
        <div
          key={i}
          className="chunked-content"
          style={{ contentVisibility: i > 0 ? "auto" : "visible", containIntrinsicSize: "auto 200px" }}
          dangerouslySetInnerHTML={{ __html: chunk }}
        />
      ))}
    </ErrorBoundary>
  );
}
