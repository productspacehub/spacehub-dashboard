export function Meter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className="h-2 w-full rounded-full"
      style={{ background: "var(--series-1-track)" }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-2 rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: "var(--series-1)" }}
      />
    </div>
  );
}
