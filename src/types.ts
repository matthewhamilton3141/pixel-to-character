export type Dither = "none" | "ordered" | "fs";
export type ColorMode = "mono" | "ansi256" | "truecolor" | "tint";

export interface ToneParams {
  brightness: number;
  contrast: number;
  gamma: number;
  autoLevels: boolean;
  inkIsDark: boolean; // dense glyphs go where the image is dark
  // Light paper + color: ink amount is how far a color is from the paper
  // (so saturated colors get dense glyphs), and glyph colors are deepened so
  // sparse glyphs still average to the right color, like a print halftone.
  paperInk: boolean;
  paper: [number, number, number]; // 0..1
  shape: number; // 0 = pure tone ramp, 1 = full shape matching
  // Tint mode (levels > 0): color carries the shading, so every inked cell
  // gets the same mesh-like density; cells that posterize to paper stay blank
  tintLevels: number;
  dither: Dither;
}

export interface ConvertRequest {
  id: number;
  pixels: Uint8ClampedArray; // (cols*3) × (rows*3) RGBA
  cols: number;
  rows: number;
  params: ToneParams;
  density: Float32Array;
  vec: Float32Array;
  coverage: number;
}

export interface ConvertResult {
  id: number;
  cols: number;
  rows: number;
  glyphs: Uint16Array; // index into GlyphTable.chars
  colors: Uint8Array; // rgb per cell
  tones: Float32Array; // ink tone per cell, 0..1, before dithering
  ms: number;
}
