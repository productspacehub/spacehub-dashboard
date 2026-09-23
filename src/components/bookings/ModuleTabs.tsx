"use client";

import Link from "next/link";
import type { ModuleType } from "@/lib/bookings";

const TABS: { moduleType: ModuleType; href: string; label: string }[] = [
  { moduleType: "shared_storage", href: "/bookings", label: "Shared Storage" },
  { moduleType: "co_working", href: "/bookings/coworking", label: "Co-working" },
];

// Switches between the Booking tool's modules — each gets its own list/create
// pages (different fields: Container vs Addons), but they're one tool, not
// separate apps, since they share the same customer base and admin patterns.
export function ModuleTabs({ active }: { active: ModuleType }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {TABS.map((tab) => {
        const isActive = tab.moduleType === active;
        return (
          <Link
            key={tab.moduleType}
            href={tab.href}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: isActive ? "var(--series-1)" : "transparent",
              color: isActive ? "var(--background)" : "var(--text-secondary)",
              border: isActive ? "none" : "1px solid var(--gridline)",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
