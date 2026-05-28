"use client";

import { useEffect, useRef } from "react";

// Constants matched from the original site's compiled bundle.
const CELL = 20;
const DOT_SPACING = 80;
const MAX_BURSTS = 8;
const BURST_FADE_IN = 1500;
const BURST_HOLD = 300;
const BURST_FADE_OUT = 2000;
const BURST_INTERVAL_MIN = 500;
const BURST_INTERVAL_MAX = 1500;
const BURST_NEIGHBOR_PROB = 0.4;
const BURST_MAX_DEPTH = 3;
const TRAIL_LIFETIME = 1200;
const TRAIL_FADE_IN = 150;
const TRAIL_FADE_OUT_START = 300;
const TRAIL_MOUSE_THROTTLE = 30;
const TRAIL_NEIGHBOR_PROB = 0.3;

const COLOR_BG = "#050505";
const COLOR_GRID = "#111111";
const COLOR_DOT = "#1A1A1A";

interface Burst {
  cells: { x: number; y: number }[];
  phase: "in" | "hold" | "out";
  opacity: number;
  startTime: number;
  fadeOutStart: number;
  shade: 0 | 1;
}

interface TrailCell {
  x: number;
  y: number;
  startTime: number;
}

export function GridCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const burstsRef = useRef<Burst[]>([]);
  const trailRef = useRef<TrailCell[]>([]);
  const occupiedRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const lastMouseTickRef = useRef(0);
  const lastBurstAtRef = useRef(0);
  const burstIntervalRef = useRef(1000);
  const rafRef = useRef(0);
  const resizeRafRef = useRef<number | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);
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

    const clearIdle = () => {
      if (idleTimeoutRef.current !== null) {
        window.clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
    };

    const hasActivity = () => burstsRef.current.length > 0 || trailRef.current.length > 0;

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
      bgDirty = true;
    };

    const spawnBurst = (now: number): Burst => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cols = Math.ceil(w / CELL);
      const rows = Math.ceil(h / CELL);
      const ox = Math.floor(Math.random() * cols);
      const oy = Math.floor(Math.random() * rows);
      const seen = new Set<string>();
      const cells: { x: number; y: number }[] = [];
      const dirs: [number, number][] = [
        [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1],
      ];
      const recur = (cx: number, cy: number, depth: number) => {
        const key = `${cx},${cy}`;
        if (seen.has(key) || cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
        seen.add(key);
        cells.push({ x: cx * CELL, y: cy * CELL });
        if (depth >= BURST_MAX_DEPTH) return;
        for (const [dx, dy] of dirs) {
          if (Math.random() < BURST_NEIGHBOR_PROB) recur(cx + dx, cy + dy, depth + 1);
        }
      };
      recur(ox, oy, 0);
      return { cells, phase: "in", opacity: 0, startTime: now, fadeOutStart: 0, shade: Math.random() < 0.6 ? 0 : 1 };
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

    const paintBackground = () => {
      if (!bgDirty) return;
      bgDirty = false;
      const w = window.innerWidth;
      const h = window.innerHeight;
      offCtx.fillStyle = COLOR_BG;
      offCtx.fillRect(0, 0, w, h);
      offCtx.strokeStyle = COLOR_GRID;
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
      offCtx.fillStyle = COLOR_DOT;
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

    const drawBursts = (now: number) => {
      const bursts = burstsRef.current;
      for (const b of bursts) {
        const elapsed = now - b.startTime;
        if (b.phase === "in") {
          b.opacity = Math.min(1, elapsed / BURST_FADE_IN);
          if (elapsed >= BURST_FADE_IN) {
            b.phase = "hold";
            b.opacity = 1;
          }
        } else if (b.phase === "hold") {
          if (elapsed >= BURST_FADE_IN + BURST_HOLD) {
            b.phase = "out";
            b.fadeOutStart = now;
          }
        } else if (b.phase === "out") {
          const ago = now - b.fadeOutStart;
          b.opacity = Math.max(0, 1 - ago / BURST_FADE_OUT);
        }
        if (b.opacity > 0) {
          const alphaBase = b.shade === 0 ? 0.08 : 0.15;
          ctx.fillStyle = `rgba(60, 130, 247, ${(alphaBase * b.opacity).toFixed(4)})`;
          for (const c of b.cells) ctx.fillRect(c.x, c.y, CELL, CELL);
        }
      }
      burstsRef.current = bursts.filter((b) => !(b.phase === "out" && b.opacity <= 0));
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
          ctx.fillStyle = `rgba(60, 130, 247, ${(0.18 * alpha).toFixed(4)})`;
          ctx.fillRect(c.x, c.y, CELL, CELL);
          ctx.fillStyle = `rgba(166, 198, 230, ${(0.08 * alpha).toFixed(4)})`;
          ctx.fillRect(c.x + 2, c.y + 2, CELL - 4, CELL - 4);
        }
      }
      trailRef.current = keep;
    };

    const maybeBurst = (now: number): boolean => {
      if (reducedMotionRef.current) return false;
      if (now - lastBurstAtRef.current < burstIntervalRef.current) return false;
      if (burstsRef.current.length < MAX_BURSTS) burstsRef.current.push(spawnBurst(now));
      lastBurstAtRef.current = now;
      burstIntervalRef.current = BURST_INTERVAL_MIN + Math.random() * (BURST_INTERVAL_MAX - BURST_INTERVAL_MIN);
      return true;
    };

    const startActiveLoop = () => {
      clearIdle();
      if (document.visibilityState !== "visible" || rafRef.current !== 0) return;
      rafRef.current = requestAnimationFrame(tick);
    };

    const startIdleTimer = () => {
      clearIdle();
      if (document.visibilityState !== "visible" || reducedMotionRef.current) return;
      const elapsed = performance.now() - lastBurstAtRef.current;
      const next = Math.max(0, burstIntervalRef.current - elapsed);
      idleTimeoutRef.current = window.setTimeout(() => {
        idleTimeoutRef.current = null;
        startActiveLoop();
      }, next);
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
        startIdleTimer();
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      startActiveLoop();
    };

    const onMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        clearIdle();
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
      startIdleTimer();
    };

    const tick = (now: number) => {
      rafRef.current = 0;
      const burst = maybeBurst(now);
      trackMouse(now);
      if (bgDirty || burst || hasActivity()) {
        drawBackground();
        drawBursts(now);
        drawTrail(now);
      }
      if (document.visibilityState === "visible") {
        if (hasActivity()) {
          startActiveLoop();
          return;
        }
        startIdleTimer();
      }
    };

    lastBurstAtRef.current = performance.now();
    resize();
    drawBackground();
    startIdleTimer();

    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
      clearIdle();
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ backgroundColor: COLOR_BG }}
    />
  );
}
