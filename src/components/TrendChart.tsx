type TrendPoint = { date: string; value: number };

export function TrendChart({ points, highlightDate }: { points: TrendPoint[]; highlightDate?: string }) {
  if (points.length < 2) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Belum cukup data untuk menampilkan tren (butuh minimal 2 hari snapshot).
      </p>
    );
  }

  const width = 860;
  const height = 140;
  const padTop = 12;
  const padBottom = 8;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.15, 1);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const range = max - min || 1;

  const xFor = (i: number) => (i / (points.length - 1)) * width;
  const yFor = (v: number) => padTop + (1 - (v - min) / range) * (height - padTop - padBottom);

  const linePoints = points.map((p, i) => `${xFor(i)},${yFor(p.value)}`).join(" ");
  const areaPoints = `${xFor(0)},${height} ${linePoints} ${xFor(points.length - 1)},${height}`;

  const lastIndex = points.length - 1;
  const highlightIndex = highlightDate ? points.findIndex((p) => p.date === highlightDate) : -1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
    >
      <line x1={0} y1={padTop} x2={width} y2={padTop} stroke="var(--gridline)" strokeWidth={1} />
      <line
        x1={0}
        y1={(height - padBottom + padTop) / 2}
        x2={width}
        y2={(height - padBottom + padTop) / 2}
        stroke="var(--gridline)"
        strokeWidth={1}
      />
      <line x1={0} y1={height - padBottom} x2={width} y2={height - padBottom} stroke="var(--gridline)" strokeWidth={1} />

      <polygon points={areaPoints} fill="var(--series-1)" opacity={0.12} />
      <polyline
        points={linePoints}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {highlightIndex >= 0 && highlightIndex !== lastIndex && (
        <circle
          cx={xFor(highlightIndex)}
          cy={yFor(points[highlightIndex].value)}
          r={4}
          fill="var(--surface-1)"
          stroke="var(--text-muted)"
          strokeWidth={2}
        />
      )}

      <circle
        cx={xFor(lastIndex)}
        cy={yFor(points[lastIndex].value)}
        r={5}
        fill="var(--series-1)"
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    </svg>
  );
}
