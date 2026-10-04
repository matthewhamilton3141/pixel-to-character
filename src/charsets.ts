const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const braille = Array.from({ length: 256 }, (_, i) => String.fromCharCode(0x2800 + i)).join("");

export const CHARSETS: Record<string, string> = {
  detailed: printable,
  standard: " .:-=+*#%@",
  minimal: " .oO@",
  // shades for tone, half/quarter blocks so shape matching can follow edges
  blocks: " ░▒▓█▀▄▌▐▖▗▘▝▚▞▙▛▜▟",
  braille,
};
