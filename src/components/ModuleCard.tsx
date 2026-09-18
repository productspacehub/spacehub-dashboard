import Link from "next/link";
import type { ReactNode } from "react";

export function ModuleCard({
  label,
  dotColor,
  href,
  loading = false,
  children,
}: {
  label: string;
  dotColor: string;
  href: string;
  // True while re-fetching over existing data (not the first load, which has
  // no content yet to dim) — shows a small spinner and dims the card body.
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border p-6"
      style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
          {label}
        </span>
        <div className="flex items-center gap-2">
          {loading && (
            <span
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current"
              style={{ borderTopColor: "transparent", color: "var(--series-1)" }}
              title="Memuat…"
            />
          )}
          <Link href={href} className="text-sm whitespace-nowrap hover:underline" style={{ color: "var(--series-1)" }}>
            Lihat detail →
          </Link>
        </div>
      </div>
      <div
        className="flex flex-col gap-3"
        style={{
          opacity: loading ? 0.5 : 1,
          transition: "opacity 150ms ease",
          pointerEvents: loading ? "none" : "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}
