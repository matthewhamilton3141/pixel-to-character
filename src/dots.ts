// Procedural dot-grid glyphs. Each glyph is a gx×gy lattice of dots with some
// subset switched on; no font involved. Glyphs live in Unicode's Private Use
// Area so the rest of the pipeline can treat them as ordinary characters.

interface DotGlyph {
  gx: number;
  gy: number;
  on: number[]; // indices into the lattice, row-major
  fill: number; // fraction of dots on
}

const registry = new Map<string, DotGlyph>();
const cache = new Map<string, string>();
let nextBlock = 0;

// 8×8 Bayer matrix: visiting cells in this order spreads dots evenly
const BAYER8 = (() => {
  const m = [[0]];
  let b = m;
  for (let size = 1; size < 8; size *= 2) {
    const n: number[][] = [];
    for (let y = 0; y < size * 2; y++) {
      n.push([]);
      for (let x = 0; x < size * 2; x++) {
        const q = (y < size ? 0 : 2) + (x < size ? 0 : 1);
        n[y].push(4 * b[y % size][x % size] + [0, 2, 3, 1][q]);
      }
    }
    b = n;
  }
  return b;
})();

const DIRECTIONS = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/**
 * Builds (or reuses) the glyph set for `rows` dots per cell vertically; the
 * column count follows the cell's aspect so dots sit on an even lattice.
 * Returns the glyphs as a string of Private Use Area characters.
 */
export function dotCharset(rows: number, aspect: number): string {
  const gy = rows;
  const gx = Math.max(1, Math.round(rows * aspect));
  const key = `${gx}x${gy}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const n = gx * gy;
  const idx = [...Array(n).keys()];
  const at = (i: number) => [i % gx, Math.floor(i / gx)];
  const bayer = (i: number) => BAYER8[at(i)[1] % 8][at(i)[0] % 8];

  // Even spread for smooth tone, then fills that start from each side and
  // corner so shape matching has glyphs that follow edges
  const orders = [idx.slice().sort((a, b) => bayer(a) - bayer(b))];
  for (const [dx, dy] of DIRECTIONS) {
    const toward = (i: number) => {
      const [x, y] = at(i);
      return ((x + 0.5) / gx - 0.5) * dx + ((y + 0.5) / gy - 0.5) * dy;
    };
    orders.push(idx.slice().sort((a, b) => toward(b) - toward(a) || bayer(a) - bayer(b)));
  }

  // Supplementary Private Use Area, one 4096-codepoint block per grid size
  const base = 0xf0000 + nextBlock++ * 4096;
  const seen = new Set<string>();
  let out = "";
  for (const order of orders) {
    for (let k = 0; k <= n; k++) {
      const on = order.slice(0, k).sort((a, b) => a - b);
      const sig = on.join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);
      const ch = String.fromCodePoint(base + seen.size - 1);
      registry.set(ch, { gx, gy, on, fill: k / n });
      out += ch;
    }
  }
  cache.set(key, out);
  return out;
}

/** Draws a dot glyph; returns false if `ch` isn't one. Weight grows the dots. */
export function drawDots(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number, y: number, w: number, h: number,
  weight: number,
): boolean {
  const g = registry.get(ch);
  if (!g) return false;
  if (!g.on.length) return true;
  const sx = w / g.gx, sy = h / g.gy;
  const r = (0.22 + 0.28 * weight) * Math.min(sx, sy);
  ctx.beginPath();
  for (const i of g.on) {
    const cx = x + ((i % g.gx) + 0.5) * sx;
    const cy = y + (Math.floor(i / g.gx) + 0.5) * sy;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fill();
  return true;
}

const RAMP = " .:-=+*#%@";

/** Plain-text stand-in for exports: dot glyphs become the nearest ramp character. */
export function textFor(ch: string): string {
  const g = registry.get(ch);
  return g ? RAMP[Math.round(g.fill * (RAMP.length - 1))] : ch;
}
