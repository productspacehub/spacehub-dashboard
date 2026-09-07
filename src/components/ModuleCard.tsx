import Link from "next/link";
import type { ReactNode } from "react";

export function ModuleCard({
  label,
  dotColor,
  href,
  children,
}: {
  label: string;
  dotColor: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border p-6"
      style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
          {label}
        </span>
        <Link href={href} className="text-sm whitespace-nowrap hover:underline" style={{ color: "var(--series-1)" }}>
          Lihat detail →
        </Link>
      </div>
      {children}
    </div>
  );
}
