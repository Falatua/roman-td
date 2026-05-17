// Slice 4096x4096 3x3 sprite sheets into 9 individual transparent PNGs.
// Strips magenta (#FF00FF) to alpha and the white grid lines.
//
// Run: npm run slice
// Reads from ../sprites (sibling of roman-td) and writes to public/assets/sprites/

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const SRC = path.resolve(PROJECT, '..', 'sprites');     // ../sprites
const OUT = path.resolve(PROJECT, 'public', 'assets', 'sprites');

// Sheet manifest: filename pattern, prefix, and 9 cell labels (left-to-right, top-to-bottom).
// Cells are 0-indexed.
const SHEETS = [
  { idx: 1,  file: '01_towers_base_A.png',                    prefix: 't1_', labels: [
      'milites','velites','hastati','sagittarius','scorpio','triarius','decurion','centurion','primus_pilus' ] },
  { idx: 2,  file: '02_towers_combinations_B.png',            prefix: 't2_', labels: [
      'legate','horseman','scorpion_bolt','cohort_guard','war_chariot','eagle_standard','plague_cart','numidian_cavalry','praetorian_wall' ] },
  { idx: 3,  file: '03_towers_combinations_C.png',            prefix: 't3_', labels: [
      'aerarium','siege_onager','aquilifer_titan','inferno_cart','frozen_legion','julius_caesar','hannibals_nightmare','god_of_war','decoy_totem' ] },
  { idx: 4,  file: '04_enemies_dogs_celts.png',               prefix: 'e1_', labels: [
      'feral_dog','rabid_dog','alpha_dog','celtic_footman','celtic_berserker','gallic_druid','celtic_scout','celtic_warlord','carthage_spearman' ] },
  { idx: 5,  file: '05_enemies_carthage_undead_celts.png',    prefix: 'e2_', labels: [
      'numidian_rider','carthage_elite_guard','war_elephant','hannibal_barca','undead_celt','zombie_druid','undead_berserker','spectral_scout','undead_warlord' ] },
  { idx: 6,  file: '06_enemies_undead_carthage_demons.png',   prefix: 'e3_', labels: [
      'undead_spearman','ghost_rider','undead_war_elephant','demon_hellhound','celtic_fire_demon','shadow_cavalry','demon_legate','daemon_imperator','architectus' ] },
  { idx: 7,  file: '07_projectiles.png',                      prefix: 'p_',  labels: [
      'javelin','pilum','arrow','ballista_bolt','hasta_spear','light_javelin','war_staff_shot','flaming_oil_barrel','sword_slash_vfx' ] },
  { idx: 8,  file: '08_map_tiles.png',                        prefix: 'm_',  labels: [
      'dark_cave','roman_gate','roman_gate_destroyed','stone_block','grass_a','grass_b','border_tree','border_boulder','blood_grass' ] },
  { idx: 9,  file: '09_waypoint_coins.png',                   prefix: 'w_',  labels: [
      'wp1_aquila','wp2_laurel','wp3_spqr','wp4_shewolf','wp5_fasces','wp6_jupiter','aerarium_pile','loot_orb_generic','hammer' ] },
  { idx: 10, file: '10_items_common_uncommon.png',            prefix: 'i_',  labels: [
      'sharpened_blade','iron_tip','training_scroll','watchtower_lens','flyer_bane','fire_oil_flask','poisoned_blade','cavalry_spur','centurions_trumpet' ] },
  { idx: 11, file: '11_items_rare_combos_A.png',              prefix: 'i_',  labels: [
      'gold_purse','battle_standard','iron_shield','storm_javelin','flaming_pilum','piercing_shot','commanders_crest','warlords_kit','toxic_oil' ] },
  { idx: 12, file: '12_items_rare_universal_legendaries.png', prefix: 'i_',  labels: [
      'eagle_eye','midas_touch','fortress_shield','whetstone_of_mars','tribunes_horn','aquila_standard','consuls_seal','praetorian_shield','mercurys_sandal' ] },
  { idx: 13, file: '13_legendaries_dog_celtic.png',           prefix: 'l_',  labels: [
      'sibylline_scroll','vestals_blessing','denarii_purse','alpha_pack_fang','war_hound_collar','berserkers_muzzle','druids_torc','celtic_longsword','warlords_war_paint' ] },
  { idx: 14, file: '14_legendaries_celtic_carthage_undead.png', prefix: 'l_', labels: [
      'gallic_shield_boss','druid_staff_fragment','elephant_tusk','hannibals_strategy_scroll','numidian_saddle','falcata_blade','barca_war_horn','gilded_scale_armor','cursed_torc' ] },
  { idx: 15, file: '15_undead_legendaries_consumables.png',   prefix: 'c_',  labels: [
      'necrotic_longsword','undead_elephant_bone','lich_generals_seal','rage_potion','berserkers_mead','legionarys_focus','fortify_oil','healing_draught','scouts_map' ] },
  { idx: 16, file: '16_status_effects.png',                   prefix: 's_',  labels: [
      'slow','poison','freeze','burn','armor_shred','stun','hellfire','fear','haste_vial' ] },
  { idx: 17, file: '17_loot_orbs_kill_badges.png',            prefix: 'u_',  labels: [
      'orb_common','orb_uncommon','orb_rare','orb_legendary','orb_unique','badge_bronze','badge_silver','badge_gold','cracked_base' ] },
  { idx: 18, file: '18_mercator_ui_tier_badges.png',          prefix: 'u_',  labels: [
      'mercator','mercator_cart','upgrade_altar','codex_book','tier_1','tier_2','tier_3','tier_4','tier_5' ] },
  { idx: 19, file: '19_blood_decals_fire_vfx.png',            prefix: 'v_',  labels: [
      'blood_light','blood_medium','blood_heavy','blood_saturated','fire_small','fire_large','burn_zone','smoke_puff','dust_puff' ] }
];

const MAGENTA_TOL = 60;          // how close to (255,0,255) counts as background
const WHITE_TOL = 30;             // grid-line whiteness
const LABEL_BAND_PX_FRACTION = 0.16;

async function processSheet(s) {
  const inPath = path.join(SRC, s.file);
  const buf = await fs.readFile(inPath);
  const img = sharp(buf);
  const meta = await img.metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H) throw new Error('Bad image: ' + s.file);

  // Each cell occupies W/3 x H/3 region (with grid lines and labels inside).
  const cellW = Math.floor(W / 3);
  const cellH = Math.floor(H / 3);
  // Inner crop to ditch the 2px white grid lines around each cell:
  const margin = Math.max(4, Math.floor(cellW * 0.012));
  // Reserve bottom strip for the white pixel-font label that is part of the rendered cell:
  const labelBand = Math.floor(cellH * LABEL_BAND_PX_FRACTION);

  for (let i = 0; i < 9; i++) {
    const cx = i % 3;
    const cy = Math.floor(i / 3);
    const left = cx * cellW + margin;
    const top  = cy * cellH + margin;
    const cropW = cellW - margin * 2;
    const cropH = cellH - margin * 2 - labelBand;
    if (cropW <= 0 || cropH <= 0) continue;

    const region = await sharp(buf)
      .extract({ left, top, width: cropW, height: cropH })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = region;
    // info.channels === 4
    for (let p = 0; p < data.length; p += 4) {
      const r = data[p], g = data[p+1], b = data[p+2];
      // magenta-ish -> transparent
      if (Math.abs(r - 255) < MAGENTA_TOL && g < MAGENTA_TOL && Math.abs(b - 255) < MAGENTA_TOL) {
        data[p+3] = 0;
      }
    }

    const outName = `${s.prefix}${s.labels[i]}.png`;
    const outPath = path.join(OUT, outName);
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
  }
  return s.labels.length;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  let total = 0;
  for (const s of SHEETS) {
    try {
      const n = await processSheet(s);
      total += n;
      console.log(`✔ Sliced ${s.file} → ${n} sprites`);
    } catch (err) {
      console.error(`✘ Failed ${s.file}: ${err.message}`);
    }
  }
  console.log(`\nDone. ${total} individual sprite PNGs in ${OUT}`);
}

main();
