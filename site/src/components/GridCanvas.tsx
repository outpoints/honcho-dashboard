"use client";

import { useEffect, useRef } from "react";
import { useResolvedTheme } from "@/lib/theme";
import {
  LIFE_BUCKETS,
  LIFE_DWELL_MS,
  LIFE_FADE_PER_SEC,
  LIFE_GLOW_BOOST,
  LIFE_GLOW_RADIUS,
  LIFE_INNER_ALPHA,
  LIFE_INTENSITY_BOOST,
  LIFE_INTENSITY_PER_SEC,
  LIFE_OUTER_ALPHA,
  LIFE_PAINT_ALPHA,
  LIFE_PAINT_PATTERN_PROB,
  LIFE_PAINT_PATTERN_PROB_RICH,
  LIFE_PAINT_PATTERNS,
  LIFE_SHIMMER_RATE,
  LIFE_STEP_MS,
  createLife,
  stampLife,
  stepLife as advanceLife,
  type LifeState,
} from "@/lib/gameOfLife";

// Constants matched from the original site's compiled bundle.
const CELL = 20;
const DOT_SPACING = 80;
// The mouse trail is a fading paint under prefers-reduced-motion; with motion
// allowed it becomes the Game of Life trail instead (see lib/gameOfLife.ts).
const TRAIL_LIFETIME = 1200;
const TRAIL_FADE_IN = 150;
const TRAIL_FADE_OUT_START = 300;
const TRAIL_MOUSE_THROTTLE = 30;
const TRAIL_NEIGHBOR_PROB = 0.3;

// Canvas needs concrete color strings (it can't use CSS var()), and reading
// computed `--canvas-*` tokens on theme change races the provider's data-theme
// write (child effect fires before parent), so the canvas would lag one theme
// behind. Keying off the resolved theme value directly is race-free and matches
// the `--canvas-*` tokens in globals.css.
interface CanvasColors {
  bg: string;
  grid: string;
  dot: string;
  accent: string; // "r, g, b"
  trail: string; // "r, g, b"
}
const CANVAS_THEME: Record<"light" | "dark", CanvasColors> = {
  dark: {
    bg: "#0f0f0f",
    grid: "#1c1e23",
    dot: "#2a2d34",
    accent: "129, 191, 253",
    trail: "180, 217, 254",
  },
  light: {
    bg: "#efece4",
    grid: "#e4e1d9",
    dot: "#d7d3c8",
    accent: "41, 97, 201",
    trail: "111, 147, 191",
  },
};

interface TrailCell {
  x: number;
  y: number;
  startTime: number;
}

export function GridCanvas() {
  const resolvedTheme = useResolvedTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorsRef = useRef<CanvasColors>(CANVAS_THEME[resolvedTheme]);
  const refreshColorsRef = useRef<((theme: "light" | "dark") => void) | null>(
    null,
  );
  const trailRef = useRef<TrailCell[]>([]);
  const occupiedRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const lastMouseTickRef = useRef(0);
  // Game of Life trail state (motion allowed only).
  const lifeRef = useRef<LifeState | null>(null);
  const lifeAliveRef = useRef(false);
  const lifeBucketsRef = useRef<number[][]>(
    Array.from({ length: LIFE_BUCKETS }, () => []),
  );
  const lastLifeStepRef = useRef(0);
  const lastLifeAlphaRef = useRef(0);
  const mouseActiveRef = useRef(false);
  const mouseDownRef = useRef(false);
  const dwellRef = useRef(false);
  const intensityRef = useRef(0);
  const lastMouseMoveAtRef = useRef(0);
  const lastPaintCellRef = useRef({ col: -1, row: -1 });
  const rafRef = useRef(0);
  const resizeRafRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const offscreen = document.createElement("canvas");
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    let bgDirty = true;
    let lastW = 0;
    let lastH = 0;

    // Called by the theme effect with the new resolved theme: swap the cached
    // colors and repaint the background immediately.
    refreshColorsRef.current = (theme) => {
      colorsRef.current = CANVAS_THEME[theme];
      bgDirty = true;
      if (document.visibilityState === "visible") drawBackground();
    };

    const hasActivity = () =>
      trailRef.current.length > 0 || lifeAliveRef.current;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(window.innerWidth);
      const h = Math.round(window.innerHeight);
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (w === lastW && h === lastH && canvas.width === cw && canvas.height === ch) return;
      lastW = w;
      lastH = h;
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      offscreen.width = cw;
      offscreen.height = ch;
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The life grid is dense over the viewport, so a resize restarts it
      // rather than remapping cells (matches the official dashboard).
      lifeRef.current = createLife(Math.ceil(w / CELL), Math.ceil(h / CELL));
      lifeAliveRef.current = false;
      lastLifeStepRef.current = performance.now();
      lastLifeAlphaRef.current = performance.now();
      bgDirty = true;
    };

    const trackMouse = (now: number) => {
      const { x, y } = mouseRef.current;
      if (x < 0 || y < 0 || now - lastMouseTickRef.current < TRAIL_MOUSE_THROTTLE) return;
      lastMouseTickRef.current = now;
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      const occupied = occupiedRef.current;
      const key = `${cx},${cy}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        trailRef.current.push({ x: cx * CELL, y: cy * CELL, startTime: now });
      }
      if (Math.random() < TRAIL_NEIGHBOR_PROB) {
        const offsets: [number, number][] = [
          [-1, 0], [1, 0], [0, -1], [0, 1],
        ].sort(() => Math.random() - 0.5) as [number, number][];
        for (const [dx, dy] of offsets) {
          const nx = cx + dx;
          const ny = cy + dy;
          const nk = `${nx},${ny}`;
          if (!occupied.has(nk)) {
            occupied.add(nk);
            trailRef.current.push({ x: nx * CELL, y: ny * CELL, startTime: now });
            break;
          }
        }
      }
    };

    // Paints the cell under the cursor into the Game of Life grid. Called every
    // frame like the official dashboard: movement stamps sparse cells, while
    // dwelling (cursor still but present) or pressing the mouse stamps richer
    // blinker seeds at a brighter alpha.
    const paintLife = (now: number) => {
      const life = lifeRef.current;
      if (!life) return;
      dwellRef.current =
        mouseActiveRef.current && now - lastMouseMoveAtRef.current > LIFE_DWELL_MS;
      if (!mouseActiveRef.current) return;
      const { x, y } = mouseRef.current;
      if (x < 0 || y < 0) return;
      const col = Math.floor(x / CELL);
      const row = Math.floor(y / CELL);
      const last = lastPaintCellRef.current;
      if (col === last.col && row === last.row) return;
      lastPaintCellRef.current = { col, row };
      const rich = dwellRef.current || mouseDownRef.current;
      const pattern =
        Math.random() < (rich ? LIFE_PAINT_PATTERN_PROB_RICH : LIFE_PAINT_PATTERN_PROB)
          ? LIFE_PAINT_PATTERNS[Math.floor(Math.random() * LIFE_PAINT_PATTERNS.length)]
          : LIFE_PAINT_PATTERNS[0];
      stampLife(life, col, row, pattern, LIFE_PAINT_ALPHA);
      lifeAliveRef.current = true;
    };

    const stepLifeTick = (now: number) => {
      const life = lifeRef.current;
      if (!life || now - lastLifeStepRef.current < LIFE_STEP_MS) return;
      lastLifeStepRef.current = now;
      advanceLife(life);
    };

    const clearLife = () => {
      const life = lifeRef.current;
      if (!life) return;
      life.grid.fill(0);
      life.alpha.fill(0);
      lifeAliveRef.current = false;
    };

    // Advances per-cell render alpha (in while alive, out once dead), applies
    // the shimmer wave plus the dwell/press cursor glow, and draws cells in
    // alpha buckets so each bucket is two batched fills. Cell styling mirrors
    // the fading trail so the dots keep the same visual weight as before.
    const drawLife = (now: number) => {
      const life = lifeRef.current;
      if (!life) return;
      const { cols, rows, grid, alpha } = life;
      const dt = Math.min(0.1, Math.max(0, (now - lastLifeAlphaRef.current) / 1000));
      lastLifeAlphaRef.current = now;
      const delta = LIFE_FADE_PER_SEC * dt;

      const rich = dwellRef.current || mouseDownRef.current;
      intensityRef.current +=
        ((rich ? 1 : 0) - intensityRef.current) *
        (1 - Math.exp(-LIFE_INTENSITY_PER_SEC * dt));
      const intensity = intensityRef.current;
      const brightnessScale = 1 + LIFE_INTENSITY_BOOST * intensity;

      const mouse = mouseRef.current;
      const glow = mouseActiveRef.current && rich;
      const mouseCol = Math.floor(mouse.x / CELL);
      const mouseRow = Math.floor(mouse.y / CELL);

      const buckets = lifeBucketsRef.current;
      for (let b = 0; b < buckets.length; b++) buckets[b].length = 0;

      const phase = LIFE_SHIMMER_RATE * now;
      const radiusSq = LIFE_GLOW_RADIUS * LIFE_GLOW_RADIUS;
      let anyVisible = false;
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          const idx = col * rows + row;
          const current = alpha[idx];
          const next =
            grid[idx] === 1
              ? Math.min(1, current + delta)
              : Math.max(0, current - delta);
          if (next <= 0) continue;
          alpha[idx] = next;
          anyVisible = true;
          let n = (0.6 + 0.2 * Math.sin(phase + col + row)) * next;
          if (glow) {
            const dx = col - mouseCol;
            const dy = row - mouseRow;
            const distSq = dx * dx + dy * dy;
            if (distSq < radiusSq) {
              n = Math.min(
                1,
                n + LIFE_GLOW_BOOST * (1 - Math.sqrt(distSq) / LIFE_GLOW_RADIUS) * intensity,
              );
            }
          }
          const bucket = Math.min(LIFE_BUCKETS - 1, Math.floor(n * LIFE_BUCKETS));
          buckets[bucket].push(idx);
        }
      }
      lifeAliveRef.current = anyVisible;
      if (!anyVisible) return;

      const colors = colorsRef.current;
      for (let b = 0; b < buckets.length; b++) {
        const list = buckets[b];
        if (list.length === 0) continue;
        const shade = ((b + 0.5) / LIFE_BUCKETS) * brightnessScale;
        ctx.fillStyle = `rgba(${colors.accent}, ${(LIFE_OUTER_ALPHA * shade).toFixed(4)})`;
        ctx.beginPath();
        for (const idx of list) {
          ctx.rect(Math.floor(idx / rows) * CELL, (idx % rows) * CELL, CELL, CELL);
        }
        ctx.fill();
        ctx.fillStyle = `rgba(${colors.trail}, ${(LIFE_INNER_ALPHA * shade).toFixed(4)})`;
        ctx.beginPath();
        for (const idx of list) {
          ctx.rect(Math.floor(idx / rows) * CELL + 2, (idx % rows) * CELL + 2, CELL - 4, CELL - 4);
        }
        ctx.fill();
      }
    };

    const paintBackground = () => {
      if (!bgDirty) return;
      bgDirty = false;
      const w = window.innerWidth;
      const h = window.innerHeight;
      offCtx.fillStyle = colorsRef.current.bg;
      offCtx.fillRect(0, 0, w, h);
      offCtx.strokeStyle = colorsRef.current.grid;
      offCtx.lineWidth = 1;
      offCtx.beginPath();
      for (let x = 0; x <= w; x += CELL) {
        offCtx.moveTo(x + 0.5, 0);
        offCtx.lineTo(x + 0.5, h);
      }
      for (let y = 0; y <= h; y += CELL) {
        offCtx.moveTo(0, y + 0.5);
        offCtx.lineTo(w, y + 0.5);
      }
      offCtx.stroke();
      offCtx.fillStyle = colorsRef.current.dot;
      for (let x = 0; x <= w; x += DOT_SPACING) {
        for (let y = 0; y <= h; y += DOT_SPACING) {
          offCtx.beginPath();
          offCtx.arc(x, y, 1, 0, Math.PI * 2);
          offCtx.fill();
        }
      }
    };

    const drawBackground = () => {
      paintBackground();
      ctx.drawImage(offscreen, 0, 0);
    };

    const drawTrail = (now: number) => {
      const trail = trailRef.current;
      const occupied = occupiedRef.current;
      const keep: TrailCell[] = [];
      for (const c of trail) {
        const elapsed = now - c.startTime;
        if (elapsed >= TRAIL_LIFETIME) {
          occupied.delete(`${Math.floor(c.x / CELL)},${Math.floor(c.y / CELL)}`);
          continue;
        }
        keep.push(c);
        const fadeIn = Math.min(1, elapsed / TRAIL_FADE_IN);
        const fadeOut = elapsed > TRAIL_FADE_OUT_START
          ? Math.max(0, 1 - (elapsed - TRAIL_FADE_OUT_START) / (TRAIL_LIFETIME - TRAIL_FADE_OUT_START))
          : 1;
        const alpha = fadeIn * fadeOut;
        if (alpha > 0) {
          // Original trail fill weights (pre-GoL); the GoL cell constants in
          // lib/gameOfLife.ts are matched to the landing page instead.
          ctx.fillStyle = `rgba(${colorsRef.current.accent}, ${(0.18 * alpha).toFixed(4)})`;
          ctx.fillRect(c.x, c.y, CELL, CELL);
          ctx.fillStyle = `rgba(${colorsRef.current.trail}, ${(0.08 * alpha).toFixed(4)})`;
          ctx.fillRect(c.x + 2, c.y + 2, CELL - 4, CELL - 4);
        }
      }
      trailRef.current = keep;
    };

    const startActiveLoop = () => {
      if (document.visibilityState !== "visible" || rafRef.current !== 0) return;
      rafRef.current = requestAnimationFrame(tick);
    };

    const onResize = () => {
      if (resizeRafRef.current !== null) return;
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        resize();
        if (document.visibilityState !== "visible") return;
        if (hasActivity()) {
          startActiveLoop();
          return;
        }
        drawBackground();
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      mouseActiveRef.current = true;
      lastMouseMoveAtRef.current = performance.now();
      dwellRef.current = false;
      startActiveLoop();
    };

    const onMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
      mouseActiveRef.current = false;
      dwellRef.current = false;
      mouseDownRef.current = false;
      lastPaintCellRef.current = { col: -1, row: -1 };
    };

    const onMouseDown = () => {
      mouseDownRef.current = true;
    };

    const onMouseUp = () => {
      mouseDownRef.current = false;
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        if (rafRef.current !== 0) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        return;
      }
      if (hasActivity()) {
        startActiveLoop();
        return;
      }
      drawBackground();
    };

    const tick = (now: number) => {
      rafRef.current = 0;
      if (reducedMotionRef.current) {
        trackMouse(now);
      } else {
        paintLife(now);
        stepLifeTick(now);
      }
      if (bgDirty || hasActivity()) {
        drawBackground();
        if (reducedMotionRef.current) {
          drawTrail(now);
          // The mode can flip mid-session; drop any frozen life cells so the
          // loop can idle again (the background repaint erases them).
          if (lifeAliveRef.current) clearLife();
        } else {
          drawLife(now);
          if (trailRef.current.length > 0) {
            trailRef.current = [];
            occupiedRef.current.clear();
          }
        }
      }
      if (hasActivity() && document.visibilityState === "visible") {
        startActiveLoop();
      }
    };

    resize();
    drawBackground();

    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mousedown", onMouseDown, { passive: true });
    window.addEventListener("mouseup", onMouseUp, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      refreshColorsRef.current = null;
    };
  }, []);

  // Repaint the canvas background when the theme switches.
  useEffect(() => {
    refreshColorsRef.current?.(resolvedTheme);
  }, [resolvedTheme]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ backgroundColor: "var(--canvas-bg)" }}
    />
  );
}
