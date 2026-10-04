import type { ConvertRequest, ConvertResult } from "./types";

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

self.onmessage = (e: MessageEvent<ConvertRequest>) => {
  const t0 = performance.now();
  const { id, pixels, cols, rows, params, density, vec } = e.data;
  const { brightness, contrast, gamma, inkIsDark, shape, dither, autoLevels } = params;
  const n = density.length;
  const cells = cols * rows;
  const W = cols * 3;
  const invGamma = 1 / gamma;

  // Auto levels: stretch the 1st–99th percentile of luminance to the full range
  let lo = 0, hi = 1;
  if (autoLevels) {
    const hist = new Uint32Array(256);
    const px = pixels.length / 4;
    for (let p = 0; p < pixels.length; p += 4)
      hist[(0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]) | 0]++;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= px * 0.01) { lo = i / 255; break; }
    }
    acc = 0;
    for (let i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= px * 0.01) { hi = (i + 1) / 255; break; }
    }
    if (hi - lo < 0.05) { lo = 0; hi = 1; }
  }
  const span = hi - lo;

  const adjust = (v: number) => {
    v = (v - lo) / span;
    v = (v - 0.5) * contrast + 0.5 + brightness;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    return Math.pow(v, invGamma);
  };

  // Pass 1: per-cell tone, zero-mean 3×3 shape vector, and average color
  const tone = new Float32Array(cells);
  const shapeVec = new Float32Array(cells * 9);
  const colors = new Uint8Array(cells * 3);
  const s = new Float32Array(9);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      let sum = 0;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < 9; k++) {
        const p = ((cy * 3 + ((k / 3) | 0)) * W + cx * 3 + (k % 3)) * 4;
        const pr = pixels[p], pg = pixels[p + 1], pb = pixels[p + 2];
        r += pr; g += pg; b += pb;
        let v = adjust((0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255);
        if (inkIsDark) v = 1 - v;
        s[k] = v;
        sum += v;
      }
      const t = sum / 9;
      tone[c] = t;
      for (let k = 0; k < 9; k++) shapeVec[c * 9 + k] = s[k] - t;
      colors[c * 3] = adjust(r / 9 / 255) * 255;
      colors[c * 3 + 1] = adjust(g / 9 / 255) * 255;
      colors[c * 3 + 2] = adjust(b / 9 / 255) * 255;
    }
  }

  // Pass 2: pick the glyph minimizing tone error + weighted shape error
  const glyphs = new Uint16Array(cells);
  // Shape is scored by direction (cosine) and only counts as much as the cell
  // actually has an edge, so smooth regions stay a pure tone ramp.
  const SHAPE_K = 0.04;
  // In smooth areas, prefer glyphs whose ink is spread evenly (░▒▓, %, #) over
  // structured ones (▀▌, |, _), which tile into stripes and mazes.
  const FLAT_K = 0.012;
  const gNorm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = 0; k < 9; k++) m += vec[i * 9 + k] ** 2;
    gNorm[i] = Math.sqrt(m);
  }
  // Ordered dither spans one gap between *distinct* tone levels; sets like
  // blocks have many glyphs but only a handful of densities
  const levels = Array.from(density).sort((a, b) => a - b).filter((d, i, a) => i === 0 || d - a[i - 1] > 0.02);
  const step = 1 / Math.max(1, levels.length - 1);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      let t = tone[c];
      if (dither === "ordered") t += BAYER4[(cy & 3) * 4 + (cx & 3)] * step;

      let best = 0;
      let bestCost = Infinity;
      const sv = c * 9;
      let cNorm = 0;
      for (let k = 0; k < 9; k++) cNorm += shapeVec[sv + k] ** 2;
      cNorm = Math.sqrt(cNorm);
      // Soft threshold: gentle gradients aren't edges, real boundaries are
      const edge = Math.min(1, Math.max(0, (cNorm - 0.1) / 0.3));
      const shapeW = shape * edge * SHAPE_K;
      const flatW = (1 - edge) * FLAT_K;
      for (let i = 0; i < n; i++) {
        const dt = t - density[i];
        let cost = dt * dt;
        cost += flatW * gNorm[i] * gNorm[i];
        if (cost >= bestCost) continue;
        if (shapeW > 0) {
          let cos = 0;
          if (gNorm[i] > 1e-4) {
            const gv = i * 9;
            for (let k = 0; k < 9; k++) cos += shapeVec[sv + k] * vec[gv + k];
            cos /= cNorm * gNorm[i];
          }
          cost += shapeW * (1 - cos);
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = i;
        }
      }
      glyphs[c] = best;

      if (dither === "fs") {
        const err = t - density[best];
        if (cx + 1 < cols) tone[c + 1] += (err * 7) / 16;
        if (cy + 1 < rows) {
          if (cx > 0) tone[c + cols - 1] += (err * 3) / 16;
          tone[c + cols] += (err * 5) / 16;
          if (cx + 1 < cols) tone[c + cols + 1] += err / 16;
        }
      }
    }
  }

  const result: ConvertResult = { id, cols, rows, glyphs, colors, ms: performance.now() - t0 };
  self.postMessage(result, { transfer: [glyphs.buffer, colors.buffer] });
};
