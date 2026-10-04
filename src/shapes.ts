// Block elements and braille drawn as geometry instead of font glyphs. Fonts
// leave gaps between rows for these; drawing them edge-to-edge on the cell,
// snapped to device pixels, makes neighbouring cells join seamlessly.

// Quadrant bits: 1 = top-left, 2 = top-right, 4 = bottom-left, 8 = bottom-right
const QUADRANTS: Record<string, number> = {
  "▘": 1, "▝": 2, "▀": 3, "▖": 4, "▌": 5, "▞": 6, "▛": 7,
  "▗": 8, "▚": 9, "▐": 10, "▜": 11, "▄": 12, "▙": 13, "▟": 14, "█": 15,
};

// Shades on a 2×4 sub-grid (row-major bits), so the pattern tiles across cells
const SHADES: Record<string, number[]> = {
  "░": [0b10, 0b00, 0b01, 0b00],
  "▒": [0b10, 0b01, 0b10, 0b01],
  "▓": [0b11, 0b01, 0b11, 0b10],
};

// Braille dot bit → [column, row]
const BRAILLE_DOTS: [number, number][] = [
  [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3],
];

export const isShape = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return ch in QUADRANTS || ch in SHADES || (c >= 0x2800 && c <= 0x28ff);
};

/**
 * Draws `ch` into the cell at (x, y, w, h) using the current fillStyle.
 * `kx`/`ky` map user space to device pixels so edges can be snapped.
 * Returns false when the character isn't a shape and needs a font.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number, y: number, w: number, h: number,
  weight: number, kx = 1, ky = 1,
): boolean {
  const sx = (v: number) => Math.round(v * kx) / kx;
  const sy = (v: number) => Math.round(v * ky) / ky;
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    ctx.fillRect(sx(x0), sy(y0), sx(x1) - sx(x0), sy(y1) - sy(y0));

  const q = QUADRANTS[ch];
  if (q !== undefined) {
    const mx = x + w / 2, my = y + h / 2;
    if (q & 1) rect(x, y, mx, my);
    if (q & 2) rect(mx, y, x + w, my);
    if (q & 4) rect(x, my, mx, y + h);
    if (q & 8) rect(mx, my, x + w, y + h);
    return true;
  }

  const shade = SHADES[ch];
  if (shade) {
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 2; c++)
        if (shade[r] & (2 >> c)) rect(x + (c * w) / 2, y + (r * h) / 4, x + ((c + 1) * w) / 2, y + ((r + 1) * h) / 4);
    return true;
  }

  const code = ch.codePointAt(0)!;
  if (code >= 0x2800 && code <= 0x28ff) {
    const bits = code - 0x2800;
    if (!bits) return true;
    const cw = w / 2, rh = h / 4;
    // Weight grows dots from fine points until neighbours touch
    const r = (0.26 + 0.24 * weight) * Math.min(cw, rh);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      if (!(bits & (1 << i))) continue;
      const [c, row] = BRAILLE_DOTS[i];
      const cx = x + (c + 0.5) * cw, cy = y + (row + 0.5) * rh;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fill();
    return true;
  }
  return false;
}
