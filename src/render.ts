import { toAnsi256 } from "./color";
import { MAX_STROKE_EM } from "./glyphs";
import { drawShape } from "./shapes";
import type { ColorMode, ConvertResult } from "./types";

export interface RenderOptions {
  chars: string[];
  font: string;
  aspect: number;
  fontSize: number;
  colorMode: ColorMode;
  fg: [number, number, number];
  bg: [number, number, number];
  cellBg: boolean; // tint each cell's background with a dimmed copy of its color
  weight: number; // 0..1, thickens glyphs with an outline stroke
}

/** Tinted cell background: a wash of the cell's color over the paper. */
export function cellTint(rgb: ArrayLike<number>, c: number, paper: [number, number, number]): [number, number, number] {
  const AMOUNT = 0.3;
  return [0, 1, 2].map((ch) => Math.round(paper[ch] + (rgb[c * 3 + ch] - paper[ch]) * AMOUNT)) as [number, number, number];
}

/** Resolved foreground color (and ANSI index when relevant) for each cell. */
export function cellColors(res: ConvertResult, mode: ColorMode, fg: [number, number, number]) {
  const cells = res.cols * res.rows;
  const rgb = new Uint8Array(cells * 3);
  const ansi = mode === "ansi256" ? new Uint8Array(cells) : null;
  for (let c = 0; c < cells; c++) {
    let r = res.colors[c * 3], g = res.colors[c * 3 + 1], b = res.colors[c * 3 + 2];
    if (mode === "mono") [r, g, b] = fg;
    else if (ansi) {
      const q = toAnsi256(r, g, b);
      ansi[c] = q[0];
      [r, g, b] = [q[1], q[2], q[3]];
    }
    rgb.set([r, g, b], c * 3);
  }
  return { rgb, ansi };
}

/** Draws the grid at its natural size, stretched to `display` (CSS px) when given. */
export function render(canvas: HTMLCanvasElement, res: ConvertResult, o: RenderOptions, display?: { w: number; h: number }) {
  const dpr = window.devicePixelRatio || 1;
  const cw = o.fontSize * o.aspect;
  const ch = o.fontSize;
  const cssW = res.cols * cw;
  const cssH = res.rows * ch;
  const outW = display?.w ?? cssW;
  const outH = display?.h ?? cssH;
  canvas.style.width = `${outW}px`;
  canvas.style.height = `${outH}px`;
  canvas.width = Math.round(outW * dpr);
  canvas.height = Math.round(outH * dpr);

  const ctx = canvas.getContext("2d")!;
  const kx = (dpr * outW) / cssW;
  const ky = (dpr * outH) / cssH;
  ctx.setTransform(kx, 0, 0, ky, 0, 0);
  ctx.fillStyle = `rgb(${o.bg})`;
  ctx.fillRect(0, 0, cssW, cssH);

  const { rgb } = cellColors(res, o.colorMode, o.fg);

  if (o.cellBg && o.colorMode !== "mono") {
    for (let c = 0; c < res.cols * res.rows; c++) {
      const x = (c % res.cols) * cw, y = Math.floor(c / res.cols) * ch;
      ctx.fillStyle = `rgb(${cellTint(rgb, c, o.bg)})`;
      ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
    }
  }

  ctx.font = `${o.fontSize}px ${o.font}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const stroke = o.weight > 0;
  ctx.lineJoin = "round";
  ctx.lineWidth = o.weight * MAX_STROKE_EM * o.fontSize;
  let last = -1;
  for (let y = 0; y < res.rows; y++) {
    for (let x = 0; x < res.cols; x++) {
      const c = y * res.cols + x;
      const char = o.chars[res.glyphs[c]];
      if (char === " ") continue;
      const key = (rgb[c * 3] << 16) | (rgb[c * 3 + 1] << 8) | rgb[c * 3 + 2];
      if (key !== last) {
        ctx.fillStyle = ctx.strokeStyle = `rgb(${rgb[c * 3]},${rgb[c * 3 + 1]},${rgb[c * 3 + 2]})`;
        last = key;
      }
      if (drawShape(ctx, char, x * cw, y * ch, cw, ch, o.weight, kx, ky)) continue;
      ctx.fillText(char, x * cw, y * ch + ch / 2);
      if (stroke) ctx.strokeText(char, x * cw, y * ch + ch / 2);
    }
  }
}
