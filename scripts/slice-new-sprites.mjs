// One-off slicer for the new Higgsfield sheets (sheets 20-23).
// Each sheet is 1024×1024 with a 3×3 grid + magenta chroma-key background.
// Output: per-cell PNG at public/assets/sprites/, magenta stripped to alpha.

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const SRC = path.resolve(PROJECT, '..', 'sprites_new');
const OUT = path.resolve(PROJECT, 'public', 'assets', 'sprites');

const SHEETS = [
  { file: '20_weather_particles.png', prefix: 'wx_', labels: [
      'pack_dust','druidic_mist','sandstorm','necrotic_miasma','cursed_wind','hellscape',
      'mist_alt','ember_alt','wind_alt' ] },
  { file: '21_status_modifiers.png', prefix: 'mb_', labels: [
      'knockback','mark','blood_moon','storm_surge','death_pact','veil',
      'revenant','group_march','empty_round_bonus' ] },
  { file: '22_tower_abilities.png', prefix: 'ab_', labels: [
      'cleave','multishot','pierce','lance_charge','brutal_opener','aura_damage',
      'aura_speed','solar_flare','knockback_shock' ] },
  { file: '23_mutations_state.png', prefix: 'mu_', labels: [
      'veteran','swift','bloated','warded','aura_star','shield',
      'shield_broken','tower_silenced','laurel' ] },
  // Round 2 — boss portraits, aura rings, banner frames, HUD chips
  { file: '24_boss_portraits.png', prefix: 'bp_', labels: [
      'alpha_dog','celtic_warlord','hannibal_barca','war_elephant','undead_warlord',
      'undead_war_elephant','daemon_imperator','demon_legate','ghost_rider' ],
      size: 128 },
  { file: '25_aura_rings.png', prefix: 'ar_', labels: [
      'eagle_standard','aquilifer_titan','praetorian_wall','centurion_trumpet',
      'battle_standard','enemy_vuln','combo_eligible','range_indicator','range_reduced' ],
      size: 128 },
  { file: '26_event_banners.png', prefix: 'eb_', labels: [
      'boss_wave','decade_doom','final_hour','phalanx','twin_bosses','ambush_boss',
      'mercator','wave_modifier','victory' ],
      size: 256 },
  { file: '27_hud_chips.png', prefix: 'cb_', labels: [
      'parchment_small','stone_small','banner_small','parchment_wide','codex_header',
      'section_divider','button_chip','info_chip','alert_chip' ],
      size: 128 },
  // Round 3 — terrain tiles (tileable) + decorative props
  { file: '28_terrain_tiles.png', prefix: 'tt_', labels: [
      'grass_a','grass_b','grass_flowers','dirt_a','dirt_ruts','dirt_footprints',
      'grass_stones','grass_twigs','grass_dirt_edge' ],
      size: 64,
      // Don't trim/transparent-key tileable terrain — keep the full square.
      // BUT replace any leftover magenta/purple bleed with white pixels so
      // tile boundaries on the map don't show purple seams.
      noChroma: true, noTrim: true, purpleToWhite: true },
  { file: '29_decor_props.png', prefix: 'dp_', labels: [
      'milestone','urn','wooden_post','helmet','scroll','bush',
      'flowers_red','flowers_white','mushrooms' ],
      size: 32 },
  // Round 4 — 9 NEW combination towers (3 early / 3 mid / 3 late).
  // Cells in row-major order matching the labels below. 3×3 grid.
  // Higgsfield prompt should be magenta-keyed background, ~1024×1024.
  { file: '30_combo_towers_new.png', prefix: 'tc_', labels: [
      'vexillation','tesserarius','scout_vexillum',
      'stormcaller','sacer_vestal','tribunus_laticlavius',
      'nemesis_engine','triumphator','pontifex_maximus' ],
      size: 64 },
  // Round 5 — 6 combo-of-combo towers (combos require existing combo towers as
  // ingredients). 3×3 grid; 6 cells used, last 3 cells can be anything.
  { file: '31_combo_of_combos.png', prefix: 'tcc_', labels: [
      'turma_lancers','aurora_legion','storm_vexillation',
      'imperium_eternum','carthage_scourge','triumvirate',
      null, null, null ],
      size: 64 },
  // Round 6 — 3 SUPER combos (5-base-tower mega recipes). 3×3 grid, 3 used.
  { file: '32_super_combos.png', prefix: 'ts_', labels: [
      'triplex_acies','legion_prime','consular_fatebinder',
      null, null, null,
      null, null, null ],
      size: 64 }
];

const MAGENTA_TOL = 60;
function magentaToAlpha(buf) {
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i+1], b = buf[i+2];
    const dr = r - 255, dg = g, db = b - 255;
    const dist = Math.sqrt(dr*dr + dg*dg + db*db);
    if (dist < MAGENTA_TOL) buf[i+3] = 0;
    // also wipe near-white grid lines
    if (r > 240 && g > 240 && b > 240) buf[i+3] = 0;
  }
  return buf;
}

// For tile-able terrain that we keep opaque, replace any leftover magenta /
// purple-tinted edge pixels with WHITE instead of stripping them. Player
// asked for purple lines → white, since they were bleeding through the
// gridline boundaries on the map.
const PURPLE_TOL = 110;     // wider tolerance — catches faint purple bleed
function magentaToWhite(buf) {
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i+1], b = buf[i+2];
    // Detect magenta (high R, low G, high B) including faint bleeds
    const isMagentaish = r > 180 && b > 180 && g < (r * 0.6);
    if (isMagentaish) {
      buf[i] = 255; buf[i+1] = 255; buf[i+2] = 255; buf[i+3] = 255;
    }
  }
  return buf;
}

async function sliceSheet({ file, prefix, labels, size = 64, noChroma = false, noTrim = false, purpleToWhite = false }) {
  const src = path.join(SRC, file);
  const exists = await fs.stat(src).catch(() => null);
  if (!exists) { console.warn(`SKIP missing: ${file}`); return; }
  const meta = await sharp(src).metadata();
  const { width, height } = meta;
  const cellW = Math.floor(width / 3);
  const cellH = Math.floor(height / 3);
  // Tileable terrain tiles need a much bigger pad to crop out the white
  // gridline borders baked into each cell of the source sheet. Decor props
  // use a smaller pad.
  const pad = noChroma ? 48 : 8;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const label = labels[idx];
      if (!label) continue;
      const left = col * cellW + pad;
      const top = row * cellH + pad;
      const w = cellW - pad * 2;
      const h = cellH - pad * 2;
      const out = path.join(OUT, `${prefix}${label}.png`);
      let pipeline = sharp(src).extract({ left, top, width: w, height: h }).ensureAlpha();
      if (!noChroma) {
        const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
        magentaToAlpha(data);
        pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
        if (!noTrim) pipeline = pipeline.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });
      } else if (purpleToWhite) {
        // Tile-able terrain: replace any magenta/purple bleed with white pixels.
        const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
        magentaToWhite(data);
        pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      }
      await pipeline
        .resize({ width: size, height: size, fit: 'cover', kernel: 'nearest' })
        .png()
        .toFile(out);
      console.log(`  ${prefix}${label} -> ${path.relative(PROJECT, out)}`);
    }
  }
}

(async () => {
  for (const s of SHEETS) await sliceSheet(s);
  console.log('Done.');
})();
