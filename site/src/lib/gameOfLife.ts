// Conway's Game of Life for the background canvas (GridCanvas.tsx).
//
// The behavior is matched from the official Honcho dashboard's compiled bundle
// (app.honcho.dev, module 98143): mouse movement paints cells into a toroidal
// B3/S23 grid, generations advance on a fixed cadence, and per-cell alpha fades
// smoothly in while alive and out once dead. Their frame counters assume 60fps;
// here everything is wall-clock so the cadence holds on any refresh rate.
//
// Grids are flat arrays indexed `col * rows + row`; 1 = alive, 0 = dead.

// One deliberate deviation: the official keeps an ambient population alive and
// lives with immortal blinkers/still-lifes; a dashboard background must go
// quiet, so a small per-generation mortality makes every colony decay.

/** Milliseconds between generations (90 frames @ 60fps in the original). */
export const LIFE_STEP_MS = 900;
/** Alpha units per second while fading in (alive) or out (dead). */
export const LIFE_FADE_PER_SEC = 5;
/** Chance a live cell dies at random each generation — guarantees colonies
 * (blinkers, still-lifes, gliders, line interiors) dissipate within a few
 * seconds of the cursor moving on. */
export const LIFE_MORTALITY_PROB = 0.18;
/** Cursor still (but present) for this long counts as dwelling. */
export const LIFE_DWELL_MS = 300;
/** Chance a paint stamps a blinker instead of a single cell. */
export const LIFE_PAINT_PATTERN_PROB = 0.02;
/** Same, while dwelling or pressing the mouse. */
export const LIFE_PAINT_PATTERN_PROB_RICH = 0.08;
/** Alpha a freshly painted cell jumps to. */
export const LIFE_PAINT_ALPHA = 0.15;
/** Same, while dwelling or pressing the mouse. */
export const LIFE_PAINT_ALPHA_RICH = 0.4;
/** Cells within this radius of the cursor are brightened while dwelling. */
export const LIFE_GLOW_RADIUS = 4;
/** Maximum alpha added by the cursor glow, at the cursor itself. */
export const LIFE_GLOW_BOOST = 0.15;
/** Dwell-intensity smoothing rate (their 0.03/frame @ 60fps). */
export const LIFE_INTENSITY_PER_SEC = 1.8;
/** Maximum global brightness lift from dwelling/pressing. */
export const LIFE_INTENSITY_BOOST = 0.25;
/** Shimmer wave phase advance, radians per millisecond. */
export const LIFE_SHIMMER_RATE = 0.0006;
/** Outer cell fill alpha at full brightness (matches the old trail fill). */
export const LIFE_OUTER_ALPHA = 0.18;
/** Inner cell fill alpha at full brightness. */
export const LIFE_INNER_ALPHA = 0.08;
/** Alpha quantization buckets for batched canvas fills. */
export const LIFE_BUCKETS = 10;
/** Live cells above this fraction of the grid triggers a cull. */
export const LIFE_CULL_RATIO = 0.5;
/** Fraction of live cells killed by a cull. */
export const LIFE_CULL_KILL = 0.3;

/** Paint shapes: a dot, a horizontal blinker, a vertical blinker. */
export const LIFE_PAINT_PATTERNS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0]],
  [[0, 0], [-1, 0], [1, 0]],
  [[0, 0], [0, -1], [0, 1]],
];

export interface LifeState {
  cols: number;
  rows: number;
  /** Current generation; 1 = alive. */
  grid: Uint8Array;
  /** Scratch buffer for the next generation. */
  next: Uint8Array;
  /** Smoothed render alpha per cell, 0..1. */
  alpha: Float32Array;
}

export function createLife(cols: number, rows: number): LifeState {
  return {
    cols,
    rows,
    grid: new Uint8Array(cols * rows),
    next: new Uint8Array(cols * rows),
    alpha: new Float32Array(cols * rows),
  };
}

/** Number of currently live cells. */
export function liveCount(life: LifeState): number {
  let live = 0;
  for (let i = 0; i < life.grid.length; i++) live += life.grid[i];
  return live;
}

/**
 * Population cap: when live cells exceed `LIFE_CULL_RATIO` of the grid,
 * randomly clear `LIFE_CULL_KILL` of them so colonies cannot choke the screen.
 */
export function cullLife(life: LifeState, rand: () => number = Math.random): number {
  const total = life.cols * life.rows;
  if (liveCount(life) <= total * LIFE_CULL_RATIO) return 0;
  let killed = 0;
  for (let i = 0; i < life.grid.length; i++) {
    if (life.grid[i] === 1 && rand() < LIFE_CULL_KILL) {
      life.grid[i] = 0;
      killed++;
    }
  }
  return killed;
}

/**
 * Advance one generation under B3/S23 with toroidal wrap, in place, after the
 * population cull and a per-cell mortality roll. `rand` is injectable for tests.
 */
export function stepLife(life: LifeState, rand: () => number = Math.random): void {
  const { cols, rows, grid, next } = life;
  cullLife(life, rand);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1 && rand() < LIFE_MORTALITY_PROB) grid[i] = 0;
  }
  for (let col = 0; col < cols; col++) {
    const colUp = (col - 1 + cols) % cols;
    const colDown = (col + 1) % cols;
    const c0 = colUp * rows;
    const c1 = col * rows;
    const c2 = colDown * rows;
    for (let row = 0; row < rows; row++) {
      const rowUp = (row - 1 + rows) % rows;
      const rowDown = (row + 1) % rows;
      const neighbors =
        grid[c0 + rowUp] + grid[c0 + row] + grid[c0 + rowDown] +
        grid[c1 + rowUp] + grid[c1 + rowDown] +
        grid[c2 + rowUp] + grid[c2 + row] + grid[c2 + rowDown];
      const idx = c1 + row;
      next[idx] = grid[idx] === 1 ? (neighbors < 2 || neighbors > 3 ? 0 : 1) : (neighbors === 3 ? 1 : 0);
    }
  }
  grid.set(next);
}

/**
 * Stamp a paint pattern (from `LIFE_PAINT_PATTERNS`) with its origin at
 * (`col`, `row`). Cells outside the grid are skipped — painting does not wrap.
 * Repainting never dims a cell: the alpha boost is a maximum, not an assignment.
 */
export function stampLife(life: LifeState, col: number, row: number, pattern: ReadonlyArray<readonly [number, number]>, boost: number): void {
  for (const [dc, dr] of pattern) {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || c >= life.cols || r < 0 || r >= life.rows) continue;
    const idx = c * life.rows + r;
    life.grid[idx] = 1;
    life.alpha[idx] = Math.max(life.alpha[idx], boost);
  }
}
