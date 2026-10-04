import { cellColors, cellTint, type RenderOptions } from "./render";
import { textFor } from "./dots";
import { MAX_STROKE_EM } from "./glyphs";
import type { ConvertResult } from "./types";

export function toText(res: ConvertResult, chars: string[]) {
  const lines: string[] = [];
  for (let y = 0; y < res.rows; y++) {
    let line = "";
    for (let x = 0; x < res.cols; x++) line += textFor(chars[res.glyphs[y * res.cols + x]]);
    lines.push(line);
  }
  return lines.join("\n");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function toHtml(res: ConvertResult, o: RenderOptions) {
  const { rgb } = cellColors(res, o.colorMode, o.fg);
  const tint = o.cellBg && o.colorMode !== "mono";
  let body = "";
  for (let y = 0; y < res.rows; y++) {
    let run = "";
    let runStyle = "";
    const flush = () => {
      if (run) body += runStyle ? `<span style="${runStyle}">${escapeHtml(run)}</span>` : escapeHtml(run);
      run = "";
    };
    for (let x = 0; x < res.cols; x++) {
      const c = y * res.cols + x;
      const [r, g, b] = [rgb[c * 3], rgb[c * 3 + 1], rgb[c * 3 + 2]];
      let style = o.colorMode === "mono" ? "" : `color:${hex(r, g, b)}`;
      if (tint) style += `;background:${hex(...cellTint(rgb, c, o.bg))}`;
      if (style !== runStyle) {
        flush();
        runStyle = style;
      }
      run += textFor(o.chars[res.glyphs[c]]);
    }
    flush();
    body += "\n";
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>pixel-to-character</title></head>
<body style="margin:0;padding:24px;background:${hex(...o.bg)}">
<pre style="margin:0;font-family:${o.font};font-size:10px;line-height:1;color:${hex(...o.fg)}${o.weight > 0 ? `;-webkit-text-stroke:${(o.weight * MAX_STROKE_EM).toFixed(3)}em` : ""}">${body}</pre>
</body></html>`;
}

export function toAnsi(res: ConvertResult, o: RenderOptions) {
  const { rgb, ansi } = cellColors(res, o.colorMode, o.fg);
  const tint = o.cellBg && o.colorMode !== "mono";
  let out = "";
  for (let y = 0; y < res.rows; y++) {
    let last = "";
    for (let x = 0; x < res.cols; x++) {
      const c = y * res.cols + x;
      const [r, g, b] = [rgb[c * 3], rgb[c * 3 + 1], rgb[c * 3 + 2]];
      let seq = "";
      if (o.colorMode === "truecolor") {
        seq = `\x1b[38;2;${r};${g};${b}m`;
        if (tint) seq += `\x1b[48;2;${cellTint(rgb, c, o.bg).join(";")}m`;
      } else if (ansi) {
        seq = `\x1b[38;5;${ansi[c]}m`;
      }
      if (seq !== last) {
        out += seq;
        last = seq;
      }
      out += textFor(o.chars[res.glyphs[c]]);
    }
    out += o.colorMode === "mono" ? "\n" : "\x1b[0m\n";
  }
  return out;
}

export function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
