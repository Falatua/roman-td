// One-off script: rebuild the bottom passive banner on the Marius + Agrippa
// hero cards so the baked-in text matches the new buffed passive values.
//
// Strategy: composite a clean banner strip over the old passive text region.
// The rest of the card art (portrait, frame, name plate, gold trim) is
// preserved untouched.
//
// Per-hero banner geometry — the two cards have their passive ribbons at
// different vertical positions (Marius bottom ~y=702-719, Agrippa upper ~
// y=651-667). Confirmed by scanning each card row for white-text density.
//
// Run with: node tools/rebuild_hero_card_banner.cjs

const sharp = require('sharp');
const path = require('path');

// Sampled from the existing cards by isolating the dark ribbon background
// away from the centered white text.
const HEROES = {
  marius: {
    file: 'public/assets/heroes/hero_card_marius.png',
    bannerColor: '#2D1937',
    accentColor: '#a060c0',
    text: 'PASSIVE: +30% melee dmg within 3 tiles',
    // Text at y=702-719. Overlay covers y=695-735 (40px tall) so the entire
    // old "PASSIVE: +20%..." text band is replaced.
    bannerTop: 695,
    bannerHeight: 40,
  },
  agrippa: {
    file: 'public/assets/heroes/hero_card_agrippa.png',
    bannerColor: '#101F45',
    accentColor: '#5599ff',
    text: 'PASSIVE: +30% siege dmg, +1.0 range, 3 tiles',
    // Text at y=651-667. Overlay covers y=644-682 to fully replace it.
    bannerTop: 644,
    bannerHeight: 40,
  },
};

function makeBannerSvg(width, height, text, bg, accent) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>
    <!-- inner accent border keeps the ribbon from looking like a flat slab -->
    <rect x="10" y="4" width="${width - 20}" height="${height - 8}"
          fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="1.2"/>
    <text x="${width / 2}" y="${height / 2 + 7}" text-anchor="middle"
          font-family="'Courier New', 'Menlo', monospace"
          font-size="18" font-weight="800" fill="#ffffff"
          stroke="#000000" stroke-width="0.5" letter-spacing="0.5">
      ${text}
    </text>
  </svg>`);
}

(async () => {
  for (const [key, cfg] of Object.entries(HEROES)) {
    const fullPath = path.resolve(cfg.file);
    const meta = await sharp(fullPath).metadata();
    const overlay = makeBannerSvg(meta.width, cfg.bannerHeight, cfg.text, cfg.bannerColor, cfg.accentColor);
    const outBuf = await sharp(fullPath)
      .composite([{ input: overlay, top: cfg.bannerTop, left: 0 }])
      .png()
      .toBuffer();
    await sharp(outBuf).toFile(fullPath);
    console.log('rebuilt', key, '→', cfg.file, '(' + outBuf.length + ' bytes)');
  }
})();
