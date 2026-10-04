# ascii

Turn images into shaded ASCII art in the browser.

Each character is picked by brightness first, so the result keeps the image's shading and depth. A shape pass then swaps in characters whose ink matches nearby edges (`/ \ | _ ( )`), which sharpens outlines without losing tone.

- Adjustable columns, character sets (full ASCII, ramps, blocks, braille, custom), font
- Brightness, contrast, gamma, auto levels, invert, ordered / Floyd–Steinberg dithering
- Truecolor, ANSI 256, or mono; light and dark mode
- Export to TXT, HTML, ANSI, PNG

Everything runs client-side; images never leave the browser.

## Develop

```sh
npm install
npm run dev
```

`npm run build` outputs a static site to `dist/`.
