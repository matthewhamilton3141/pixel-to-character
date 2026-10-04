export type Dither = "none" | "ordered" | "fs";
export type ColorMode = "mono" | "ansi256" | "truecolor";

export interface ToneParams {
  brightness: number;
  contrast: number;
  gamma: number;
  autoLevels: boolean;
  inkIsDark: boolean; // dense glyphs go where the image is dark
  shape: number; // 0 = pure tone ramp, 1 = full shape matching
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
}

export interface ConvertResult {
  id: number;
  cols: number;
  rows: number;
  glyphs: Uint16Array; // index into GlyphTable.chars
  colors: Uint8Array; // rgb per cell
  ms: number;
}
