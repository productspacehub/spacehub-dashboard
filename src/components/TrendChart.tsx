"use client";

import { useState } from "react";

type TrendPoint = { date: string; value: number };

function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

// Nice round tick values spanning [min, max] — same "snap to 1/2/5×10^n" idea
// used for currency/count axes elsewhere in the app, generalized to whatever
// step size actually separates this particular range (occupied-unit counts
// move in a narrow band, so forcing round hundreds would collapse to 1 tick).
function niceTicks(min: number, max: number, targetCount = 3): number[] {
  if (min === max) return [Math.round(min)];
  const rawStep = (max - min) / (targetCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v));
  return ticks;
}

export function TrendChart({ points, highlightDate }: { points: TrendPoint[]; highlightDate?: string }) {
  const [hover, setHover] = useState<{ index: number; left: number } | null>(null);

  if (points.length < 2) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Belum cukup data untuk menampilkan tren (butuh minimal 2 hari snapshot).
      </p>
    );
  }

  // Internal SVG coordinate system. The SVG stretches horizontally to 100% of
  // its container (non-uniform scaling), so only shapes live inside it — every
  // piece of text is a separately-positioned HTML element overlaid on top
  // (`xPct`/yFor below), because SVG <text> at a fixed font-size gets squashed
  // illegibly by that same non-uniform stretch on narrow screens.
  const width = 860;
  const height = 140;
  const padTop = 16;
  const padBottom = 8;
  const padLeft = 30;
  const plotWidth = width - padLeft;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.15, 1);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const range = max - min || 1;

  const xFor = (i: number) => padLeft + (i / (points.length - 1)) * plotWidth;
  const yFor = (v: number) => padTop + (1 - (v - min) / range) * (height - padTop - padBottom);
  // Percent-of-width position for an HTML overlay element — safe under the
  // SVG's non-uniform stretch because the overlay shares the same container.
  const xPct = (i: number) => (xFor(i) / width) * 100;

  const linePoints = points.map((p, i) => `${xFor(i)},${yFor(p.value)}`).join(" ");
  const areaPoints = `${xFor(0)},${height} ${linePoints} ${xFor(points.length - 1)},${height}`;

  const lastIndex = points.length - 1;
  const highlightIndex = highlightDate ? points.findIndex((p) => p.date === highlightDate) : -1;
  const showHighlight = highlightIndex >= 0 && highlightIndex !== lastIndex;

  const ticks = niceTicks(rawMin, rawMax).filter((t) => t >= min && t <= max);

  // The end label and the highlight label can land close enough together (e.g.
  // comparing against "kemarin") to collide if both sit above their dots —
  // push the highlight label below its dot whenever it's within ~2 days of
  // the endpoint.
  const highlightBelow = showHighlight && xFor(lastIndex) - xFor(highlightIndex) < plotWidth * 0.08;

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const svgX = (relX / rect.width) * width;
    const ratio = (svgX - padLeft) / plotWidth;
    const index = Math.min(lastIndex, Math.max(0, Math.round(ratio * lastIndex)));
    // Clamp against this container's real rendered width (not the SVG's
    // internal viewBox units) so the tooltip never runs past either edge.
    const clampedLeft = Math.min(Math.max(relX, 50), rect.width - 50);
    setHover({ index, left: clampedLeft });
  }

  const hoverPoint = hover ? points[hover.index] : null;

  return (
    <div
      className="relative"
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      style={{ touchAction: "none" }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {ticks.map((t) => (
          <line
            key={t}
            x1={padLeft}
            y1={yFor(t)}
            x2={width}
            y2={yFor(t)}
            stroke="var(--gridline)"
            strokeWidth={1}
          />
        ))}

        <polygon points={areaPoints} fill="var(--series-1)" opacity={0.12} />
        <polyline
          points={linePoints}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {hover && (
          <line
            x1={xFor(hover.index)}
            y1={padTop}
            x2={xFor(hover.index)}
            y2={height - padBottom}
            stroke="var(--text-muted)"
            strokeWidth={1}
          />
        )}

        {showHighlight && (
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

        {hover && (
          <circle cx={xFor(hover.index)} cy={yFor(hoverPoint!.value)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
        )}
      </svg>

      {/* Y-axis tick labels — anchored by their right edge at the same
          percent-of-width as the plot's left padding, so they never overlap
          the line regardless of the container's actual pixel width. */}
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute text-[10px] whitespace-nowrap"
          style={{
            right: `calc(100% - ${(padLeft / width) * 100}% + 4px)`,
            top: `${yFor(t)}px`,
            transform: "translateY(-50%)",
            color: "var(--text-muted)",
          }}
        >
          {t.toLocaleString("id-ID")}
        </span>
      ))}

      {/* X-axis start/end date labels */}
      <span
        className="absolute text-[10px] whitespace-nowrap"
        style={{ left: `${xPct(0)}%`, top: 0, color: "var(--text-muted)" }}
      >
        {formatDateLabel(points[0].date)}
      </span>
      <span
        className="absolute text-[10px] whitespace-nowrap"
        style={{ left: `${xPct(lastIndex)}%`, top: 0, transform: "translateX(-100%)", color: "var(--text-muted)" }}
      >
        {formatDateLabel(points[lastIndex].date)}
      </span>

      {/* Direct value labels — endpoint and (if selected) the comparison point */}
      {showHighlight && (
        <span
          className="absolute text-xs font-semibold whitespace-nowrap"
          style={{
            left: `${xPct(highlightIndex)}%`,
            top: `${yFor(points[highlightIndex].value) + (highlightBelow ? 8 : -10)}px`,
            transform: `translate(-50%, ${highlightBelow ? "0" : "-100%"})`,
            color: "var(--text-secondary)",
          }}
        >
          {points[highlightIndex].value.toLocaleString("id-ID")}
        </span>
      )}
      <span
        className="absolute text-xs font-semibold whitespace-nowrap"
        style={{
          left: `${xPct(lastIndex)}%`,
          top: `${yFor(points[lastIndex].value) - 10}px`,
          transform: "translate(-100%, -100%)",
          color: "var(--text-primary)",
        }}
      >
        {points[lastIndex].value.toLocaleString("id-ID")}
      </span>

      {hoverPoint && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{
            left: hover!.left,
            background: "var(--surface-1)",
            borderColor: "var(--gridline)",
          }}
        >
          <p style={{ color: "var(--text-muted)" }}>{formatDateLabel(hoverPoint.date)}</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {hoverPoint.value.toLocaleString("id-ID")} unit
          </p>
        </div>
      )}
    </div>
  );
}
