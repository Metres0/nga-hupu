export function GlassSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-[var(--surface-hover)] animate-pulse ${className}`}>
      <div className="skeleton-shimmer absolute inset-0 rounded-xl" />
    </div>
  );
}

export function GlassSkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <GlassSkeleton key={i} className="min-h-20 rounded-2xl" />
      ))}
    </div>
  );
}

export function ImageSkeleton({ aspectRatio = "16/9", className = "" }: { aspectRatio?: string; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-[var(--bg-tertiary)] animate-pulse ${className}`}
      style={{ aspectRatio }}
    >
      <div className="skeleton-shimmer absolute inset-0 rounded-xl" />
    </div>
  );
}
