export function DeltaBadge({ value, label }: { value: number | null; label?: string }) {
  if (value === null) return null;

  if (value === 0) {
    return (
      <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
        ±0{label ? ` ${label}` : ""}
      </span>
    );
  }

  const up = value > 0;
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        color: up ? "var(--status-good)" : "var(--status-critical)",
        background: up ? "rgba(11, 170, 159, 0.14)" : "rgba(240, 122, 166, 0.14)",
      }}
    >
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {value}
      {label ? ` ${label}` : ""}
    </span>
  );
}
