import { CHARSETS } from "./charsets";
import { hexToRgb, luminance } from "./color";
import { demoImage } from "./demo";
import { download, toAnsi, toHtml, toText } from "./export";
import { dotCharset } from "./dots";
import { buildGlyphTable, fontAspect, type GlyphTable } from "./glyphs";
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
let rotation = 0; // quarter turns clockwise, applied when sampling the image

// Crop: a normalized rect in the rotated image. While editing (editCrop set),
// the preview shows the whole image and you drag a box over it.
type Rect = { x: number; y: number; w: number; h: number };
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
let crop: Rect = { ...FULL };
let editCrop: Rect | null = null;
let requestId = 0;
let busy = false;
let pending = false;

const sample = document.createElement("canvas");
const sampleCtx = sample.getContext("2d", { willReadFrequently: true })!;

// Sliders: fill the track up to the thumb, and mirror the value in a typable
// number box that clamps to the slider's range and snaps to its step
const ranges = [...document.querySelectorAll<HTMLInputElement>("input[type=range]")];
function syncRange(input: HTMLInputElement) {
  const p = ((+input.value - +input.min) / (+input.max - +input.min)) * 100;
  input.style.setProperty("--p", `${p}%`);
  const num = $(`${input.id}-num`);
  num.value = input.value;
  num.disabled = input.disabled;
}
for (const input of ranges) {
  const num = $(`${input.id}-num`);
  num.min = input.min;
  num.max = input.max;
  num.step = input.step || "1";
  input.addEventListener("input", () => syncRange(input));
  num.addEventListener("change", () => {
    const step = +num.step;
    let v = Math.min(+input.max, Math.max(+input.min, +num.value || 0));
    v = +(Math.round((v - +input.min) / step) * step + +input.min).toFixed(4);
    input.value = String(v);
    input.dispatchEvent(new Event("input"));
    syncRange(input);
  });
  num.addEventListener("keydown", (e) => e.key === "Enter" && num.blur());
  syncRange(input);
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

async function charset(font: string) {
  const v = $<HTMLSelectElement>("charset").value;
  if (v === "dots") return dotCharset(+$("grid").value, await fontAspect(font));
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
  const chars = await charset(font);
  const key = font + "\0" + weight + "\0" + chars;
  if (key !== glyphKey) {
    glyphs = await buildGlyphTable(chars, font, weight);
    glyphKey = key;
  }
  const g = glyphs!;

  const cols = +$("cols").value;
  const sideways = rotation % 2 === 1;
  const fullW = sideways ? source.height : source.width;
  const fullH = sideways ? source.width : source.height;
  const area = editCrop ? FULL : crop;
  const srcW = fullW * area.w;
  const srcH = fullH * area.h;
  const rows = Math.max(1, Math.round((cols * srcH * g.aspect) / srcW));
  sample.width = cols * 3;
  sample.height = rows * 3;
  sampleCtx.imageSmoothingQuality = "high";
  // Map the crop area of the rotated image onto the sample canvas
  sampleCtx.save();
  sampleCtx.scale(sample.width / srcW, sample.height / srcH);
  sampleCtx.translate(-area.x * fullW, -area.y * fullH);
  sampleCtx.translate(fullW / 2, fullH / 2);
  sampleCtx.rotate((rotation * Math.PI) / 2);
  sampleCtx.drawImage(source, -source.width / 2, -source.height / 2);
  sampleCtx.restore();
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
      paperInk: colorMode !== "mono" && lightBg && !$("invert").checked && !$("knockout").checked,
      paper: [bg[0] / 255, bg[1] / 255, bg[2] / 255],
      shape: +$("shape").value,
      dither: $<HTMLSelectElement>("dither").value as Dither,
      knockout: $("knockout").checked,
    },
    density: g.density,
    vec: g.vec,
    coverage: g.coverage,
  };

  lastSourceAspect = srcW / srcH;
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
    knockout: $("knockout").checked,
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
  placeCropBox();
  stats.textContent = `${cols}×${rows} · convert ${lastResult.ms.toFixed(0)} ms · draw ${(performance.now() - t0).toFixed(0)} ms`;
}

// Custom text and the dot Grid slider only show for their character sets
function syncCharsetUI() {
  const v = $<HTMLSelectElement>("charset").value;
  $("custom").hidden = v !== "custom";
  $<HTMLElement>("gridRow").hidden = v !== "dots";
}

// Controls
const controls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".panel input, .panel select")].filter(
  (el) => el.id !== "file" && !el.classList.contains("num"),
);
for (const el of controls) {
  el.addEventListener("input", () => {
    if (el.id === "fit") {
      $("fontSize").disabled = $("fit").checked;
      syncRange($("fontSize"));
      stage.classList.toggle("fit", $("fit").checked);
    }
    if (el.id === "charset") syncCharsetUI();
    if (el.id === "fontSize") draw();
    else update();
  });
}
stage.classList.toggle("fit", $("fit").checked);
syncCharsetUI();

// Restore defaults: every control back to its HTML default; the image and theme stay
$("reset").addEventListener("click", () => {
  for (const el of controls) {
    if (el instanceof HTMLSelectElement) {
      const def = [...el.options].find((o) => o.defaultSelected) ?? [...el.options].find((o) => !o.disabled);
      if (def) el.value = def.value;
    } else if (el.type === "checkbox") el.checked = el.defaultChecked;
    else el.value = el.defaultValue;
  }
  applyTheme(); // ink and paper follow the current theme
  syncCharsetUI();
  $("fontSize").disabled = $("fit").checked;
  stage.classList.toggle("fit", $("fit").checked);
  ranges.forEach(syncRange);
  update();
});
new ResizeObserver(() => $("fit").checked && draw()).observe(stage);

// Loading images
async function loadFile(file: File | null | undefined) {
  if (!file || !file.type.startsWith("image/")) return;
  source = await createImageBitmap(file);
  rotation = 0;
  crop = { ...FULL };
  if (editCrop) editCrop = { ...FULL };
  update();
}
$("open").addEventListener("click", () => $("file").click());
// A quarter turn of the image carries the crop rect with it
const turn = (r: Rect, cw: boolean): Rect =>
  cw ? { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w } : { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
function rotate(cw: boolean) {
  rotation = (rotation + (cw ? 1 : 3)) % 4;
  crop = turn(crop, cw);
  if (editCrop) editCrop = turn(editCrop, cw);
  update();
}
$("rotL").addEventListener("click", () => rotate(false));
$("rotR").addEventListener("click", () => rotate(true));

// Cropping
const cropBox = $<HTMLElement>("cropBox");
function placeCropBox() {
  if (!editCrop) return;
  cropBox.style.left = `${canvas.offsetLeft + editCrop.x * canvas.offsetWidth}px`;
  cropBox.style.top = `${canvas.offsetTop + editCrop.y * canvas.offsetHeight}px`;
  cropBox.style.width = `${editCrop.w * canvas.offsetWidth}px`;
  cropBox.style.height = `${editCrop.h * canvas.offsetHeight}px`;
}
function setCropping(on: boolean) {
  stage.classList.toggle("cropping", on);
  $("crop").classList.toggle("on", on);
  update();
}
function startCrop() {
  editCrop = { ...crop };
  setCropping(true);
}
function endCrop(apply: boolean) {
  if (!editCrop) return;
  if (apply) crop = editCrop;
  editCrop = null;
  setCropping(false);
}
$("crop").addEventListener("click", () => (editCrop ? endCrop(true) : startCrop()));
$("cropApply").addEventListener("click", () => endCrop(true));
$("cropCancel").addEventListener("click", () => endCrop(false));
$("cropReset").addEventListener("click", () => {
  editCrop = { ...FULL };
  placeCropBox();
});
window.addEventListener("keydown", (e) => {
  if (!editCrop || (e.target as HTMLElement).tagName === "INPUT") return;
  if (e.key === "Enter") endCrop(true);
  if (e.key === "Escape") endCrop(false);
});

// Drag on the preview: inside the box moves it, outside draws a new one
let drag: { mode: "draw" | "move"; ax: number; ay: number; start: Rect } | null = null;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function pointAt(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
}
stage.addEventListener("pointerdown", (e) => {
  if (!editCrop || (e.target as HTMLElement).closest("#cropBar")) return;
  const p = pointAt(e);
  const c = editCrop;
  const inside = p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
  const isFull = c.w === 1 && c.h === 1;
  drag = { mode: inside && !isFull ? "move" : "draw", ax: p.x, ay: p.y, start: { ...c } };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!drag || !editCrop) return;
  const p = pointAt(e);
  if (drag.mode === "move") {
    const s = drag.start;
    editCrop = {
      ...s,
      x: Math.min(1 - s.w, Math.max(0, s.x + p.x - drag.ax)),
      y: Math.min(1 - s.h, Math.max(0, s.y + p.y - drag.ay)),
    };
  } else {
    editCrop = {
      x: Math.min(drag.ax, p.x),
      y: Math.min(drag.ay, p.y),
      w: Math.abs(p.x - drag.ax),
      h: Math.abs(p.y - drag.ay),
    };
  }
  placeCropBox();
});
stage.addEventListener("pointerup", () => {
  // A click or tiny drag isn't a crop; keep what was there
  if (drag && editCrop && (editCrop.w < 0.02 || editCrop.h < 0.02)) editCrop = drag.start;
  drag = null;
  placeCropBox();
});
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
