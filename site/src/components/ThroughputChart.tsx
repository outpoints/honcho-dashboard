"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type Timeframe = "1H" | "6H" | "24H" | "7D";

export interface ThroughputPoint {
  timestamp: string;
  reads: number;
  writes: number;
  deletes: number;
  latency: number;
}

export const SERIES_COLORS = {
  reads: { line: "#3C82F7", fill: "rgba(60, 130, 247, 0.15)" },
  writes: { line: "#60A5FA", fill: "rgba(96, 165, 250, 0.12)" },
  deletes: { line: "#F87171", fill: "rgba(248, 113, 113, 0.10)" },
} as const;

const VARIANCE: Record<Timeframe, number> = { "1H": 1.1, "6H": 2.4, "24H": 3.8, "7D": 5.2 };
const BUCKETS = 28;
const ANIM_MS = 360;

const easeOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (n: number, a: number, b: number) => Math.min(Math.max(n, a), b);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seed = (a: number) => {
  const r = Math.sin(a * 12.9898 + 78.233) * 43758.5453123;
  return r - Math.floor(r);
};

function formatTime(tf: Timeframe, idx: number, total: number): string {
  const t = idx / (total - 1);
  if (tf === "1H") {
    const m = Math.round(lerp(60, 0, t));
    return m === 0 ? "now" : `-${m}m`;
  }
  if (tf === "6H") {
    const h = lerp(6, 0, t);
    return h <= 0.2 ? "now" : `-${h.toFixed(h >= 1 ? 0 : 1)}h`;
  }
  if (tf === "24H") {
    const h = Math.round(lerp(24, 0, t));
    return h === 0 ? "now" : `-${h}h`;
  }
  const d = Math.round(lerp(7, 0, t));
  return d === 0 ? "today" : `-${d}d`;
}

export function genSeries(tf: Timeframe): ThroughputPoint[] {
  const v = VARIANCE[tf];
  const r1 = tf === "1H" ? 0.75 : tf === "6H" ? 0.95 : tf === "24H" ? 1.1 : 1.28;
  const r2 = tf === "7D" ? 1.4 : tf === "24H" ? 1.1 : 0.85;
  return Array.from({ length: BUCKETS }, (_, i) => {
    const f = i / (BUCKETS - 1);
    const g = Math.sin(f * Math.PI * (3.3 + v) + v * 0.6);
    const p = Math.cos(f * Math.PI * (7.4 + v * 0.8) - v * 0.35);
    const x = Math.sin(f * Math.PI) * 18;
    const y = Math.max(0, Math.sin(f * Math.PI * 5.1 + v)) * 16;
    const j = seed(i * 19.7 + v * 13.1) - 0.5;
    const k = seed(i * 23.3 + v * 7.9) - 0.5;
    const reads = Math.round(88 * r1 + g * 26 + p * 11 + x + y + j * 18);
    const writes = Math.round(51 * r1 + g * 15 + p * 8 + x * 0.55 + y * 0.45 + k * 12);
    const deletes = Math.round(10 * r2 + Math.max(0, p) * 7 + k * 4 + (tf === "7D" ? Math.sin(f * Math.PI * 2.2 + v) * 3 : 0));
    const latency = Math.round(12 + Math.abs(g) * 5 + Math.max(0, p) * 3 + seed(i * 29.1 + v * 11.7) * 4);
    return {
      timestamp: formatTime(tf, i, BUCKETS),
      reads: Math.max(24, reads),
      writes: Math.max(14, writes),
      deletes: Math.max(1, deletes),
      latency: Math.max(5, latency),
    };
  });
}

interface Props {
  timeframe: Timeframe;
  visible: { reads: boolean; writes: boolean; deletes: boolean };
  data?: ThroughputPoint[];
}

interface Hovered {
  x: number;
  y: number;
  point: ThroughputPoint;
  index: number;
}

export function ThroughputChart({ timeframe, visible, data: externalData }: Props) {
  const targetSeries = useMemo(
    () => (externalData && externalData.length > 0 ? externalData : genSeries(timeframe)),
    [externalData, timeframe],
  );
  const [data, setData] = useState<ThroughputPoint[]>(targetSeries);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 600, height: 280 });
  const fromRef = useRef<ThroughputPoint[]>(targetSeries);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = targetSeries;
    const start = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const p = clamp((now - start) / ANIM_MS, 0, 1);
      const eased = easeOutCubic(p);
      const interp = to.map((dst, i) => {
        const src = from[i] ?? from[from.length - 1] ?? dst;
        return {
          timestamp: dst.timestamp,
          reads: lerp(src.reads, dst.reads, eased),
          writes: lerp(src.writes, dst.writes, eased),
          deletes: lerp(src.deletes, dst.deletes, eased),
          latency: lerp(src.latency, dst.latency, eased),
        };
      });
      setData(interp);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [targetSeries]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox({ width: Math.max(rect.width, 240), height: 280 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width: W, height: H } = box;
  const P = { top: 16, right: 4, bottom: 28, left: 36 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;
  const maxValue = useMemo(() => {
    const all = data.flatMap((d) => {
      const arr: number[] = [];
      if (visible.reads) arr.push(d.reads);
      if (visible.writes) arr.push(d.writes);
      if (visible.deletes) arr.push(d.deletes);
      return arr;
    });
    return Math.max(...all, 1) * 1.15;
  }, [data, visible]);
  const yTicks = useMemo(() => [1, 0.75, 0.5, 0.25, 0].map((r) => Math.round(maxValue * r)), [maxValue]);

  const x = (i: number) => (data.length <= 1 ? P.left : P.left + (i / (data.length - 1)) * innerW);
  const y = (v: number) => P.top + innerH * (1 - v / maxValue);

  const buildLine = (key: keyof typeof SERIES_COLORS) => {
    if (data.length === 0) return "";
    let d = `M ${x(0)} ${y(data[0][key])}`;
    for (let i = 1; i < data.length; i++) {
      const py = y(data[i - 1][key]);
      const xi = x(i);
      const yi = y(data[i][key]);
      d += ` L ${xi} ${py} L ${xi} ${yi}`;
    }
    return d;
  };
  const buildArea = (key: keyof typeof SERIES_COLORS) => {
    const line = buildLine(key);
    if (!line) return "";
    const baseY = H - P.bottom;
    return `${line} L ${x(data.length - 1)} ${baseY} L ${x(0)} ${baseY} Z`;
  };

  const onCellHover = (e: React.MouseEvent<SVGRectElement>, idx: number) => {
    const svg = (e.currentTarget as SVGElement).closest("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setHovered({ x: e.clientX - rect.left, y: e.clientY - rect.top, point: data[idx], index: idx });
  };

  const series: { key: keyof typeof SERIES_COLORS; visible: boolean }[] = [
    { key: "deletes", visible: visible.deletes },
    { key: "writes", visible: visible.writes },
    { key: "reads", visible: visible.reads },
  ];

  return (
    <div ref={wrapRef} className="relative bg-void/30 border border-border overflow-hidden" style={{ height: 280 }}>
      <div
        className="absolute left-0 flex flex-col justify-between pr-2 z-10"
        style={{ top: P.top, bottom: P.bottom, width: P.left - 4 }}
      >
        {yTicks.map((t, i) => (
          <span key={`${t}-${i}`} className="text-[9px] text-text-muted text-right leading-none">
            {t}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full block"
        style={{ height: "100%" }}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <filter id="glowAccent" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((r) => {
          const yy = y(maxValue * r);
          return (
            <line
              key={r}
              x1={P.left}
              y1={yy}
              x2={W - P.right}
              y2={yy}
              stroke="#1A1A1A"
              strokeWidth="1"
              strokeDasharray={r === 0.5 ? "none" : "2,4"}
              opacity={r === 0.5 ? 0.6 : 0.3}
            />
          );
        })}
        <line x1={P.left} y1={H - P.bottom} x2={W - P.right} y2={H - P.bottom} stroke="#262626" strokeWidth="1" />

        <AnimatePresence mode="sync">
          {series.map((s) =>
            s.visible ? (
              <motion.path
                key={`area-${s.key}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                d={buildArea(s.key)}
                fill={SERIES_COLORS[s.key].fill}
              />
            ) : null,
          )}
        </AnimatePresence>

        <AnimatePresence mode="sync">
          {series.map((s) =>
            s.visible ? (
              <motion.path
                key={`line-${s.key}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                d={buildLine(s.key)}
                fill="none"
                stroke={SERIES_COLORS[s.key].line}
                strokeWidth={s.key === "reads" ? 2 : 1.5}
                strokeLinecap="square"
                filter={s.key === "reads" ? "url(#glowAccent)" : undefined}
              />
            ) : null,
          )}
        </AnimatePresence>

        {data.map((pt, i) => {
          const cx = x(i);
          const cellW = innerW / Math.max(data.length, 1);
          return (
            <g key={`hit-${timeframe}-${i}`}>
              <rect
                x={cx - cellW / 2}
                y={P.top}
                width={cellW}
                height={innerH}
                fill="transparent"
                onMouseMove={(e) => onCellHover(e, i)}
                className="cursor-crosshair"
              />
              {hovered?.index === i ? (
                <>
                  <line
                    x1={cx}
                    y1={P.top}
                    x2={cx}
                    y2={H - P.bottom}
                    stroke="#3C82F7"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                    opacity="0.6"
                  />
                  {visible.reads ? (
                    <circle cx={cx} cy={y(pt.reads)} r="5" fill="#050505" stroke={SERIES_COLORS.reads.line} strokeWidth="2" />
                  ) : null}
                  {visible.writes ? (
                    <circle cx={cx} cy={y(pt.writes)} r="5" fill="#050505" stroke={SERIES_COLORS.writes.line} strokeWidth="2" />
                  ) : null}
                  {visible.deletes ? (
                    <circle cx={cx} cy={y(pt.deletes)} r="5" fill="#050505" stroke={SERIES_COLORS.deletes.line} strokeWidth="2" />
                  ) : null}
                </>
              ) : null}
            </g>
          );
        })}

        {data.map((pt, i) => {
          const step = Math.max(1, Math.ceil(data.length / 7));
          if (i !== 0 && i !== data.length - 1 && i % step !== 0) return null;
          return (
            <text
              key={`label-${i}`}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fill="#737373"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
            >
              {pt.timestamp}
            </text>
          );
        })}
      </svg>

      <AnimatePresence>
        {hovered ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute z-20 pointer-events-none"
            style={{ left: Math.min(Math.max(hovered.x + 12, 10), Math.max(W - 200, 10)), top: Math.max(hovered.y - 90, 10) }}
          >
            <div className="bg-surface border border-accent/50 p-3 shadow-lg shadow-accent/10">
              <div className="text-[10px] text-accent mb-2 pb-1 border-b border-border">{hovered.point.timestamp}</div>
              <div className="space-y-1.5">
                {visible.reads ? (
                  <Row color={SERIES_COLORS.reads.line} label="reads" value={Math.round(hovered.point.reads).toLocaleString()} />
                ) : null}
                {visible.writes ? (
                  <Row color={SERIES_COLORS.writes.line} label="writes" value={Math.round(hovered.point.writes).toLocaleString()} />
                ) : null}
                {visible.deletes ? (
                  <Row color={SERIES_COLORS.deletes.line} label="deletes" value={Math.round(hovered.point.deletes).toLocaleString()} />
                ) : null}
                <div className="flex items-center justify-between gap-4 pt-1 border-t border-border">
                  <span className="text-[10px] text-text-muted">latency</span>
                  <span className="text-xs text-text-primary">{Math.round(hovered.point.latency)}ms</span>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2" style={{ backgroundColor: color }} />
        <span className="text-[10px] text-text-muted">{label}</span>
      </span>
      <span className="text-xs text-text-primary">{value}</span>
    </div>
  );
}
