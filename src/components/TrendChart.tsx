"use client";

import { useState } from "react";

// note: an extra line in the hover tooltip (e.g. the unit count behind a rate).
type TrendPoint = { date: string; value: number; note?: string };

const defaultFormat = (v: number) => v.toLocaleString("id-ID");

function formatDateLabel(dateStr: string, withYear = false): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

// Whole days since the epoch for a "YYYY-MM-DD" — the x position is by date,
// so a day with no snapshot leaves a gap instead of silently closing it up.
const dayNumber = (date: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

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
  // Round to the step's own precision: whole numbers for unit counts, a
  // decimal for a narrow band of percentages, without float noise (0.30000004).
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Number(v.toFixed(decimals)));
  return ticks;
}

export function TrendChart({
  points,
  highlightDate,
  formatValue = defaultFormat,
  formatTick = formatValue,
  unitSuffix = " unit",
  compact = false,
  domain,
}: {
  points: TrendPoint[];
  highlightDate?: string;
  formatValue?: (v: number) => string;
  // Y-axis labels; defaults to formatValue.
  formatTick?: (v: number) => string;
  // Appended to the value in the hover tooltip only.
  unitSuffix?: string;
  // Small card version: shorter, no axis labels (the card states the range
  // and values; hover still works). Its viewBox is close to a card's real
  // width so dots stay round.
  compact?: boolean;
  // Date range of the x axis ("YYYY-MM-DD"), when it should be wider than the
  // points — e.g. a location whose history starts later than the others.
  domain?: { start: string; end: string };
}) {
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
  const width = compact ? 300 : 860;
  const height = compact ? 84 : 140;
  const padTop = compact ? 26 : 16;
  const padBottom = 8;
  const padLeft = compact ? 4 : 30;
  const plotWidth = width - padLeft;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.15, 1);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const range = max - min || 1;

  const firstDay = Math.min(dayNumber(points[0].date), domain ? dayNumber(domain.start) : Infinity);
  const lastDay = Math.max(dayNumber(points[points.length - 1].date), domain ? dayNumber(domain.end) : -Infinity);
  const spanDays = Math.max(1, lastDay - firstDay);
  const dayOffsets = points.map((p) => dayNumber(p.date) - firstDay);
  const xFor = (i: number) => padLeft + (dayOffsets[i] / spanDays) * plotWidth;
  // Show the year on the axis/tooltip once the range is long enough to be ambiguous.
  const withYear = points[0].date.slice(0, 4) !== points[points.length - 1].date.slice(0, 4) || spanDays > 300;
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
  // A comparison point at (or near) the left edge — e.g. the chart starting at
  // the chosen date — anchors its label by the left edge so it isn't cut off.
  const highlightAtStart = showHighlight && xFor(highlightIndex) - padLeft < plotWidth * 0.04;

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const svgX = (relX / rect.width) * width;
    const day = ((svgX - padLeft) / plotWidth) * spanDays;
    let index = 0;
    for (let i = 1; i < dayOffsets.length; i++) {
      if (Math.abs(dayOffsets[i] - day) < Math.abs(dayOffsets[index] - day)) index = i;
    }
    // Clamp against this container's real rendered width (not the SVG's
    // internal viewBox units) so the tooltip never runs past either edge.
    const clampedLeft = Math.min(Math.max(relX, 50), rect.width - 50);
    setHover({ index, left: clampedLeft });
  }

  const hoverPoint = hover ? points[hover.index] : null;

  return (
    <div
      className={compact ? "relative" : "relative pb-5"}
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
      {!compact &&
        ticks.map((t) => (
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
            {formatTick(t)}
          </span>
        ))}

      {/* X-axis start/end date labels, under the plot so they never collide
          with the value labels above the line. */}
      {!compact && (
        <>
          <span
            className="absolute text-[10px] whitespace-nowrap"
            style={{ left: `${xPct(0)}%`, top: `${height + 4}px`, color: "var(--text-muted)" }}
          >
            {formatDateLabel(points[0].date, withYear)}
          </span>
          <span
            className="absolute text-[10px] whitespace-nowrap"
            style={{ left: `${xPct(lastIndex)}%`, top: `${height + 4}px`, transform: "translateX(-100%)", color: "var(--text-muted)" }}
          >
            {formatDateLabel(points[lastIndex].date, withYear)}
          </span>
        </>
      )}

      {/* Direct value labels — endpoint and (if selected) the comparison point */}
      {showHighlight && (
        <span
          className="absolute text-xs font-semibold whitespace-nowrap"
          style={{
            left: `${xPct(highlightIndex)}%`,
            top: `${yFor(points[highlightIndex].value) + (highlightBelow ? 8 : -10)}px`,
            transform: `translate(${highlightAtStart ? "0" : "-50%"}, ${highlightBelow ? "0" : "-100%"})`,
            color: "var(--text-secondary)",
          }}
        >
          {formatValue(points[highlightIndex].value)}
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
        {formatValue(points[lastIndex].value)}
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
          <p style={{ color: "var(--text-muted)" }}>{formatDateLabel(hoverPoint.date, withYear)}</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatValue(hoverPoint.value)}
            {unitSuffix}
          </p>
          {hoverPoint.note && <p style={{ color: "var(--text-muted)" }}>{hoverPoint.note}</p>}
        </div>
      )}
    </div>
  );
}
