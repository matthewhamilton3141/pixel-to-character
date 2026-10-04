// Procedural demo scene: a lit sphere resting on a floor, so shading and
// depth are visible before the user loads anything.
export function demoImage(w = 640, h = 480): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const horizon = h * 0.62;
  const cx = w * 0.5, cy = h * 0.5, r = h * 0.3;
  const L = normalize([-0.5, -0.6, 0.62]);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let col: number[];
      const dx = (x - cx) / r, dy = (y - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 <= 1) {
        const n = [dx, dy, Math.sqrt(1 - d2)];
        const diff = Math.max(0, dot(n, L));
        const spec = Math.pow(Math.max(0, 2 * dot(n, L) * n[2] - L[2]), 40);
        const k = 0.08 + 0.85 * diff;
        col = [240 * k + 255 * spec, 130 * k + 255 * spec, 60 * k + 255 * spec];
      } else if (y > horizon) {
        const f = (y - horizon) / (h - horizon);
        // soft contact shadow under the sphere
        const sx = (x - (cx + r * 0.35)) / (r * 1.3);
        const sy = (y - (cy + r * 0.95)) / (r * 0.28);
        const shadow = Math.max(0, 1 - Math.sqrt(sx * sx + sy * sy));
        const k = (0.25 + 0.5 * f) * (1 - 0.8 * shadow);
        col = [90 * k + 20, 110 * k + 20, 150 * k + 25];
      } else {
        const f = y / horizon;
        col = [18 + 30 * f, 22 + 40 * f, 40 + 60 * f];
      }
      const p = (y * w + x) * 4;
      img.data[p] = col[0];
      img.data[p + 1] = col[1];
      img.data[p + 2] = col[2];
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normalize(v: number[]) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}
