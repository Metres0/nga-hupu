interface GlassButtonProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "tonal";
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function GlassButton({ children, variant = "primary", size = "md", className = "", onClick, disabled = false }: GlassButtonProps) {
  const base = "ripple inline-flex items-center justify-center rounded-xl font-medium transition-all duration-[var(--duration-medium)] ease-standard border";
  const sizes: Record<string, string> = { sm: "px-3 py-1.5 text-label gap-1.5 h-8", md: "px-4 py-2 text-body-sm gap-2 h-10", lg: "px-5 py-2.5 text-body gap-2 h-11" };
  const variants: Record<string, string> = {
    primary: "bg-[var(--md-primary)] border-[var(--md-primary)] text-[var(--md-on-primary)] hover:shadow-elevated",
    tonal: "bg-[var(--md-primary-container)] border-transparent text-[var(--md-on-primary-container)] hover:shadow-card",
    secondary: "bg-[var(--surface-hover)] border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--surface-active)]",
    ghost: "bg-transparent border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer active:scale-[0.97]"} ${className}`}>
      {children}
    </button>
  );
}
