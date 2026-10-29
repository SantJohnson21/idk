/**
 * Renders the store artwork (icon + splash) from inline SVG.
 *
 * Everything the game ships is drawn at runtime, so the launcher icon is drawn
 * the same way: no binary art in the repo, just this script and `resources/`.
 *
 *   node scripts/make-assets.mjs && npx capacitor-assets generate
 */
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const OUT = 'resources';

const BG = '#080b12';
const INK = '#05080d';
const GOLD = '#ffd166';
const LEATHER = '#b8551c';
const LEATHER_DARK = '#7a3410';
const STITCH = '#f6e7c9';

const defs = `
  <defs>
    <radialGradient id="glow" cx="50%" cy="34%" r="62%">
      <stop offset="0%" stop-color="#14313a" />
      <stop offset="58%" stop-color="#0a141d" />
      <stop offset="100%" stop-color="${BG}" />
    </radialGradient>
    <linearGradient id="leather" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%" stop-color="#d0763a" />
      <stop offset="45%" stop-color="${LEATHER}" />
      <stop offset="100%" stop-color="${LEATHER_DARK}" />
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffe6a3" />
      <stop offset="100%" stop-color="#e0a63c" />
    </linearGradient>
    <pattern id="scan" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="4" fill="#ffffff" opacity="0.035" />
    </pattern>
  </defs>
`;

/** The mark: rewind chevrons + football, laid out inside a 1024 box. */
const mark = `
  <g>
    <ellipse cx="680" cy="672" rx="232" ry="44" fill="${INK}" opacity="0.5" />
    <g fill="url(#rim)" stroke="${INK}" stroke-width="16" stroke-linejoin="round">
      <path d="M286 372 L286 652 L158 512 Z" />
      <path d="M444 372 L444 652 L316 512 Z" />
    </g>
    <g transform="translate(668 512) rotate(-18)">
      <ellipse rx="212" ry="152" fill="url(#leather)" stroke="${INK}" stroke-width="18" />
      <ellipse rx="212" ry="152" fill="url(#scan)" />
      <g stroke="${STITCH}" stroke-width="13" stroke-linecap="round" fill="none">
        <path d="M-104 0 L104 0" />
        <path d="M-52 -34 L-52 34" />
        <path d="M0 -38 L0 38" />
        <path d="M52 -34 L52 34" />
      </g>
      <path d="M-170 -92 A212 152 0 0 1 150 -104" stroke="#ffffff" stroke-width="10" opacity="0.2" fill="none" stroke-linecap="round" />
    </g>
  </g>
`;

const scanlines = (opacity) =>
  `<rect width="1024" height="1024" fill="url(#scan)" opacity="${opacity}" />`;

/** App icon: full bleed, art inside the ~80% safe zone. */
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${defs}
  <rect width="1024" height="1024" fill="url(#glow)" />
  <rect x="26" y="26" width="972" height="972" rx="54" fill="none" stroke="${GOLD}" stroke-width="10" opacity="0.5" />
  ${mark}
  ${scanlines(1)}
</svg>`;

/** Adaptive-icon foreground: transparent, art scaled into the 66% mask safe zone. */
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${defs}
  <g transform="translate(512 512) scale(0.62) translate(-512 -512)">
    ${mark}
  </g>
</svg>`;

/** Adaptive-icon background: the plate without the mark. */
const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${defs}
  <rect width="1024" height="1024" fill="url(#glow)" />
  ${scanlines(1)}
</svg>`;

/**
 * Splash: 2732x2732 with the mark centred, since Android crops to CENTER_CROP
 * and iOS scales to fill. Corner ticks keep the VHS framing on wide screens.
 */
const splashSvg = (dark) => `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">
  ${defs}
  <rect width="2732" height="2732" fill="${dark ? '#04070b' : BG}" />
  <g transform="translate(1366 1366) scale(1.5) translate(-512 -512)">
    ${mark}
  </g>
  <g stroke="${GOLD}" stroke-width="9" opacity="0.35" fill="none">
    <path d="M190 300 L190 190 L300 190" />
    <path d="M2542 190 L2652 190 L2652 300" />
    <path d="M190 2432 L190 2542 L300 2542" />
    <path d="M2542 2542 L2652 2542 L2652 2432" />
  </g>
  <rect width="2732" height="2732" fill="url(#scan)" opacity="0.8" />
</svg>`;

const render = (svg, size, file) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(`${OUT}/${file}`);

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/icon.svg`, iconSvg);
await Promise.all([
  render(iconSvg, 1024, 'icon.png'),
  render(foregroundSvg, 1024, 'icon-foreground.png'),
  render(backgroundSvg, 1024, 'icon-background.png'),
  render(splashSvg(false), 2732, 'splash.png'),
  render(splashSvg(true), 2732, 'splash-dark.png'),
]);
console.log('wrote resources/icon.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png');
