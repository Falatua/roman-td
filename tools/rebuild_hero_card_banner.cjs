// One-off script: rebuild the passive-text banner on the four hero
// portrait cards whose baked-in text is now stale or whose previous
// overlay spanned outside the colored ribbon area.
//
// Strategy: composite a tightly-INSET banner strip over each card's
// existing passive ribbon. The rest of the card art (portrait,
// frame, name plate, gold trim, sidebar ornaments) is preserved.
//
// 2026-05-22 v2 — INSET fix. The previous pass drew the banner
// full-width (x=0 to x=573), which spilled past the gold/dark
// corner ornaments on each card. This version uses a per-hero
// bannerInsetX so the new ribbon stays inside the original purple/
// blue/cream/brown center band that the AI drew. Also smaller font
// so the text fits comfortably within the inset width.
//
// Run with: node tools/rebuild_hero_card_banner.cjs

const sharp = require('sharp');
const path = require('path');

// Each hero's banner geometry was sampled by scanning the card row-by-
// row for white-text pixels (locates the text band) and column-by-row
// for the ribbon background color (locates the inset edges where the
// gold frame ornaments end and the colored ribbon begins).
const HEROES = {
  marius: {
    file: 'public/assets/heroes/hero_card_marius.png',
    bannerColor: '#2D1937',           // dark imperial purple
    accentColor: '#a060c0',
    textColor: '#ffffff',
    text: 'PASSIVE: +30% MELEE DMG · 3 TILES',
    bannerTop: 695,
    bannerHeight: 40,
    bannerInsetX: 80,                 // x=80 → x=493 is the purple ribbon
  },
  agrippa: {
    file: 'public/assets/heroes/hero_card_agrippa.png',
    bannerColor: '#101F45',           // dark navy
    accentColor: '#5599ff',
    textColor: '#ffffff',
    text: 'PASSIVE: +30% SIEGE DMG · +1 RANGE · 3 TILES',
    bannerTop: 644,
    bannerHeight: 40,
    bannerInsetX: 80,
  },
  sulla: {
    file: 'public/assets/heroes/hero_card_sulla.png',
    bannerColor: '#E1C498',           // cream/parchment ribbon
    accentColor: '#a04020',           // muted red border
    textColor: '#5a1e0a',             // dark blood-red text
    text: 'PASSIVE: FIRE CONVERT · +15% DMG · 3 TILES',
    // Original text spans y=643-693 (two lines). Cover the full
    // 50px-tall band so neither line bleeds past the new banner.
    bannerTop: 640,
    bannerHeight: 58,
    bannerInsetX: 80,
  },
  agricola: {
    file: 'public/assets/heroes/hero_card_agricola.png',
    bannerColor: '#311A12',           // dark gold/brown ribbon
    accentColor: '#ddc060',           // muted gold border
    textColor: '#ffe2a0',             // warm cream text
    text: 'PASSIVE: ALL TOWERS CAN HIT FLYERS',
    // Original text spans y=645-692 (two lines). Cover the full
    // ~48px-tall band so the second line ("20% ranged dmg aura")
    // doesn't bleed through.
    bannerTop: 642,
    bannerHeight: 55,
    bannerInsetX: 80,
  },
};

function makeBannerSvg(insetWidth, height, text, bg, accent, textColor) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${insetWidth}" height="${height}">
    <rect x="0" y="0" width="${insetWidth}" height="${height}" fill="${bg}"/>
    <rect x="6" y="3" width="${insetWidth - 12}" height="${height - 6}"
          fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.2"/>
    <text x="${insetWidth / 2}" y="${height / 2 + 5}" text-anchor="middle"
          font-family="'Courier New', 'Menlo', monospace"
          font-size="13" font-weight="800" fill="${textColor}"
          letter-spacing="0.4">
      ${text}
    </text>
  </svg>`);
}

(async () => {
  for (const [key, cfg] of Object.entries(HEROES)) {
    const fullPath = path.resolve(cfg.file);
    const meta = await sharp(fullPath).metadata();
    // Width of the inset ribbon = card width − 2 × side inset.
    const insetWidth = meta.width - 2 * cfg.bannerInsetX;
    const overlay = makeBannerSvg(insetWidth, cfg.bannerHeight, cfg.text, cfg.bannerColor, cfg.accentColor, cfg.textColor);
    const outBuf = await sharp(fullPath)
      .composite([{ input: overlay, top: cfg.bannerTop, left: cfg.bannerInsetX }])
      .png()
      .toBuffer();
    await sharp(outBuf).toFile(fullPath);
    console.log('rebuilt', key, '→', cfg.file, '(' + outBuf.length + ' bytes)');
  }
})();
