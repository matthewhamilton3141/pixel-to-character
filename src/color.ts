const CUBE = [0, 95, 135, 175, 215, 255];

const nearestCube = (v: number) => {
  let best = 0;
  for (let i = 1; i < 6; i++) if (Math.abs(CUBE[i] - v) < Math.abs(CUBE[best] - v)) best = i;
  return best;
};

/** Nearest xterm-256 color: returns [index, r, g, b]. */
export function toAnsi256(r: number, g: number, b: number): [number, number, number, number] {
  const ri = nearestCube(r), gi = nearestCube(g), bi = nearestCube(b);
  const cr = CUBE[ri], cg = CUBE[gi], cb = CUBE[bi];
  const cubeErr = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;

  const avg = (r + g + b) / 3;
  const gi2 = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const gv = 8 + gi2 * 10;
  const grayErr = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;

  return grayErr < cubeErr ? [232 + gi2, gv, gv, gv] : [16 + 36 * ri + 6 * gi + bi, cr, cg, cb];
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export const luminance = ([r, g, b]: [number, number, number]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
