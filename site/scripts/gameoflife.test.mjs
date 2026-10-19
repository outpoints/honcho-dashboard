import assert from "node:assert/strict";
import test from "node:test";
import {
  LIFE_CULL_KILL,
  LIFE_PAINT_ALPHA,
  LIFE_PAINT_PATTERNS,
  cullLife,
  createLife,
  liveCount,
  stampLife,
  stepLife,
} from "../src/lib/gameOfLife.ts";

const at = (life, col, row) => life.grid[col * life.rows + row];
// Rand that never rolls a mortality hit, for testing the pure B3/S23 rules.
const SPARE = () => 1;

test("blinker oscillates between horizontal and vertical", () => {
  const life = createLife(7, 7);
  // Pattern 1 stamps a horizontal blinker: cells (2,3)(3,3)(4,3).
  stampLife(life, 3, 3, LIFE_PAINT_PATTERNS[1], LIFE_PAINT_ALPHA);
  stepLife(life, SPARE);
  // Its successor is the vertical blinker (3,2)(3,3)(3,4).
  assert.equal(at(life, 3, 2), 1);
  assert.equal(at(life, 3, 3), 1);
  assert.equal(at(life, 3, 4), 1);
  assert.equal(liveCount(life), 3);
  stepLife(life, SPARE);
  assert.equal(at(life, 2, 3), 1);
  assert.equal(at(life, 3, 3), 1);
  assert.equal(at(life, 4, 3), 1);
  assert.equal(liveCount(life), 3);
});

test("block still-life is stable", () => {
  const life = createLife(6, 6);
  for (const [c, r] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
    life.grid[c * life.rows + r] = 1;
  }
  for (let i = 0; i < 6; i++) stepLife(life, SPARE);
  assert.equal(liveCount(life), 4);
  assert.equal(at(life, 2, 2), 1);
  assert.equal(at(life, 3, 3), 1);
});

test("isolated cells die; cells are born on exactly three neighbors", () => {
  const life = createLife(7, 7);
  // An L-tromino: (2,2)(3,2)(2,3). The cell at (2,2) has 2 neighbors and
  // survives; (3,3) has all three as neighbors and is born.
  life.grid[2 * 7 + 2] = 1;
  life.grid[3 * 7 + 2] = 1;
  life.grid[2 * 7 + 3] = 1;
  stepLife(life, SPARE);
  assert.equal(at(life, 3, 3), 1, "cell with three neighbors is born");
  assert.equal(at(life, 2, 2), 1);
  assert.equal(at(life, 3, 2), 1);
  assert.equal(at(life, 2, 3), 1);

  // An isolated dot has no neighbors and must vanish after one generation.
  const lone = createLife(7, 7);
  lone.grid[5 * 7 + 5] = 1;
  stepLife(lone, SPARE);
  assert.equal(liveCount(lone), 0);
});

test("the grid wraps toroidally at the edges", () => {
  const life = createLife(5, 5);
  // Vertical blinker on column 0 spanning rows 0-2. Its horizontal blinker
  // successor must wrap through column 4: cells (4,1)(0,1)(1,1).
  life.grid[0 * 5 + 0] = 1;
  life.grid[0 * 5 + 1] = 1;
  life.grid[0 * 5 + 2] = 1;
  stepLife(life, SPARE);
  assert.equal(at(life, 4, 1), 1, "wrapped neighbor column 4 is born");
  assert.equal(at(life, 0, 1), 1);
  assert.equal(at(life, 1, 1), 1);
  assert.equal(liveCount(life), 3);
});

test("gliders travel and survive many generations", () => {
  const life = createLife(24, 24);
  const glider = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
  for (const [c, r] of glider) life.grid[(5 + c) * 24 + (5 + r)] = 1;
  for (let i = 0; i < 48; i++) stepLife(life, SPARE);
  assert.equal(liveCount(life), 5, "glider keeps five cells alive forever");
});

test("mortality rolls clear colonies that the rules alone would keep forever", () => {
  const life = createLife(9, 9);
  stampLife(life, 4, 4, LIFE_PAINT_PATTERNS[1], LIFE_PAINT_ALPHA); // blinker
  life.grid[7 * 9 + 7] = 1; // stray dot
  // Every 8th roll is fatal: the blinker breaks well within 40 generations.
  let n = 0;
  for (let i = 0; i < 40; i++) stepLife(life, () => (n++ % 8 === 7 ? 0 : 1));
  assert.equal(liveCount(life), 0);
});

test("cullLife only fires above the population ratio and kills the sampled share", () => {
  const small = createLife(4, 4); // 16 cells, cull threshold 8
  small.grid[0] = 1;
  small.grid[5] = 1;
  assert.equal(cullLife(small, () => 0), 0, "below the ratio nothing is culled");

  const packed = createLife(4, 4);
  packed.grid.fill(1); // 16 live cells > 16 * LIFE_CULL_RATIO
  assert.equal(cullLife(packed, () => 0.9), 0, "rand above the kill threshold spares cells");
  assert.equal(cullLife(packed, () => 0), 16, "rand below the threshold kills every live cell");
  assert.equal(liveCount(packed), 0);

  const packed2 = createLife(4, 4);
  packed2.grid.fill(1);
  const killed = cullLife(packed2, () => LIFE_CULL_KILL - 0.01);
  assert.ok(killed > 16 * LIFE_CULL_KILL - 1, "kills roughly the configured share");
});

test("stampLife skips out-of-bounds cells and never dims on repaint", () => {
  const life = createLife(6, 6);
  stampLife(life, 0, 0, LIFE_PAINT_PATTERNS[1], LIFE_PAINT_ALPHA);
  assert.equal(at(life, 0, 0), 1);
  assert.equal(at(life, 1, 0), 1, "in-bounds neighbor stamped");
  assert.equal(life.grid[5 * 6 + 0], 0, "wrapped neighbor (-1,0) skipped: painting does not wrap");

  life.alpha[0] = 0.9;
  stampLife(life, 0, 0, LIFE_PAINT_PATTERNS[0], LIFE_PAINT_ALPHA);
  assert.ok(Math.abs(life.alpha[0] - 0.9) < 1e-6, "repaint keeps the brighter alpha");
  stampLife(life, 5, 5, LIFE_PAINT_PATTERNS[2], 0.4);
  assert.ok(Math.abs(life.alpha[5 * 6 + 5] - 0.4) < 1e-6);
});

test("createLife allocates zeroed buffers", () => {
  const life = createLife(3, 4);
  assert.equal(life.grid.length, 12);
  assert.equal(liveCount(life), 0);
  assert.equal(life.alpha.reduce((a, b) => a + b, 0), 0);
});
