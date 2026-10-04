import { CHARSETS } from "./charsets";
import { hexToRgb, luminance } from "./color";
import { demoImage } from "./demo";
import { download, toAnsi, toHtml, toText } from "./export";
import { buildGlyphTable, type GlyphTable } from "./glyphs";
import { render, type RenderOptions } from "./render";
import type { ColorMode, ConvertRequest, ConvertResult, Dither } from "./types";
import ConvertWorker from "./convert.worker?worker";

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("out");
const stage = $<HTMLElement>("stage");
const stats = $<HTMLElement>("stats");

const worker = new ConvertWorker();
let source: CanvasImageSource & { width: number; height: number } = demoImage();
let glyphs: GlyphTable | null = null;
let glyphKey = "";
let lastResult: ConvertResult | null = null;
let lastOptions: RenderOptions | null = null;
let lastSourceAspect = 1;
let requestId = 0;
let busy = false;
let pending = false;

const sample = document.createElement("canvas");
const sampleCtx = sample.getContext("2d", { willReadFrequently: true })!;

// Show slider values next to their labels, and fill the track up to the thumb
for (const out of document.querySelectorAll("output")) {
  const input = $(out.htmlFor.value);
  const show = () => (out.textContent = input.value);
  input.addEventListener("input", show);
  show();
}
for (const input of document.querySelectorAll<HTMLInputElement>("input[type=range]")) {
  const fill = () => {
    const p = ((+input.value - +input.min) / (+input.max - +input.min)) * 100;
    input.style.setProperty("--p", `${p}%`);
  };
  input.addEventListener("input", fill);
  fill();
}

// Light / dark: follows the system until toggled; ink and paper follow the theme
const THEME_KEY = "ascii-theme";
const systemDark = matchMedia("(prefers-color-scheme: dark)");
function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}
const isDark = () => (document.documentElement.dataset.theme ?? (systemDark.matches ? "dark" : "light")) === "dark";
function applyTheme() {
  const dark = isDark();
  $("fg").value = dark ? "#ededeb" : "#111111";
  $("bg").value = dark ? "#0b0b0b" : "#f6f6f4";
  $("theme").title = dark ? "Light mode" : "Dark mode";
}
const saved = storedTheme();
if (saved) document.documentElement.dataset.theme = saved;
applyTheme();
$("theme").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  applyTheme();
  update();
});
systemDark.addEventListener("change", () => {
  if (storedTheme()) return;
  applyTheme();
  update();
});

function charset() {
  const v = $<HTMLSelectElement>("charset").value;
  return v === "custom" ? $("custom").value || " " : CHARSETS[v];
}

async function update() {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  pending = false;

  const font = $<HTMLSelectElement>("font").value;
  const weight = +$("weight").value;
  const key = font + "\0" + weight + "\0" + charset();
  if (key !== glyphKey) {
    glyphs = await buildGlyphTable(charset(), font, weight);
    glyphKey = key;
  }
  const g = glyphs!;

  const cols = +$("cols").value;
  const rows = Math.max(1, Math.round((cols * source.height * g.aspect) / source.width));
  sample.width = cols * 3;
  sample.height = rows * 3;
  sampleCtx.imageSmoothingQuality = "high";
  sampleCtx.drawImage(source, 0, 0, sample.width, sample.height);
  const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;

  const colorMode = $<HTMLSelectElement>("colorMode").value as ColorMode;
  const fg = hexToRgb($("fg").value);
  const bg = hexToRgb($("bg").value);
  // On a light background ink is dark, so dense glyphs belong in dark areas
  const lightBg = colorMode === "mono" ? luminance(bg) > luminance(fg) : luminance(bg) > 0.5;

  const req: ConvertRequest = {
    id: ++requestId,
    pixels,
    cols,
    rows,
    params: {
      brightness: +$("brightness").value,
      contrast: +$("contrast").value,
      gamma: +$("gamma").value,
      autoLevels: $("autoLevels").checked,
      inkIsDark: lightBg !== $("invert").checked,
      shape: +$("shape").value,
      dither: $<HTMLSelectElement>("dither").value as Dither,
    },
    density: g.density,
    vec: g.vec,
  };

  lastSourceAspect = source.width / source.height;
  lastOptions = {
    chars: g.chars,
    font,
    aspect: g.aspect,
    fontSize: 10,
    colorMode,
    fg,
    bg,
    cellBg: $("cellBg").checked,
    weight,
  };
  worker.postMessage(req, [pixels.buffer]);
}

worker.onmessage = (e: MessageEvent<ConvertResult>) => {
  lastResult = e.data;
  draw();
  busy = false;
  if (pending) update();
};

function draw() {
  if (!lastResult || !lastOptions) return;
  const { cols, rows } = lastResult;
  const natural = (fontSize: number) => ({ w: cols * lastOptions!.aspect * fontSize, h: rows * fontSize });
  let display;
  if ($("fit").checked) {
    // Fit the *image's* aspect ratio, not the rounded character grid, so the
    // frame stays put as columns change and only the characters get finer.
    const availW = stage.clientWidth - 48;
    const availH = stage.clientHeight - 48;
    const w = Math.floor(Math.min(availW, availH * lastSourceAspect));
    display = { w, h: Math.floor(w / lastSourceAspect) };
    lastOptions.fontSize = display.h / rows;
  } else {
    lastOptions.fontSize = +$("fontSize").value;
    display = natural(lastOptions.fontSize);
  }
  const t0 = performance.now();
  render(canvas, lastResult, lastOptions, display);
  stats.textContent = `${cols}×${rows} · convert ${lastResult.ms.toFixed(0)} ms · draw ${(performance.now() - t0).toFixed(0)} ms`;
}

// Controls
for (const el of document.querySelectorAll<HTMLElement>(".panel input, .panel select")) {
  if (el.id === "file") continue;
  el.addEventListener("input", () => {
    if (el.id === "fit") {
      $("fontSize").disabled = $("fit").checked;
      stage.classList.toggle("fit", $("fit").checked);
    }
    if (el.id === "charset") $("custom").hidden = $<HTMLSelectElement>("charset").value !== "custom";
    if (el.id === "fontSize") draw();
    else update();
  });
}
stage.classList.toggle("fit", $("fit").checked);
new ResizeObserver(() => $("fit").checked && draw()).observe(stage);

// Loading images
async function loadFile(file: File | null | undefined) {
  if (!file || !file.type.startsWith("image/")) return;
  source = await createImageBitmap(file);
  update();
}
$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => loadFile($("file").files?.[0]));
window.addEventListener("paste", (e) => loadFile(e.clipboardData?.files[0]));
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add("dragging");
});
window.addEventListener("dragleave", () => {
  if (--dragDepth === 0) document.body.classList.remove("dragging");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  loadFile(e.dataTransfer?.files[0]);
});

// Export
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-export]")) {
  btn.addEventListener("click", () => {
    if (!lastResult || !lastOptions) return;
    const kind = btn.dataset.export;
    if (kind === "txt") download("ascii.txt", toText(lastResult, lastOptions.chars));
    if (kind === "html") download("ascii.html", toHtml(lastResult, lastOptions), "text/html");
    if (kind === "ansi") download("ascii.ans", toAnsi(lastResult, lastOptions));
    if (kind === "png") canvas.toBlob((b) => b && download("ascii.png", b));
    if (kind === "copy") {
      navigator.clipboard.writeText(toText(lastResult, lastOptions.chars));
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    }
  });
}

update();
