// Measures each character's ink: overall density (for tone) and a 3×3 coverage
// grid (for shape). Both are normalized so the sparsest glyph is 0 and the
// densest is 1, which lets the converter compare them directly to image tone.

export interface GlyphTable {
  chars: string[];
  density: Float32Array; // n, 0..1
  vec: Float32Array; // n*9, zero-mean sub-cell coverage
  aspect: number; // cell width / cell height
}

const SIZE = 48;

export async function buildGlyphTable(charset: string, font: string): Promise<GlyphTable> {
  const fontSpec = `${SIZE}px ${font}`;
  await document.fonts.load(fontSpec, charset).catch(() => {});

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.font = fontSpec;
  const w = Math.ceil(ctx.measureText("M").width);
  const h = SIZE;
  canvas.width = w;
  canvas.height = h;

  const chars = Array.from(new Set(Array.from(charset)));
  if (chars.length === 0) chars.push(" ");
  const n = chars.length;
  const raw = new Float32Array(n);
  const sub = new Float32Array(n * 9);

  // Pixel → sub-cell lookup and sub-cell areas
  const region = new Uint8Array(w * h);
  const area = new Float32Array(9);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = Math.floor((y * 3) / h) * 3 + Math.floor((x * 3) / w);
      region[y * w + x] = k;
      area[k]++;
    }

  for (let i = 0; i < n; i++) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.font = fontSpec; // resetting width clears context state
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(chars[i], 0, h / 2);
    const px = ctx.getImageData(0, 0, w, h).data;
    const sums = new Float32Array(9);
    let total = 0;
    for (let p = 0; p < w * h; p++) {
      const v = px[p * 4] / 255;
      total += v;
      sums[region[p]] += v;
    }
    raw[i] = total / (w * h);
    for (let k = 0; k < 9; k++) sub[i * 9 + k] = sums[k] / area[k];
  }

  let min = Infinity;
  let max = -Infinity;
  for (const d of raw) {
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  const range = max - min || 1;
  const density = new Float32Array(n);
  const vec = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    density[i] = (raw[i] - min) / range;
    for (let k = 0; k < 9; k++) vec[i * 9 + k] = (sub[i * 9 + k] - raw[i]) / range;
  }

  return { chars, density, vec, aspect: w / h };
}
