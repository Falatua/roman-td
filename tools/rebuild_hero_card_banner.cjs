// One-off script: rebuild the passive-text banner on the four hero
// portrait cards. v3 — FULL-WIDTH professional banner.
//
// v1/v2 problem: previous overlays were too narrow (inset 80px each
// side) so the original baked-in passive text bled around the sides
// of the new overlay strip ("PASS" peeking left of Agrippa's new
// banner, "iles" peeking right, etc.). The new overlay needs to
// completely cover the original banner area AND look like an
// integrated piece of the card design, not a sticker.
//
// Design choice: a parchment-scroll style banner that spans nearly
// the full card width (inset just enough to clear the outer gold
// frame), with an ornate gold border + drop shadow + embossed-feel
// pixel-art text. Mimics the Roman-themed aesthetic of the rest of
// the card so it reads as part of the original artwork.
//
// Run with: node tools/rebuild_hero_card_banner.cjs

const sharp = require('sharp');
const path = require('path');

// All cards are 573x768. The outer gold frame is ~18px on each side.
// We inset our banner 18px so the existing outer frame is preserved
// and the banner sits flush inside it.
const CARD_WIDTH = 573;
const BANNER_INSET_X = 18;
const BANNER_INNER_WIDTH = CARD_WIDTH - 2 * BANNER_INSET_X;   // = 537

// Each hero's passive ribbon sits at a different vertical position
// on its card (the AI generated each card independently). The
// bannerTop+bannerHeight pair must cover the FULL band where the
// original passive text was painted.
const HEROES = {
  marius: {
    file: 'public/assets/heroes/hero_card_marius.png',
    // Original purple ribbon spans y≈665 to y≈755 (with text at
    // y=702-721). Cover the whole thing.
    bannerTop: 660,
    bannerHeight: 96,
    text: 'PASSIVE: +30% MELEE DMG · 3 TILES',
    // Color theme — pulled from each card's own palette so the new
    // banner harmonizes with the portrait.
    bg1: '#3A1F4A',                     // dark purple
    bg2: '#1F0F26',                     // deeper purple shadow
    accent: '#d4af37',                  // imperial gold (frame border)
    textColor: '#fff5d6',               // warm cream
    textShadow: '#1a0d12',
  },
  agrippa: {
    file: 'public/assets/heroes/hero_card_agrippa.png',
    // Original navy ribbon: text at y=660-670, banner band y≈620-720.
    bannerTop: 615,
    bannerHeight: 105,
    text: 'PASSIVE: +30% SIEGE DMG · +1 RANGE · 3 TILES',
    bg1: '#162A55',
    bg2: '#091025',
    accent: '#d4af37',
    textColor: '#fff5d6',
    textShadow: '#020514',
  },
  agricola: {
    file: 'public/assets/heroes/hero_card_agricola.png',
    // Original dark-gold ribbon: text spans y=645-692.
    bannerTop: 615,
    bannerHeight: 110,
    text: 'PASSIVE: ALL TOWERS CAN HIT FLYERS',
    bg1: '#3A2418',
    bg2: '#1F0F08',
    accent: '#d4af37',
    textColor: '#fff5d6',
    textShadow: '#0a0502',
  },
  sulla: {
    file: 'public/assets/heroes/hero_card_sulla.png',
    // Original cream ribbon: text spans y=643-693 (2 lines).
    bannerTop: 615,
    bannerHeight: 115,
    text: 'PASSIVE: FIRE CONVERT · +15% DMG · 3 TILES',
    // Sulla's card palette is hot orange/cream; keep the warm tone.
    bg1: '#4A1E0A',                     // burnt amber
    bg2: '#2A0F04',                     // ember shadow
    accent: '#e0a040',                  // amber-gold
    textColor: '#fff0c8',
    textShadow: '#1a0500',
  },
};

// Build a designed banner SVG. Layers (bottom up):
// 1. dark gradient fill (bg1 → bg2 vertical) — looks like recessed
//    bronze/parchment panel
// 2. inner highlight stroke (top edge ~1px, lighter accent) — gives
//    a subtle 3D embossed look
// 3. outer ornate border (gold accent, 3px) — ties to the card's
//    own gold frame
// 4. corner laurel/dot ornaments (small accent circles) — Roman
//    decorative motif without leaning on a custom pixel font
// 5. text: bold monospace, accent-colored, drop-shadow for readability
function makeBannerSvg(width, height, cfg) {
  // Text size scales with banner height + character count, with a
  // conservative width estimate so longer passive strings (Agrippa
  // "+30% SIEGE DMG · +1 RANGE · 3 TILES", Sulla "FIRE CONVERT · +15%
  // DMG · 3 TILES") don't overflow the banner edges. v2 measurements
  // showed Courier-style monospace renders at ~0.66 × fontSize in
  // sharp's text rasterizer — generous enough to absorb the small
  // letter-spacing rider too. Margin: 85% of banner width to leave
  // breathing room on either side of the text.
  const charCount = cfg.text.length;
  const fontSize = Math.min(
    20,                                                      // hard cap
    height * 0.30,                                           // height budget
    (width * 0.85) / (charCount * 0.66)                      // width budget
  );
  const fs = Math.max(11, Math.floor(fontSize));
  // Vertically center the text in the banner.
  const textY = height / 2 + fs * 0.36;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="banner-bg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"  stop-color="${cfg.bg1}"/>
        <stop offset="50%" stop-color="${cfg.bg2}"/>
        <stop offset="100%" stop-color="${cfg.bg1}"/>
      </linearGradient>
    </defs>
    <!-- 1: background fill -->
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#banner-bg)"/>
    <!-- 2: outer ornate gold border (heavy, tied to card frame) -->
    <rect x="2" y="2" width="${width - 4}" height="${height - 4}"
          fill="none" stroke="${cfg.accent}" stroke-width="3"/>
    <!-- 3: inner thin highlight line (subtle embossed feel) -->
    <rect x="6" y="6" width="${width - 12}" height="${height - 12}"
          fill="none" stroke="${cfg.accent}" stroke-opacity="0.45" stroke-width="1"/>
    <!-- 4: corner laurel dots (Roman decorative motif) -->
    <circle cx="14"           cy="${height / 2}" r="3" fill="${cfg.accent}"/>
    <circle cx="${width - 14}" cy="${height / 2}" r="3" fill="${cfg.accent}"/>
    <!-- 5a: text shadow underlay (offset 2px for legibility on rich backgrounds) -->
    <text x="${width / 2 + 2}" y="${textY + 2}" text-anchor="middle"
          font-family="'Courier New', 'Menlo', 'Consolas', monospace"
          font-size="${fs}" font-weight="900" fill="${cfg.textShadow}">${cfg.text}</text>
    <!-- 5b: main text -->
    <text x="${width / 2}" y="${textY}" text-anchor="middle"
          font-family="'Courier New', 'Menlo', 'Consolas', monospace"
          font-size="${fs}" font-weight="900" fill="${cfg.textColor}">${cfg.text}</text>
  </svg>`);
}

(async () => {
  for (const [key, cfg] of Object.entries(HEROES)) {
    const fullPath = path.resolve(cfg.file);
    const overlay = makeBannerSvg(BANNER_INNER_WIDTH, cfg.bannerHeight, cfg);
    const outBuf = await sharp(fullPath)
      .composite([{ input: overlay, top: cfg.bannerTop, left: BANNER_INSET_X }])
      .png()
      .toBuffer();
    await sharp(outBuf).toFile(fullPath);
    console.log('rebuilt', key, '→', cfg.file, '(' + outBuf.length + ' bytes)');
  }
})();
