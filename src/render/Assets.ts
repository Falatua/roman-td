import { Assets as PixiAssets, Texture, SCALE_MODES, BaseTexture, Rectangle } from 'pixi.js';

// Force every freshly-loaded texture in this session to use NEAREST
// sampling. Pixi's default is LINEAR (bilinear) which makes high-res
// source PNGs (1024×1024 tower art) look blurry when downscaled to the
// 32 px tile size. NEAREST preserves the crisp pixel-art aesthetic and
// matches the visual quality of the small (128 px) UI sprites like the
// aura rings. The static default makes the change uniform across every
// `PixiAssets.load(...)` call below — no need to set it per-texture.
BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

// Map of sprite-id -> pixi texture, resolved at boot.
const cache: Map<string, Texture> = new Map();

const BASE = 'assets/sprites/';

const MANIFEST: Record<string, string> = {
  // Towers
  MILITES: 't1_milites.png', VELITES: 't1_velites.png', HASTATI: 't1_hastati.png',
  // (Hastati attack-animation frames removed — the renderer now uses
  // the base sprite at all times. The PNG files themselves are still
  // on disk if a future revision wants to re-enable them.)
  SAGITTARIUS: 't1_sagittarius.png', SCORPIO: 't1_scorpio.png', TRIARIUS: 't1_triarius.png',
  DECURION: 't1_decurion.png', CENTURION: 't1_centurion.png', PRIMUS_PILUS: 't1_primus_pilus.png',
  LEGATE: 't2_legate.png', HORSEMAN: 't2_horseman.png', SCORPION_BOLT: 't2_scorpion_bolt.png',
  AUXILIA: 't_new_skizzer.png', FUNDIBULUS: 't_new_fundibulus.png',
  BEAST_HUNTER: 't_new_beast_hunter.png',
  BEAST_SLAYER: 't_new_beast_slayer.png',
  RORARIUS: 't_new_rorarius.png', LIBRITOR: 't_new_libritor.png', ACCENSUS: 't_new_accensus.png',
  RETIARIUS: 't_new_retiarius.png', BALLISTARIUS: 't_new_ballistarius.png',
  OPTIO: 't_new_optio.png', PUGIO_ASSASSIN: 't_new_pugio_assassin.png', ARCUBALLISTA: 't_new_arcuballista.png',
  VENATOR: 't_new_venator.png', IGNIFER: 't_new_ignifer.png',
  SPECULATOR: 't_new_speculator.png', FLAMEN: 't_new_flamen.png', CARROBALLISTA: 't_new_carroballista.png',
  CATAPHRACT: 't_new_cataphract.png', AUGUR: 't_new_augur.png',
  EVOCATUS: 't_new_evocatus.png', HARUSPEX: 't_new_haruspex.png', CLIBANARIUS: 't_new_clibanarius.png',
  PRAEFECTUS: 't_new_praefectus.png', VULCAN_ENGINEER: 't_new_vulcan_engineer.png',
  IMPERATOR_GUARD: 't_new_imperator_guard.png', SOLAR_PRIEST: 't_new_solar_priest.png', COLOSSUS_ONAGER: 't_new_colossus_onager.png',
  AQUILA_VENATOR: 't_new_aquila_venator.png',

  COHORT_GUARD: 't2_cohort_guard.png', WAR_CHARIOT: 't2_war_chariot.png', EAGLE_STANDARD: 't2_eagle_standard.png',
  PLAGUE_CART: 't2_plague_cart.png', NUMIDIAN_CAVALRY: 't_new_eques.png', PRAETORIAN_WALL: 't2_praetorian_wall.png',
  AERARIUM: 't3_aerarium.png', SIEGE_ONAGER: 't3_siege_onager.png', AQUILIFER_TITAN: 't3_aquilifer_titan.png',
  INFERNO_CART: 't3_inferno_cart.png', FROZEN_LEGION: 't3_frozen_legion.png', JULIUS_CAESAR: 't3_julius_caesar.png',
  HANNIBALS_NIGHTMARE: 't3_hannibals_nightmare.png', GOD_OF_WAR: 't3_god_of_war.png', DECOY_TOTEM: 't3_decoy_totem.png',
  // 9 new combo towers — sliced from sheet 30_combo_towers_new.png (3×3 grid)
  VEXILLATION: 'tc_vexillation.png', TESSERARIUS: 'tc_tesserarius.png', SCOUT_VEXILLUM: 'tc_scout_vexillum.png',
  STORMCALLER: 'tc_stormcaller.png', SACER_VESTAL: 'tc_sacer_vestal.png', TRIBUNUS_LATICLAVIUS: 'tc_tribunus_laticlavius.png',
  NEMESIS_ENGINE: 'tc_nemesis_engine.png', TRIUMPHATOR: 'tc_triumphator.png', PONTIFEX_MAXIMUS: 'tc_pontifex_maximus.png',
  // Cross-combo towers (combos-of-combos) — sliced from sheet 31_combo_of_combos.png (3×3, 6 used)
  TURMA_LANCERS: 'tcc_turma_lancers.png', AURORA_LEGION: 'tcc_aurora_legion.png', STORM_VEXILLATION: 'tcc_storm_vexillation.png',
  IMPERIUM_ETERNUM: 'tcc_imperium_eternum.png', CARTHAGE_SCOURGE: 'tcc_carthage_scourge.png', TRIUMVIRATE: 'tcc_triumvirate.png',
  // 3 SUPER combos — sliced from sheet 32_super_combos.png (3×3, 3 used).
  TRIPLEX_ACIES: 'ts_triplex_acies.png', LEGION_PRIME: 'ts_legion_prime.png', CONSULAR_FATEBINDER: 'ts_consular_fatebinder.png',
  // 2026 v2 spec Ch9 — Mars Victor DIVINE apex super-tower.
  MARS_VICTOR: 'ts_mars_victor.png',
  // 2026-05-15 — Two new mid-game T4 combo towers with unique mechanics
  // (cone attack + rage gauge). Both sprites are user-supplied, chroma-
  // keyed clean via tools/slice_sprite_sheet.py (zero magenta residue).
  SIGNIFERS_DRACONARIUS: 'tc_signifers_draconarius.png', BESTIARIUS: 'tc_bestiarius.png',
  // 2026-06-28 — 10 new under-represented-base combos.
  PRAETORIAN_EXECUTIONER: 'tc_praetorian_executioner.png', SACRED_BAND: 'tc_sacred_band.png',
  BEASTLORD_CHAMPION: 'tc_beastlord_champion.png', MIRMILLO_REAVER: 'tc_mirmillo_reaver.png',
  TRIBUNE_AVENGER: 'tc_tribune_avenger.png', CATAPHRACT_LANCER: 'tc_cataphract_lancer.png',
  STORM_BALLISTA: 'tc_storm_ballista.png', SKYREAPER_BATTERY: 'tc_skyreaper_battery.png',
  PLAGUE_LOBBER: 'tc_plague_lobber.png', AUGURS_WRATH: 'tc_augurs_wrath.png',
  EXPLORATORES: 'tc_exploratores.png', VULCAN_BOMBARD: 'tc_vulcan_bombard.png',
  VANGUARD_WING: 'tcc_vanguard_wing.png', VULCAN_COLOSSUS: 'tcc_vulcan_colossus.png',
  SKY_DOMINION: 'ts_sky_dominion.png', AUREATE_TRIBUNAL: 'ts_aureate_tribunal.png',
  GLACIAL_PALISADE: 'ts_glacial_palisade.png', INFERNAL_COLOSSUS: 'ts_infernal_colossus.png',
  ROMAN_TRANSFORMER: 'ts_roman_transformer.png',
  NEPTUNES_LEVIATHAN: 'naval/t_omega_neptunes_leviathan.png',
  TRIREME_BALLISTA: 'naval/t_naval_trireme_ballista.png',
  CORVUS_BOARDING_SHIP: 'naval/t_naval_corvus_boarding_ship.png',
  RAMMING_QUINQUEREME: 'naval/t_naval_ramming_quinquereme.png',
  CHARYBDIS_VORTEX: 'naval/t_naval_charybdis_vortex.png',
  NEREID_ORACLE: 'naval/t_naval_nereid_oracle.png',
  HYDRA_OF_LERNA: 'naval/t_naval_hydra_of_lerna.png',
  PRAETORIAN_FLEET: 'naval/t_tideforged_praetorian_fleet.png',
  CORVUS_LEGION_DOCK: 'naval/t_tideforged_corvus_legion_dock.png',
  ORACLE_LIGHTHOUSE: 'naval/t_tideforged_oracle_lighthouse.png',
  ABYSSAL_ONAGER: 'naval/t_tideforged_abyssal_onager.png',
  HYDRA_BEAST_PIT: 'naval/t_tideforged_hydra_beast_pit.png',
  MARS_TIDAL_BASTION: 'naval/t_tideforged_mars_tidal_bastion.png',
  // 2026-05-17 — MURMILLO (T4 mid-game combo). Heavy Roman gladiator with
  // fish-helmet + scutum + gladius. Sliced from the user-supplied gladiator
  // roster sheet (top-left cell); chroma-keyed via the standard pipeline.
  MURMILLO: 't_new_murmillo.png',
  // Enemies
  FERAL_DOG: 'e1_feral_dog.png', RABID_DOG: 'e1_rabid_dog.png', ALPHA_DOG: 'e1_alpha_dog.png',
  CELTIC_FOOTMAN: 'e1_celtic_footman.png', CELTIC_BERSERKER: 'e1_celtic_berserker.png', GALLIC_DRUID: 'e1_gallic_druid.png',
  CELTIC_SCOUT: 'e1_celtic_scout.png', CELTIC_WARLORD: 'e1_celtic_warlord.png', CARTHAGE_SPEARMAN: 'e1_carthage_spearman.png',
  NUMIDIAN_RIDER: 'e2_numidian_rider.png', CARTHAGE_ELITE_GUARD: 'e2_carthage_elite_guard.png', WAR_ELEPHANT: 'e2_war_elephant.png',
  HANNIBAL_BARCA: 'e2_hannibal_barca.png', UNDEAD_CELT: 'e2_undead_celt.png', ZOMBIE_DRUID: 'e2_zombie_druid.png',
  UNDEAD_BERSERKER: 'e2_undead_berserker.png', SPECTRAL_SCOUT: 'e2_spectral_scout.png', UNDEAD_WARLORD: 'e2_undead_warlord.png',
  UNDEAD_SPEARMAN: 'e3_undead_spearman.png', GHOST_RIDER: 'e3_ghost_rider.png', UNDEAD_WAR_ELEPHANT: 'e3_undead_war_elephant.png',
  UNDEAD_GIANT: 'e3_undead_giant.png', UNDEAD_CYCLOPS: 'e3_undead_cyclops.png',
  DREAD_UNDEAD_GIANT: 'e3_dread_undead_giant.png', DREAD_UNDEAD_CYCLOPS: 'e3_dread_undead_cyclops.png',
  DEMON_HELLHOUND: 'e3_demon_hellhound.png', CELTIC_FIRE_DEMON: 'e3_celtic_fire_demon.png', SHADOW_CAVALRY: 'e3_shadow_cavalry.png',
  DEMON_LEGATE: 'e3_demon_legate.png', DAEMON_IMPERATOR: 'e3_daemon_imperator.png', ARCHITECTUS: 'e3_architectus.png',
  IRON_PHALANX: 'e2_iron_phalanx.png',
  // 2026-05-17 — GATES OF HELL surprise event (W16 only). Hell gate is
  // a stationary "enemy" with HP that pumps out fire giants every 2s
  // alternating; fire giant is the bulky slow semi-boss.
  HELL_GATE: 'e3_hell_gate.png',
  FIRE_GIANT: 'e3_fire_giant.png',
  // 2026-05 v11: DPS CHECK training dummy — a Roman pack mule with loot
  // crates. Walks the path harmlessly while the player measures damage.
  TRAINING_DUMMY: 'e_training_dummy.png',
  // Reanimated forms — spawn at death sites on necromancy waves.
  REANIMATED_SKELETON: 'e_reanimated_skeleton.png',
  REANIMATED_ZOMBIE: 'e_reanimated_zombie.png',
  REANIMATED_LICH: 'e_reanimated_lich.png',
  // ─── ENDLESS MODE — EGYPTIANS + MONGOLS (2026-05 v10) ───────────────
  // Sliced from a 3×3 sprite-sheet drop and stored in
  // /public/assets/sprites/endless/. Sprites are auto-cropped + alpha
  // keyed so the renderer composites them onto the field cleanly.
  // 2026 v2 spec Ch6 — Vulture Imperator (W20 boss flyer); e3_ prefix = prerendered + critical.
  BOSS_FLYER_VULTURE: 'e3_boss_flyer_vulture.png',
  // 2026 v2 spec Ch10-11 — Roman-myth elite creatures (W25-29 gauntlet).
  CHIMERA: 'e3_chimera.png',
  CERBERUS: 'e3_cerberus.png',
  TYPHON: 'e3_typhon.png',
  GIANT_GIGAS: 'e3_giant_gigas.png',
  CYCLOPS: 'e3_cyclops.png',
  OCEAN_FISHLING: 'e_ocean_fishling.png',
  SEA_GIANT: 'e3_sea_giant.png',
  SEA_GIANT_WARBRINGER: 'e3_sea_giant_warbringer.png',
  NETHER_AMPHIBIOUS_GIANT: 'e3_nether_amphibious_giant.png',
  NAGA_ADEPT: 'e2_naga_adept.png',
  NAGA_SLEEPWEAVER: 'e3_naga_sleepweaver.png',
  NAGA_ORACLE: 'e3_naga_oracle.png',
  // 2026 v2 spec Ch12 — Colossus Gigas (W28 merged Super-Giant).
  SUPER_GIANT_COLOSSUS: 'e3_super_giant_colossus.png',
  // 2026 v2 spec Ch14 — Egyptian roster expansion.
  PLAGUE_BEARER: 'e3_plague_bearer.png',
  MEDJAY_SOLDIER: 'e3_medjay_soldier.png',
  // 2026-06-26 variety roster — siege carrier + fast stealth skirmisher + super-tank.
  SIEGE_WAGON: 'e3_siege_wagon.png',
  DUNE_STALKER: 'e3_dune_stalker.png',
  STONE_JUGGERNAUT: 'e3_stone_juggernaut.png',
  EGYPTIAN_ARCHER: 'endless/e_endless_egyptian_archer.png',
  EGYPTIAN_SPEARMAN: 'endless/e_endless_egyptian_spearman.png',
  EGYPTIAN_CHARIOT: 'endless/e_endless_egyptian_chariot.png',
  PHARAOH_GUARD: 'endless/e_endless_pharaoh_guard.png',
  ANUBIS_PRIEST: 'endless/e_endless_anubis_priest.png',
  SOBEK_WARRIOR: 'endless/e_endless_sobek_warrior.png',
  MUMMY_WARRIOR: 'endless/e_endless_mummy_warrior.png',
  SPHINX: 'endless/e_endless_sphinx.png',
  ANUBIS_KING: 'endless/e_endless_anubis_king.png',
  MONGOL_HORSE_ARCHER: 'endless/e_endless_mongol_horse_archer.png',
  MONGOL_SPEAR_RIDER: 'endless/e_endless_mongol_spear_rider.png',
  KHAN_RIDER: 'endless/e_endless_khan_rider.png',
  MONGOL_FOOTMAN: 'endless/e_endless_mongol_footman.png',
  MONGOL_SPEARMAN: 'endless/e_endless_mongol_spearman.png',
  MONGOL_BERSERKER: 'endless/e_endless_mongol_berserker.png',
  MONGOL_SCOUT: 'endless/e_endless_mongol_scout.png',
  MONGOL_SHAMAN: 'endless/e_endless_mongol_shaman.png',
  MONGOL_CAPTAIN: 'endless/e_endless_mongol_captain.png',
  STANDARD_BEARER_COMMANDER: 'endless/e_endless_mongol_captain.png',
  PATHFINDER_COMMANDER: 'endless/e_endless_mongol_scout.png',
  ANUBIS_PRIEST_COMMANDER: 'endless/e_endless_anubis_priest.png',
  SIEGE_CAPTAIN_COMMANDER: 'e3_demon_legate.png',
  TIDECALLER_COMMANDER: 'e3_tidecaller_commander.png',
  STORMTIDE_WYVERN_COMMANDER: 'e3_stormtide_wyvern_commander.png',
  SKY_BARGE: 'e_sky_barge.png',
  SKY_STANDARD_COMMANDER: 'e_sky_standard_commander.png',
  SKY_PATHFINDER_COMMANDER: 'e_sky_pathfinder_commander.png',
  SKY_ANUBIS_COMMANDER: 'e_sky_anubis_commander.png',
  // Projectile swap art for JUPITER'S WRATH — re-uses the storm-javelin
  // sprite so ranged towers carrying the legendary throw an electrified
  // bolt instead of their usual pilum / arrow. Plus a dedicated chain
  // animation key (drawn procedurally via Graphics, not a PNG).
  PROJ_STORM_BOLT: 'i_storm_javelin.png',
  // Map
  GRASS_A: 'm_grass_a.png', GRASS_B: 'm_grass_b.png', BLOOD_GRASS: 'm_blood_grass.png',
  // 2026-06-06 — Graveyard Keeper tileset (Higgsfield Nano Banana Pro). Moody
  // desaturated medieval map for the Green Circle. m_ prefix = critical load.
  // COZY_GRASS_A/B now hold the muted GK grass art (keys kept for the renderer).
  COZY_GRASS_A: 'm_cozy_grass_a.png', COZY_GRASS_B: 'm_cozy_grass_b.png',
  GK_PATH: 'm_gk_path.png',
  GK_GRAVESTONE: 'm_gk_gravestone.png', GK_CROSS: 'm_gk_cross.png', GK_DEADTREE: 'm_gk_deadtree.png',
  GK_BOULDER: 'm_gk_boulder.png', GK_LANTERN: 'm_gk_lantern.png', GK_BARREL: 'm_gk_barrel.png',
  GK_CRATES: 'm_gk_crates.png', GK_WELL: 'm_gk_well.png', GK_MUSHROOMS: 'm_gk_mushrooms.png',
  GK_DEADBUSH: 'm_gk_deadbush.png', GK_STUMP: 'm_gk_stump.png', GK_FENCE: 'm_gk_fence.png',
  GK_URN: 'm_gk_urn.png', GK_WHEEL: 'm_gk_wheel.png', GK_SLAB: 'm_gk_slab.png', GK_POND: 'm_gk_pond.png',
  STONE_BLOCK: 'm_stone_block.png', BORDER_TREE: 'm_border_tree.png', BORDER_BOULDER: 'm_border_boulder.png',
  // 2026-07-03 — Stone Rampart strip: five STONE_BLOCK-style marble blocks
  // joined into one continuous 5:1 wall segment (Higgsfield i2i off
  // m_stone_block.png). Drawn over intact rampart placements; rotated 90°
  // for vertical ramparts. m_ prefix keeps it on the critical load path.
  RAMPART_STRIP: 'm_rampart_strip.png',
  DARK_CAVE: 'm_dark_cave.png', ROMAN_GATE: 'm_roman_gate.png', ROMAN_GATE_DESTROYED: 'm_roman_gate_destroyed.png',
  // 2026-05-21 — VISUAL OVERHAUL: late-biome decoration pack.
  // 17 Roman shrine variants cropped from the user's reference sheets
  // (12 from first sheet 2×6, 5 from second sheet 1×5). These read as
  // ornate ruined Roman altars / banners / skull-wreathed standards
  // — perfect anchors for BIOME_UNDEAD_RUINS + BIOME_HELLSCAPE.
  MAP_SHRINE_0:  'map_overhaul/m_shrine_0.png',  MAP_SHRINE_1:  'map_overhaul/m_shrine_1.png',
  MAP_SHRINE_2:  'map_overhaul/m_shrine_2.png',  MAP_SHRINE_3:  'map_overhaul/m_shrine_3.png',
  MAP_SHRINE_4:  'map_overhaul/m_shrine_4.png',  MAP_SHRINE_5:  'map_overhaul/m_shrine_5.png',
  MAP_SHRINE_6:  'map_overhaul/m_shrine_6.png',  MAP_SHRINE_7:  'map_overhaul/m_shrine_7.png',
  MAP_SHRINE_8:  'map_overhaul/m_shrine_8.png',  MAP_SHRINE_9:  'map_overhaul/m_shrine_9.png',
  MAP_SHRINE_10: 'map_overhaul/m_shrine_10.png', MAP_SHRINE_11: 'map_overhaul/m_shrine_11.png',
  MAP_SHRINE_ALT_0: 'map_overhaul/m_shrine_alt_0.png',
  MAP_SHRINE_ALT_1: 'map_overhaul/m_shrine_alt_1.png',
  MAP_SHRINE_ALT_2: 'map_overhaul/m_shrine_alt_2.png',
  MAP_SHRINE_ALT_3: 'map_overhaul/m_shrine_alt_3.png',
  MAP_SHRINE_ALT_4: 'map_overhaul/m_shrine_alt_4.png',
  // 2026-05-22 — Corner shrine pieces (user-supplied art, 2 sheets
  // cropped to 17 individual sprites). Placed in the top-right and
  // bottom-left corners of the map for visual flair. Sheet A: 12
  // ornate Roman ruin pieces with green soul-flames + SPQR banners.
  // Sheet B: 5 sturdier shrine + SPQR + skull-on-laurel pieces.
  MAP_CORNER_SHRINE_A1:  'map_overhaul/m_corner_shrine_a1.png',
  MAP_CORNER_SHRINE_A2:  'map_overhaul/m_corner_shrine_a2.png',
  MAP_CORNER_SHRINE_A3:  'map_overhaul/m_corner_shrine_a3.png',
  MAP_CORNER_SHRINE_A4:  'map_overhaul/m_corner_shrine_a4.png',
  MAP_CORNER_SHRINE_A5:  'map_overhaul/m_corner_shrine_a5.png',
  MAP_CORNER_SHRINE_A6:  'map_overhaul/m_corner_shrine_a6.png',
  MAP_CORNER_SHRINE_A7:  'map_overhaul/m_corner_shrine_a7.png',
  MAP_CORNER_SHRINE_A8:  'map_overhaul/m_corner_shrine_a8.png',
  MAP_CORNER_SHRINE_A9:  'map_overhaul/m_corner_shrine_a9.png',
  MAP_CORNER_SHRINE_A10: 'map_overhaul/m_corner_shrine_a10.png',
  MAP_CORNER_SHRINE_A11: 'map_overhaul/m_corner_shrine_a11.png',
  MAP_CORNER_SHRINE_A12: 'map_overhaul/m_corner_shrine_a12.png',
  MAP_CORNER_SHRINE_B1:  'map_overhaul/m_corner_shrine_b1.png',
  MAP_CORNER_SHRINE_B2:  'map_overhaul/m_corner_shrine_b2.png',
  MAP_CORNER_SHRINE_B3:  'map_overhaul/m_corner_shrine_b3.png',
  MAP_CORNER_SHRINE_B4:  'map_overhaul/m_corner_shrine_b4.png',
  MAP_CORNER_SHRINE_B5:  'map_overhaul/m_corner_shrine_b5.png',
  // 2026-05-22 V14 — Necromantic Roman ruin set (user-supplied art).
  // Two sheets cropped to 11 feature pieces — ornate columns with
  // green soul-flames, SPQR banners with skull standards, stone
  // gateways, and a skull-on-laurel shrine. These are the highest-
  // fidelity feature pieces in the build; they anchor the W16-18
  // BIOME_UNDEAD_RUINS and W19-20 BIOME_HELLSCAPE prop pools.
  MAP_NECRO_RUIN_0: 'map_overhaul/m_necro_ruin_0.png',
  MAP_NECRO_RUIN_1: 'map_overhaul/m_necro_ruin_1.png',
  MAP_NECRO_RUIN_2: 'map_overhaul/m_necro_ruin_2.png',
  MAP_NECRO_RUIN_3: 'map_overhaul/m_necro_ruin_3.png',
  MAP_NECRO_BANNER_A: 'map_overhaul/m_necro_banner_a.png',
  MAP_NECRO_BANNER_B: 'map_overhaul/m_necro_banner_b.png',
  MAP_NECRO_GATE_A:  'map_overhaul/m_necro_gate_a.png',
  MAP_NECRO_GATE_B:  'map_overhaul/m_necro_gate_b.png',
  MAP_NECRO_GATE_C:  'map_overhaul/m_necro_gate_c.png',
  MAP_NECRO_STANDARD:    'map_overhaul/m_necro_standard.png',
  MAP_NECRO_SKULL_SHRINE:'map_overhaul/m_necro_skull_shrine.png',
  // 2026-05-21 — Craftpix Free Undead Tileset (license: craftpix.net
  // free file licenses). 16 curated decoration sprites for the undead
  // biomes. Pure pixel-art top-down silhouettes with built-in shadows.
  // Already on disk under public/assets/sprites/map_overhaul/.
  DP_UNDEAD_BONES_A: 'map_overhaul/m_undead_bones_a.png',
  DP_UNDEAD_BONES_B: 'map_overhaul/m_undead_bones_b.png',
  DP_UNDEAD_BONES_C: 'map_overhaul/m_undead_bones_c.png',
  DP_UNDEAD_GRAVE_A: 'map_overhaul/m_undead_grave_a.png',
  DP_UNDEAD_GRAVE_B: 'map_overhaul/m_undead_grave_b.png',
  DP_UNDEAD_GRAVE_C: 'map_overhaul/m_undead_grave_c.png',
  DP_UNDEAD_DEAD_TREE_A: 'map_overhaul/m_undead_dead_tree_a.png',
  DP_UNDEAD_DEAD_TREE_B: 'map_overhaul/m_undead_dead_tree_b.png',
  DP_UNDEAD_BROKEN_TREE: 'map_overhaul/m_undead_broken_tree.png',
  DP_UNDEAD_RUIN_A: 'map_overhaul/m_undead_ruin_a.png',
  DP_UNDEAD_RUIN_B: 'map_overhaul/m_undead_ruin_b.png',
  DP_UNDEAD_RUIN_C: 'map_overhaul/m_undead_ruin_c.png',
  DP_UNDEAD_SKULL_PILE_A: 'map_overhaul/m_undead_skull_pile_a.png',
  DP_UNDEAD_SKULL_PILE_B: 'map_overhaul/m_undead_skull_pile_b.png',
  DP_UNDEAD_ROCK: 'map_overhaul/m_undead_rock.png',
  DP_UNDEAD_THORN: 'map_overhaul/m_undead_thorn.png',
  DP_UNDEAD_PLANT: 'map_overhaul/m_undead_plant.png',
  // 2026-05-21 V9 — Additional craftpix variants for more decoration
  // diversity across the 3 undead biomes (W11-15, W16-18, W19-20).
  DP_UNDEAD_BONES_D: 'map_overhaul/m_undead_bones_d.png',
  DP_UNDEAD_BONES_E: 'map_overhaul/m_undead_bones_e.png',
  DP_UNDEAD_BONES_F: 'map_overhaul/m_undead_bones_f.png',
  DP_UNDEAD_CRYSTAL_A: 'map_overhaul/m_undead_crystal_a.png',
  DP_UNDEAD_CRYSTAL_B: 'map_overhaul/m_undead_crystal_b.png',
  DP_UNDEAD_CRYSTAL_C: 'map_overhaul/m_undead_crystal_c.png',
  DP_UNDEAD_DEAD_ARM_A: 'map_overhaul/m_undead_dead_arm_a.png',
  DP_UNDEAD_DEAD_ARM_B: 'map_overhaul/m_undead_dead_arm_b.png',
  DP_UNDEAD_DEAD_ARM_C: 'map_overhaul/m_undead_dead_arm_c.png',
  DP_UNDEAD_GRAVE_D: 'map_overhaul/m_undead_grave_d.png',
  DP_UNDEAD_GRAVE_E: 'map_overhaul/m_undead_grave_e.png',
  DP_UNDEAD_GRAVE_F: 'map_overhaul/m_undead_grave_f.png',
  DP_UNDEAD_DEAD_TREE_C: 'map_overhaul/m_undead_dead_tree_c.png',
  DP_UNDEAD_DEAD_TREE_D: 'map_overhaul/m_undead_dead_tree_d.png',
  DP_UNDEAD_BROKEN_TREE_B: 'map_overhaul/m_undead_broken_tree_b.png',
  DP_UNDEAD_ROCK_B: 'map_overhaul/m_undead_rock_b.png',
  DP_UNDEAD_ROCK_C: 'map_overhaul/m_undead_rock_c.png',
  DP_UNDEAD_RUIN_D: 'map_overhaul/m_undead_ruin_d.png',
  DP_UNDEAD_RUIN_E: 'map_overhaul/m_undead_ruin_e.png',
  DP_UNDEAD_SKULL_PILE_C: 'map_overhaul/m_undead_skull_pile_c.png',
  DP_UNDEAD_PLANT_B: 'map_overhaul/m_undead_plant_b.png',
  DP_UNDEAD_THORN_B: 'map_overhaul/m_undead_thorn_b.png',
  // Skull-doors — candidate undead-cave entrance sprites.
  MAP_CAVE_UNDEAD_DOOR_A: 'map_overhaul/m_cave_undead_door_a.png',
  MAP_CAVE_UNDEAD_DOOR_B: 'map_overhaul/m_cave_undead_door_b.png',
  MAP_CAVE_UNDEAD_DOOR_C: 'map_overhaul/m_cave_undead_door_c.png',
  // 2026-05-22 — User-supplied Cave + Rome reference sprites reverted
  // per design feedback. Caves for W1-W10 now fall back to the
  // procedural cave frame + DARK_CAVE silhouette; the universal gate
  // render falls back to ROMAN_GATE. The user-supplied sprite PNGs
  // remain on disk under map_overhaul/ but are no longer manifested.
  // 2026-05-21 — V13 ornate aura tile medallions (Higgsfield nano_banana_pro
  // generated). Each tile gets a unique iconography sigil per effect:
  //   PURPLE/Tempo  → SPQR + winged emblem + lightning (speed)
  //   BLUE/War      → roaring lion + crossed gladii (damage)
  //   RED/Tyrant    → eagle clutching crown + chains (boss-slayer)
  //   CYAN/Aether   → winged feather + wave crests (anti-flyer)
  //   GOLD/Treasury → Roman emperor profile + laurel wreath + coins
  //   EMERALD/Tower → all-seeing eye + watchtower silhouettes (range)
  //   TIDE/Ocean    → shell + wave sigil + teal gem (slow on hit)
  MAP_AURA_PURPLE:  'map_overhaul/m_aura_purple.png',
  MAP_AURA_BLUE:    'map_overhaul/m_aura_blue.png',
  MAP_AURA_RED:     'map_overhaul/m_aura_red.png',
  MAP_AURA_CYAN:    'map_overhaul/m_aura_cyan.png',
  MAP_AURA_GOLD:    'map_overhaul/m_aura_gold.png',
  MAP_AURA_EMERALD: 'map_overhaul/m_aura_emerald.png',
  MAP_AURA_IVORY:   'map_overhaul/m_aura_ivory.png',
  MAP_AURA_AMBER:   'map_overhaul/m_aura_amber.png',
  MAP_AURA_TIDE:    'map_overhaul/m_aura_tide.png',
  // Waypoints
  WP1: 'w_wp1_aquila.png', WP2: 'w_wp2_laurel.png', WP3: 'w_wp3_spqr.png',
  WP4: 'w_wp4_shewolf.png', WP5: 'w_wp5_fasces.png', WP6: 'w_wp6_jupiter.png',
  // WP7 reuses the fasces coin — only 6 unique sprites exist, but every
  // checkpoint needs a coin so the 7th aliases an existing one.
  WP7: 'w_wp7_mars.png',
  // Projectiles
  PROJ_JAVELIN: 'p_javelin.png', PROJ_PILUM: 'p_pilum.png', PROJ_ARROW: 'p_arrow.png',
  PROJ_BALLISTA: 'p_ballista_bolt.png', PROJ_HASTA: 'p_hasta_spear.png', PROJ_LIGHT_JAVELIN: 'p_light_javelin.png',
  PROJ_STAFF: 'p_war_staff_shot.png', PROJ_BARREL: 'p_flaming_oil_barrel.png', PROJ_SLASH: 'p_sword_slash_vfx.png',
  // 2026-05 v7: Plague Cart lobs a sickly-green poison cloud instead of
  // borrowing the orange Flaming Oil Barrel sprite. Re-uses the
  // s_poison status-badge texture as the in-flight sprite — drawn
  // with a green tint + lingering green trail in drawProjectiles.
  PROJ_POISON_CLOUD: 's_poison.png',
  // 2026-05 v10: supernatural projectile family — divine + magical
  // casters fire thematic sprites instead of the generic war-staff bolt.
  // Each key reuses an existing status/ability/loot-orb asset; no new
  // pixel art was authored. Mapping:
  //   PROJ_HELLFIRE_BOLT   — God of War's stamped HELLFIRE flame
  //   PROJ_SOLAR_FLARE     — Solar Priest's radiant sun
  //   PROJ_VESTAL_BLESSING — Sacer Vestal's sacred-flame bowl
  //   PROJ_OMEN_ORB        — Augur's divination orb (rare blue)
  //   PROJ_SIBYL_SCROLL    — Haruspex's prophecy scroll
  //   PROJ_IMPERIAL_ORB    — Julius Caesar's imperial fire orb (legendary)
  //   PROJ_DIVINE_APEX_ORB — Imperium Eternum / Consular Fatebinder apex
  //   PROJ_FROST_SHARD     — Frozen Legion's snowflake bolt
  PROJ_HELLFIRE_BOLT:   's_hellfire.png',
  PROJ_SOLAR_FLARE:     'ab_solar_flare.png',
  PROJ_VESTAL_BLESSING: 'l_vestals_blessing.png',
  PROJ_OMEN_ORB:        'u_orb_rare.png',
  PROJ_SIBYL_SCROLL:    'l_sibylline_scroll.png',
  PROJ_IMPERIAL_ORB:    'u_orb_legendary.png',
  PROJ_DIVINE_APEX_ORB: 'u_orb_unique.png',
  PROJ_FROST_SHARD:     's_freeze.png',
  // Status icons
  S_SLOW: 's_slow.png', S_POISON: 's_poison.png', S_FREEZE: 's_freeze.png',
  S_BURN: 's_burn.png', S_SHRED: 's_armor_shred.png', S_STUN: 's_stun.png',
  S_HELLFIRE: 's_hellfire.png', S_FEAR: 's_fear.png',
  // UI
  CODEX_BOOK: 'u_codex_book.png', UPGRADE_ALTAR: 'u_upgrade_altar.png',
  TIER_1: 'u_tier_1.png', TIER_2: 'u_tier_2.png', TIER_3: 'u_tier_3.png', TIER_4: 'u_tier_4.png', TIER_5: 'u_tier_5.png',
  ORB_COMMON: 'u_orb_common.png', ORB_UNCOMMON: 'u_orb_uncommon.png', ORB_RARE: 'u_orb_rare.png',
  ORB_EPIC: 'u_orb_rare.png',
  ORB_LEGENDARY: 'u_orb_legendary.png', ORB_UNIQUE: 'u_orb_unique.png',
  BADGE_BRONZE: 'u_badge_bronze.png', BADGE_SILVER: 'u_badge_silver.png', BADGE_GOLD: 'u_badge_gold.png',
  CRACKED_BASE: 'u_cracked_base.png',
  // VFX
  BLOOD_LIGHT: 'v_blood_light.png', BLOOD_MEDIUM: 'v_blood_medium.png',
  BLOOD_HEAVY: 'v_blood_heavy.png', BLOOD_SATURATED: 'v_blood_saturated.png',
  FIRE_SMALL: 'v_fire_small.png', FIRE_LARGE: 'v_fire_large.png',
  BURN_ZONE: 'v_burn_zone.png', SMOKE_PUFF: 'v_smoke_puff.png', DUST_PUFF: 'v_dust_puff.png',
  // 2026-05-16 — surprise-event sprites (INVASION fires already above; UPRISING skull-urn here)
  SKULL_URN: 'v_skull_urn.png',
  // Mercator vendor art
  MERCATOR: 'u_mercator.png', MERCATOR_CART: 'u_mercator_cart.png',
  // ─── ITEM SPRITES — 2026-05-20 v3 full regeneration ────────────────────
  // Every shop/inventory/boss-drop item has a UNIQUE sprite. Five sheets
  // generated via Higgs Field (nano_banana_pro at 1024×1024) and cropped
  // into 67 individual 128×128 PNGs under the `inew_` prefix. Replaces
  // the prior manifest which reused 27 base sprites across 67 items
  // (e.g. QUICKDRAW_GLOVES + MERCURY_FEATHER both pointed at the same
  // mercurys_sandal sprite — duplicate visuals fixed here).
  //
  // Sheet 1 — Weapons (16 items)
  ITEM_SHARPENED_BLADE: 'inew_sharpened_blade.png',
  ITEM_BARBED_GLADIUS: 'inew_barbed_gladius.png',
  ITEM_POISONED_BLADE: 'inew_poisoned_blade.png',
  ITEM_FALCATA_BLADE: 'inew_falcata_blade.png',
  ITEM_CELTIC_LONGSWORD: 'inew_celtic_longsword.png',
  ITEM_NECROTIC_LONGSWORD: 'inew_necrotic_longsword.png',
  ITEM_FALX_BLADE: 'inew_falx_blade.png',
  ITEM_EXECUTIONERS_FALX: 'inew_executioners_falx.png',
  ITEM_CONCUSSIVE_WARHEAD: 'inew_concussive_warhead.png',
  ITEM_SPEAR_OF_MARS: 'inew_spear_of_mars.png',
  ITEM_RUSTED_HASTA: 'inew_rusted_hasta.png',
  ITEM_VANGUARD_PILUM: 'inew_vanguard_pilum.png',
  ITEM_SKYPIERCER_BOLTS: 'inew_skypiercer_bolts.png',
  ITEM_FALCONERS_WATCHPOST: 'inew_falconers_watchpost.png',
  ITEM_JUPITERS_SKYFIRE: 'inew_jupiters_skyfire.png',
  ITEM_STORM_AQUILA_TALONS: 'inew_storm_aquila_talons.png',
  // 2026 v2 — consumable trap sprites (placed on the map, drawn pulsing).
  TRAP_IRON_SPIKE: 'trap_iron_spike.png',
  TRAP_VENOM: 'trap_venom.png',
  TRAP_TAR_FIRE: 'trap_tar_fire.png',
  TRAP_FROST: 'trap_frost.png',
  TRAP_BALLISTA: 'trap_ballista.png',
  TRAP_SKY_NET: 'trap_sky_net.png',
  ITEM_STORM_JAVELIN: 'inew_storm_javelin.png',
  ITEM_JUPITERS_WRATH: 'inew_jupiters_wrath.png',
  ITEM_CAPITOLINE_AEGIS: 'inew_capitoline_aegis.png',
  ITEM_IRON_TIP: 'inew_iron_tip.png',
  ITEM_AUXILIARY_SLING: 'inew_auxiliary_sling.png',
  ITEM_VOLLEY_QUIVER: 'inew_volley_quiver.png',
  ITEM_VENOM_TIPPED_ARROWS: 'inew_venom_tipped_arrows.png',
  // Sheet 2 — Armor & Gear (16 items)
  ITEM_GILDED_SCALE_ARMOR: 'inew_gilded_scale_armor.png',
  ITEM_BRONZE_GREAVES: 'inew_bronze_greaves.png',
  ITEM_GALLIC_SHIELD_BOSS: 'inew_gallic_shield_boss.png',
  ITEM_AQUILA_RAMPART: 'inew_aquila_rampart.png',
  ITEM_CAVALRY_SPUR: 'inew_cavalry_spur.png',
  ITEM_NUMIDIAN_SADDLE: 'inew_numidian_saddle.png',
  ITEM_QUICKDRAW_GLOVES: 'inew_quickdraw_gloves.png',
  ITEM_MERCURY_FEATHER: 'inew_mercury_feather.png',
  ITEM_BERSERKERS_MUZZLE: 'inew_berserkers_muzzle.png',
  ITEM_WAR_HOUND_COLLAR: 'inew_war_hound_collar.png',
  ITEM_ALPHA_PACK_FANG: 'inew_alpha_pack_fang.png',
  ITEM_ELEPHANT_TUSK: 'inew_elephant_tusk.png',
  ITEM_UNDEAD_ELEPHANT_BONE: 'inew_undead_elephant_bone.png',
  ITEM_WARLORDS_WAR_PAINT: 'inew_warlords_war_paint.png',
  ITEM_WATCHTOWER_LENS: 'inew_watchtower_lens.png',
  ITEM_FLYER_BANE: 'inew_flyer_bane.png',
  // 2026-05-22 V23 — Truesight Lens (UNCOMMON, Mercator). Reuses the
  // already-on-disk i_eagle_eye.png sprite — uses the original eagle-eye
  // artwork (eye motif fits "see through stealth"). Effect lives in
  // CombatResolver.tickCombat: one copy anywhere enables map-wide
  // truesight on stealth + ambush enemies.
  ITEM_TRUESIGHT_LENS: 'i_eagle_eye.png',
  // Sheet 3 — Standards & Scrolls (16 items)
  ITEM_BATTLE_STANDARD: 'inew_battle_standard.png',
  ITEM_AQUILIFER_BANNER: 'inew_aquilifer_banner.png',
  ITEM_INFERNO_STANDARD: 'inew_inferno_standard.png',
  ITEM_CENTURIONS_TRUMPET: 'inew_centurions_trumpet.png',
  ITEM_OPTIO_WHISTLE: 'inew_optio_whistle.png',
  ITEM_BARCA_WAR_HORN: 'inew_barca_war_horn.png',
  ITEM_AUGUR_SCROLL: 'inew_augur_scroll.png',
  ITEM_SCIPIO_PLAYBOOK: 'inew_scipio_playbook.png',
  ITEM_PUNIC_LEDGER: 'inew_punic_ledger.png',
  ITEM_HANNIBALS_STRATEGY_SCROLL: 'inew_hannibals_strategy_scroll.png',
  ITEM_TRAINING_SCROLL: 'inew_training_scroll.png',
  ITEM_HOURGLASS_OF_SATURN: 'inew_hourglass_of_saturn.png',
  ITEM_CONSULAR_TOKEN: 'inew_consular_token.png',
  ITEM_LICTOR_FASCES: 'inew_lictor_fasces.png',
  ITEM_TYRIAN_DYE: 'inew_tyrian_dye.png',
  ITEM_DRUIDS_TORC: 'inew_druids_torc.png',
  // Sheet 4 — Divine & Relics (16 items)
  ITEM_SIGIL_OF_SOL_INVICTUS: 'inew_sigil_of_sol_invictus.png',
  ITEM_TYRANTS_LAUREL: 'inew_tyrants_laurel.png',
  ITEM_VESTAL_PYRE: 'inew_vestal_pyre.png',
  ITEM_SERPENT_AMULET: 'inew_serpent_amulet.png',
  ITEM_WITCHS_VENOM: 'inew_witchs_venom.png',
  ITEM_AQUILA_TALONS: 'inew_aquila_talons.png',
  ITEM_DEMONSWORN_CROWN: 'inew_demonsworn_crown.png',
  ITEM_CURSED_TORC: 'inew_cursed_torc.png',
  ITEM_LICH_GENERALS_SEAL: 'inew_lich_generals_seal.png',
  ITEM_DRUID_STAFF_FRAGMENT: 'inew_druid_staff_fragment.png',
  ITEM_FIRE_OIL_FLASK: 'inew_fire_oil_flask.png',
  ITEM_PERIMETER_TORCH: 'inew_perimeter_torch.png',
  ITEM_GRAVEKEEPERS_SCYTHE: 'inew_gravekeepers_scythe.png',
  ITEM_SOULFIRE_BRAND: 'inew_soulfire_brand.png',
  ITEM_NECROMANCERS_LANTERN: 'inew_necromancers_lantern.png',
  ITEM_HELLGATE_BRAND: 'inew_hellgate_brand.png',
  // Sheet 5 — Coins & Misc (3 items)
  ITEM_GOLD_PURSE: 'inew_gold_purse.png',
  ITEM_PRAETORIAN_COIN: 'inew_praetorian_coin.png',
  ITEM_DAMNATIO_MEMORIAE: 'inew_damnatio_memoriae.png',
  ITEM_BRINEHOOK_ROPE: 'inew_brinehook_rope.png',
  ITEM_TIDEPIERCER_HARPOON: 'inew_tidepiercer_harpoon.png',
  ITEM_AEGEAN_PEARL: 'inew_aegean_pearl.png',
  ITEM_STORMGLASS_AMPHORA: 'inew_stormglass_amphora.png',
  ITEM_NEPTUNES_TRIDENT: 'inew_neptunes_trident.png',
  // Legacy keys preserved for backward compatibility — some are
  // referenced by event-reward modals or older tower-info panels.
  // These map to the closest-thematic new sprite so nothing breaks.
  ITEM_IRON_SHIELD: 'inew_gallic_shield_boss.png',
  ITEM_EAGLE_EYE: 'inew_watchtower_lens.png',
  ITEM_MIDAS_TOUCH: 'inew_gold_purse.png',
  ITEM_FORTRESS_SHIELD: 'inew_aquila_rampart.png',
  ITEM_WHETSTONE_OF_MARS: 'inew_sharpened_blade.png',
  ITEM_TRIBUNES_HORN: 'inew_centurions_trumpet.png',
  ITEM_AQUILA_STANDARD: 'inew_aquilifer_banner.png',
  ITEM_CONSULS_SEAL: 'inew_consular_token.png',
  ITEM_PRAETORIAN_SHIELD: 'inew_gilded_scale_armor.png',
  ITEM_MERCURYS_SANDAL: 'inew_mercury_feather.png',
  ITEM_FLAMING_PILUM: 'inew_vanguard_pilum.png',
  ITEM_PIERCING_SHOT: 'inew_iron_tip.png',
  ITEM_COMMANDERS_CREST: 'inew_aquila_rampart.png',
  ITEM_WARLORDS_KIT: 'inew_warlords_war_paint.png',
  ITEM_TOXIC_OIL: 'inew_fire_oil_flask.png',
  ITEM_SIBYLLINE_SCROLL: 'inew_augur_scroll.png',
  ITEM_VESTALS_BLESSING: 'inew_vestal_pyre.png',
  ITEM_DENARII_PURSE: 'inew_gold_purse.png',
  // Consumables
  ITEM_RAGE_POTION: 'c_rage_potion.png',
  ITEM_BERSERKERS_MEAD: 'c_berserkers_mead.png',
  ITEM_LEGIONARYS_FOCUS: 'c_legionarys_focus.png',
  ITEM_FORTIFY_OIL: 'c_fortify_oil.png',
  ITEM_HEALING_DRAUGHT: 'c_healing_draught.png',
  ITEM_SCOUTS_MAP: 'c_scouts_map.png',
  ITEM_HASTE_VIAL: 's_haste_vial.png',
  ITEM_DECOY_TOTEM: 't3_decoy_totem.png',
  // Aerarium decorative pile + generic loot orb fallback
  AERARIUM_PILE: 'w_aerarium_pile.png',
  LOOT_ORB_GENERIC: 'w_loot_orb_generic.png',
  ARCHITECTUS_HAMMER: 'w_hammer.png',
  // ─── NEW HIGGSFIELD SPRITES (sheets 20-23) ─────────────────────────
  // Faction weather particles (used in RenderEngine.drawWeather)
  WX_PACK_DUST: 'wx_pack_dust.png',
  WX_DRUIDIC_MIST: 'wx_druidic_mist.png',
  WX_SANDSTORM: 'wx_sandstorm.png',
  WX_NECROTIC_MIASMA: 'wx_necrotic_miasma.png',
  WX_CURSED_WIND: 'wx_cursed_wind.png',
  WX_HELLSCAPE: 'wx_hellscape.png',
  // Status badges + wave modifier icons
  MB_KNOCKBACK: 'mb_knockback.png',
  MB_MARK: 'mb_mark.png',
  MB_BLOOD_MOON: 'mb_blood_moon.png',
  MB_STORM_SURGE: 'mb_storm_surge.png',
  MB_DEATH_PACT: 'mb_death_pact.png',
  MB_VEIL: 'mb_veil.png',
  MB_REVENANT: 'mb_revenant.png',
  MB_GROUP_MARCH: 'mb_group_march.png',
  MB_EMPTY_ROUND_BONUS: 'mb_empty_round_bonus.png',
  // Tower ability icons (used in TowerMenu + Codex MECHANICS tab)
  AB_CLEAVE: 'ab_cleave.png',
  AB_MULTISHOT: 'ab_multishot.png',
  AB_PIERCE: 'ab_pierce.png',
  AB_LANCE_CHARGE: 'ab_lance_charge.png',
  AB_BRUTAL_OPENER: 'ab_brutal_opener.png',
  AB_AURA_DAMAGE: 'ab_aura_damage.png',
  AB_AURA_SPEED: 'ab_aura_speed.png',
  AB_SOLAR_FLARE: 'ab_solar_flare.png',
  AB_KNOCKBACK_SHOCK: 'ab_knockback_shock.png',
  // Elite mutation badges + game-state icons
  MU_VETERAN: 'mu_veteran.png',
  MU_SWIFT: 'mu_swift.png',
  MU_BLOATED: 'mu_bloated.png',
  MU_WARDED: 'mu_warded.png',
  MU_AURA_STAR: 'mu_aura_star.png',
  MU_SHIELD: 'mu_shield.png',
  MU_SHIELD_BROKEN: 'mu_shield_broken.png',
  MU_TOWER_SILENCED: 'mu_tower_silenced.png',
  MU_LAUREL: 'mu_laurel.png',
  // ─── ROUND 2 SPRITES (sheets 24-27) ────────────────────────────────
  // Boss portraits — used in boss banner + Codex BOSS SIGNATURES
  BP_ALPHA_DOG: 'bp_alpha_dog.png',
  BP_CELTIC_WARLORD: 'bp_celtic_warlord.png',
  BP_HANNIBAL_BARCA: 'bp_hannibal_barca.png',
  BP_WAR_ELEPHANT: 'bp_war_elephant.png',
  BP_UNDEAD_WARLORD: 'bp_undead_warlord.png',
  BP_UNDEAD_WAR_ELEPHANT: 'bp_undead_war_elephant.png',
  BP_DAEMON_IMPERATOR: 'bp_daemon_imperator.png',
  BP_DEMON_LEGATE: 'bp_demon_legate.png',
  BP_GHOST_RIDER: 'bp_ghost_rider.png',
  // Aura ring textures — replace the procedural Graphics circles
  AR_EAGLE_STANDARD: 'ar_eagle_standard.png',
  AR_AQUILIFER_TITAN: 'ar_aquilifer_titan.png',
  AR_PRAETORIAN_WALL: 'ar_praetorian_wall.png',
  AR_CENTURION_TRUMPET: 'ar_centurion_trumpet.png',
  AR_BATTLE_STANDARD: 'ar_battle_standard.png',
  AR_ENEMY_VULN: 'ar_enemy_vuln.png',
  AR_COMBO_ELIGIBLE: 'ar_combo_eligible.png',
  AR_RANGE_INDICATOR: 'ar_range_indicator.png',
  AR_RANGE_REDUCED: 'ar_range_reduced.png',
  // Event banner frames — overlay text on these instead of CSS gradients
  EB_BOSS_WAVE: 'eb_boss_wave.png',
  EB_DECADE_DOOM: 'eb_decade_doom.png',
  EB_FINAL_HOUR: 'eb_final_hour.png',
  EB_PHALANX: 'eb_phalanx.png',
  EB_TWIN_BOSSES: 'eb_twin_bosses.png',
  EB_AMBUSH_BOSS: 'eb_ambush_boss.png',
  EB_MERCATOR: 'eb_mercator.png',
  EB_WAVE_MODIFIER: 'eb_wave_modifier.png',
  EB_VICTORY: 'eb_victory.png',
  // HUD chip backgrounds + Codex headers
  CB_PARCHMENT_SMALL: 'cb_parchment_small.png',
  CB_STONE_SMALL: 'cb_stone_small.png',
  CB_BANNER_SMALL: 'cb_banner_small.png',
  CB_PARCHMENT_WIDE: 'cb_parchment_wide.png',
  CB_CODEX_HEADER: 'cb_codex_header.png',
  CB_SECTION_DIVIDER: 'cb_section_divider.png',
  CB_BUTTON_CHIP: 'cb_button_chip.png',
  CB_INFO_CHIP: 'cb_info_chip.png',
  CB_ALERT_CHIP: 'cb_alert_chip.png',
  // ─── ROUND 3 SPRITES (sheets 28-29) ───────────────────────────────
  // Tileable terrain — used by RenderEngine.drawStatic to actually fill the map
  TT_GRASS_A: 'tt_grass_a.png',
  TT_GRASS_B: 'tt_grass_b.png',
  TT_GRASS_FLOWERS: 'tt_grass_flowers.png',
  TT_DIRT_A: 'tt_dirt_a.png',
  TT_DIRT_RUTS: 'tt_dirt_ruts.png',
  TT_DIRT_FOOTPRINTS: 'tt_dirt_footprints.png',
  TT_GRASS_STONES: 'tt_grass_stones.png',
  TT_GRASS_TWIGS: 'tt_grass_twigs.png',
  TT_GRASS_DIRT_EDGE: 'tt_grass_dirt_edge.png',
  // Ocean reserve terrain — small authored 32px pixel tiles so the
  // bottom-left cove reads as water, shoreline, and coastal life instead
  // of flat blue paint.
  OCEAN_DEEP_A: 'm_ocean_deep_a.png',
  OCEAN_DEEP_B: 'm_ocean_deep_b.png',
  OCEAN_MID_A: 'm_ocean_mid_a.png',
  OCEAN_MID_B: 'm_ocean_mid_b.png',
  OCEAN_SHALLOW_A: 'm_ocean_shallow_a.png',
  OCEAN_SHALLOW_B: 'm_ocean_shallow_b.png',
  OCEAN_FOAM_N: 'm_ocean_foam_n.png',
  OCEAN_FOAM_E: 'm_ocean_foam_e.png',
  OCEAN_FOAM_S: 'm_ocean_foam_s.png',
  OCEAN_FOAM_W: 'm_ocean_foam_w.png',
  OCEAN_KELP: 'm_ocean_kelp.png',
  OCEAN_CORAL: 'm_ocean_coral.png',
  OCEAN_FISH: 'm_ocean_fish.png',
  OCEAN_ROCK: 'm_ocean_rock.png',
  OCEAN_SHORE_SHELLS: 'm_ocean_shore_shells.png',
  OCEAN_SHORE_STARFISH: 'm_ocean_shore_starfish.png',
  OCEAN_SHORE_PEBBLES: 'm_ocean_shore_pebbles.png',
  OCEAN_SHORE_DRIFTWOOD: 'm_ocean_shore_driftwood.png',
  OCEAN_SHORE_FOAM_BITS: 'm_ocean_shore_foam_bits.png',
  OCEAN_SHORE_WET_ROCKS: 'm_ocean_shore_wet_rocks.png',
  OCEAN_SHORE_ITALY_ROCKS_A: 'm_ocean_shore_italy_rocks_a.png',
  OCEAN_SHORE_ITALY_ROCKS_B: 'm_ocean_shore_italy_rocks_b.png',
  OCEAN_SHORE_ITALY_ROCKS_C: 'm_ocean_shore_italy_rocks_c.png',
  OCEAN_SHIPWRECK: 'm_ocean_shipwreck.png',
  // Decorative props — sprinkled atop grass tiles
  DP_MILESTONE: 'dp_milestone.png',
  DP_URN: 'dp_urn.png',
  DP_WOODEN_POST: 'dp_wooden_post.png',
  DP_HELMET: 'dp_helmet.png',
  DP_SCROLL: 'dp_scroll.png',
  DP_BUSH: 'dp_bush.png',
  DP_FLOWERS_RED: 'dp_flowers_red.png',
  DP_FLOWERS_WHITE: 'dp_flowers_white.png',
  DP_MUSHROOMS: 'dp_mushrooms.png',
  // 2026-05-19 — Hero sprites (Higgs Field generated, pixel-art with
  // transparent backgrounds). Keys match the TowerType enum so the
  // renderer's `tex(tw.type)` lookup picks them up automatically.
  HERO_MARIUS:   '../heroes/hero_marius.png',
  HERO_AGRIPPA:  '../heroes/hero_agrippa.png',
  HERO_AGRICOLA: '../heroes/hero_agricola.png',
  HERO_SCIPIO:   '../heroes/hero_scipio.png',
  HERO_CAESAR:   '../heroes/hero_caesar.png',
  HERO_SULLA:    '../heroes/hero_sulla.png',
  CHAMPION_MARIUS:   '../heroes/hero_marius.png',
  CHAMPION_AGRIPPA:  '../heroes/hero_agrippa.png',
  CHAMPION_AGRICOLA: '../heroes/hero_agricola.png',
  CHAMPION_SCIPIO:   '../heroes/hero_scipio.png',
  CHAMPION_CAESAR:   '../heroes/hero_caesar.png',
  CHAMPION_SULLA:    '../heroes/hero_sulla.png',
  HERO_ATTACK_MARIUS:   '../heroes/attacks/hero_marius_attack_sheet.png',
  HERO_ATTACK_AGRIPPA:  '../heroes/attacks/hero_agrippa_attack_sheet.png',
  HERO_ATTACK_AGRICOLA: '../heroes/attacks/hero_agricola_attack_sheet.png',
  HERO_ATTACK_SCIPIO:   '../heroes/attacks/hero_scipio_attack_sheet.png',
  HERO_ATTACK_CAESAR:   '../heroes/attacks/hero_caesar_attack_sheet.png',
  HERO_ATTACK_SULLA:    '../heroes/attacks/hero_sulla_attack_sheet.png',
  PROJ_SULLA_METEOR:    '../heroes/attacks/sulla_meteor_projectile.png',
  SULLA_METEOR_PROJECTILE: '../heroes/attacks/sulla_meteor_projectile_sheet.png',
  SULLA_METEOR_IMPACT:     '../heroes/attacks/sulla_meteor_impact_sheet.png',
  // 2026-06-29 — Dedicated per-ability hero VFX sprites (hfx_*). Each of
  // the 11 non-Meteor hero abilities now has its own unique projectile/
  // emblem instead of borrowing a tower/item/PROJ texture. Live under
  // heroes/attacks/ so isCriticalAsset() force-loads them on the critical
  // path (abilities can fire on W1). Consumed by drawHeroAbilityFx().
  HFX_MARIAN_STANDARD: '../heroes/attacks/hfx_marian_standard.png',  // Marius — Marian Formation (violet signum)
  HFX_CAPITE_PILUM:    '../heroes/attacks/hfx_capite_pilum.png',     // Marius — Capite Censi (amber levy pilum)
  HFX_PILUM_VOLLEY:    '../heroes/attacks/hfx_pilum_volley.png',     // Agrippa — Pilum Volley (steel-blue javelin)
  HFX_NAVAL_SHELL:     '../heroes/attacks/hfx_naval_shell.png',      // Agrippa — Naval Bombardment (fire-pot shell)
  HFX_SCOUT_EAGLE:     '../heroes/attacks/hfx_scout_eagle.png',      // Agricola — Eagle Scout (silver diving aquila)
  HFX_FRONTIER_WALL:   '../heroes/attacks/hfx_frontier_wall.png',    // Agricola — Frontier Wall (palisade rampart)
  HFX_CORNU_CHARGE:    '../heroes/attacks/hfx_cornu_charge.png',     // Scipio — Cornu Charge (brass war horn)
  HFX_SCIPIO_BRAND:    '../heroes/attacks/hfx_scipio_brand.png',     // Scipio — Scipio's Brand (red-hot branding iron)
  HFX_SPQR_DECREE:     '../heroes/attacks/hfx_spqr_decree.png',      // Caesar — SPQR Decree (golden aquila standard)
  HFX_PAX_LAUREL:      '../heroes/attacks/hfx_pax_laurel.png',       // Caesar — Pax Romana (gold laurel + olive)
  HFX_PROSCRIPTION:    '../heroes/attacks/hfx_proscription.png',     // Sulla — Proscription (flaming condemnation tablet)
  // 2026-05-20 v2 — Hero tower halo rings. Layered under each hero
  // sprite at render time so the player can see at a glance "this is
  // the hero, not a regular T1/T2 tower." 9 styles cropped from a
  // user-provided ring sheet; one assigned per hero matching their
  // tint + theme (see HERO_RING_FOR in RenderEngine). The remaining
  // 3 rings (CRIMSON_DRIP, SKULL_SILVER, PLAIN_WHITE) are reserved
  // for future hero additions or special states.
  HERO_RING_SUN_HALO:       'hero_ring_sun_halo.png',       // Caesar
  HERO_RING_LAUREL_WREATH:  'hero_ring_laurel_wreath.png',  // Agricola
  HERO_RING_RUNIC_BLUE:     'hero_ring_runic_blue.png',     // Agrippa
  HERO_RING_CROSSED_SWORDS: 'hero_ring_crossed_swords.png', // Marius
  HERO_RING_CRIMSON_DRIP:   'hero_ring_crimson_drip.png',
  HERO_RING_SKULL_SILVER:   'hero_ring_skull_silver.png',
  HERO_RING_FLAME_RED:      'hero_ring_flame_red.png',      // Sulla
  HERO_RING_PLAIN_WHITE:    'hero_ring_plain_white.png',
  HERO_RING_GOLD_ROPE:      'hero_ring_gold_rope.png'       // Scipio
};

export const BASE_TOWER_ATTACK_TYPES = [
  'VELITES',
  'SAGITTARIUS',
  'SCORPIO',
  'LEGATE',
  'FUNDIBULUS',
  'RORARIUS',
  'BALLISTARIUS',
  'OPTIO',
  'ARCUBALLISTA',
  'VENATOR',
  'IGNIFER',
  'SPECULATOR',
  'FLAMEN',
  'CARROBALLISTA',
  'AUGUR',
  'HARUSPEX',
  'PRAEFECTUS',
  'VULCAN_ENGINEER',
  'SOLAR_PRIEST',
  'COLOSSUS_ONAGER',
  'AQUILA_VENATOR'
] as const;

Object.assign(MANIFEST, Object.fromEntries(
  BASE_TOWER_ATTACK_TYPES.map(type => [`ATTACK_${type}`, `attacks/atk_${type.toLowerCase()}.png`])
));

// Sprite-quality fix: tower / enemy / item sprites are stored as
// high-resolution PNGs (1024×1024 or 1333×1115), which would force
// PIXI to re-sample dramatically downscaled textures every frame at
// fractional sprite positions — causing the shimmer / blur the player
// noticed when comparing the in-game render to the Codex's HTML <img>
// thumbnails. The Codex's <img image-rendering:pixelated> downsamples
// the source ONCE at load time to a crisp pixel-art bitmap.
//
// We do the same trick here: when a sprite file is in one of the asset
// families that get rendered small in-game (towers, enemies, items),
// draw it to an off-screen canvas at a fixed pre-render size with
// `imageSmoothingEnabled = false`, then build the cached PIXI texture
// from that canvas. The DOM-side `__srcPath` still points at the
// original high-res PNG so Codex / TowerMenu / portrait UIs render at
// full resolution; only the in-game PIXI texture is the downscaled
// version. PIXI's per-frame sampling now operates on a small bitmap
// that's already close to the rendered size, so there's no aliasing
// or jitter as sprites move at fractional positions.
const SPRITE_PRERENDER_SIZE = 96;
const PRERENDER_PREFIXES = ['t1_', 't2_', 't3_', 't_new_', 'tc_', 'tcc_', 'ts_', 'e_', 'e2_', 'i_', 'l_'];

function shouldPrerender(file: string): boolean {
  // 2026-05 v10: assets under `endless/` (Mongol + Egyptian sprites)
  // come from a subfolder so file.startsWith('e_') reads the directory
  // segment, not the basename. Strip leading folder before the prefix
  // check so the prerender pipeline catches them too.
  const basename = file.includes('/') ? file.slice(file.lastIndexOf('/') + 1) : file;
  return PRERENDER_PREFIXES.some(p => basename.startsWith(p));
}

function preRenderToCrispBitmap(source: HTMLImageElement | HTMLCanvasElement, target: number): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas');
    const srcW = (source as any).width ?? (source as any).naturalWidth ?? 0;
    const srcH = (source as any).height ?? (source as any).naturalHeight ?? 0;
    if (!srcW || !srcH) return null;
    // Preserve aspect ratio: longest side = target.
    const ratio = Math.min(target / srcW, target / srcH);
    c.width = Math.max(1, Math.round(srcW * ratio));
    c.height = Math.max(1, Math.round(srcH * ratio));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    // The critical line — disables browser bilinear smoothing so the
    // downsample is true nearest-neighbor pixel art.
    (ctx as any).imageSmoothingEnabled = false;
    (ctx as any).webkitImageSmoothingEnabled = false;
    (ctx as any).mozImageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  } catch { return null; }
}

// Load a single sprite by [key, file] pair. Used by both the critical
// path (awaited before the coin-slot unlocks) and the deferred path
// (kicked off as a background pool). Returns nothing — populates the
// shared `cache` map and runs the same prerender/NEAREST pipeline.
async function loadOneSprite(key: string, file: string): Promise<void> {
  try {
    const url = BASE + file;
    let tex = await PixiAssets.load(url);
    if (tex && shouldPrerender(file)) {
      const baseRes: any = (tex as any).baseTexture?.resource;
      const srcEl: HTMLImageElement | HTMLCanvasElement | undefined =
        baseRes?.source ?? baseRes?.imageBitmap ?? baseRes?.image;
      if (srcEl) {
        const bmp = preRenderToCrispBitmap(srcEl, SPRITE_PRERENDER_SIZE);
        if (bmp) tex = Texture.from(bmp);
      }
    }
    if (tex && (tex as any).baseTexture) {
      (tex as any).baseTexture.scaleMode = SCALE_MODES.NEAREST;
    }
    (tex as any).__srcPath = url;
    cache.set(key, tex);
  } catch (e) {
    console.warn('Asset load failed:', file, e);
  }
}

// 2026-05-17 — CRITICAL ASSET PREDICATE.
// The loading screen used to await every single sprite (~280 of them)
// in a sequential for-await loop, blocking the coin slot for the whole
// download. That was the slowest part of first-load on GitHub Pages.
//
// Now we split the manifest into two buckets:
//   1. CRITICAL — needed for the first wave to render correctly:
//      map tiles, waypoints, base T1 towers, W1-W5 enemies, primary
//      projectiles, status badges. ~80 sprites total.
//   2. DEFERRED — everything else: combo towers, late-game enemies,
//      endless-mode roster, item icons, advanced projectiles, etc.
//
// Critical assets load in PARALLEL (Promise.all over the bucket) — the
// browser can saturate its HTTP/2 connection rather than serializing
// one sprite at a time. Deferred assets stream in the background while
// the player is still on the loading screen or in the early waves; by
// the time they unlock a combo tower or open the shop, those assets
// are almost certainly already cached.
//
// File-prefix predicate covers the manifest cleanly:
//   m_  → map tiles                CRITICAL
//   w_  → waypoint coins           CRITICAL
//   t1_ → tier-1 base tower art    CRITICAL
//   t2_ → tier-2 base tower art    CRITICAL (W2+ promotions show up fast)
//   e1_ → W1-W4 enemies            CRITICAL
//   p_  → primary projectiles      CRITICAL
//   s_  → status badges            CRITICAL
//   u_  → ui badges/tier rings     CRITICAL
//   ab_ → ally aura ring textures  CRITICAL
//   eb_ → enemy aura ring textures CRITICAL
//   t_new_ → reskinned base + a few combos; treat as CRITICAL too
//   everything else (tc_, tcc_, ts_, e2_, e3_, e_, i_, l_, c_, mb_,
//   wx_, v_, endless/, etc.) → DEFERRED
//
// 2026-05-19 — Gates-of-Hell event assets (e3_hell_gate.png +
// e3_fire_giant.png) promoted to CRITICAL by explicit allow-list.
// Reason: SANDBOX mode jumps directly to W16 before the deferred
// batch finishes, so the W16 Hell Gate event would render with
// missing-texture fallback (a blank or default sprite). Event-
// exclusive enemies should always be ready when the event fires.
function isCriticalAsset(file: string): boolean {
  if (file === 'e3_hell_gate.png' || file === 'e3_fire_giant.png') return true;
  if (/(\/|^)attacks\//.test(file)) return true;
  // 2026-05-19 — Hero sprites are critical so they're cached before
  // the player places their drafted hero on W1. The choose-hero modal
  // fires right after name entry, and the player can drop the hero
  // within seconds of the modal closing. Deferred-bucket parallel
  // loads are usually fast enough but the monogram fallback would
  // briefly flicker if the player is quick — and these sprites are
  // small (~1MB each, six total).
  if (/(\/|^)heroes\//.test(file)) return true;
  // 2026-05-21 — Visual overhaul map sprites must be critical so the
  // biome decoration, shrines, and skull-door caves all appear on the
  // first frame after wave start. Otherwise the player would see the
  // old DARK_CAVE / sparse decor briefly before deferred load kicks
  // in. The map_overhaul/ subdirectory holds the new shrine, undead
  // prop, and skull-door sprites.
  if (/(\/|^)map_overhaul\//.test(file)) return true;
  // 2026-05-22 — Player report: "After I pick a hero the map sometimes
  // looks like a cheap 2D game." Root cause: terrain (tt_*) + decor
  // prop (dp_*) sprites are deferred. If the player marches in before
  // the background batch finishes, drawStatic's `tex()` lookups return
  // null and the renderer falls back to flat-color rectangles (path =
  // brown, grass = green) plus zero decorations. Result: the map looks
  // like procedural placeholder art. Promoting these prefixes to
  // critical adds ~150 KB to the blocking load (~30 sprites at 2-5 KB
  // each) — negligible on broadband, ~1.5 s on 3G. Worth it: the
  // first-frame visual quality is now deterministic regardless of how
  // fast the player taps through hero pick. See also the
  // `rtd:assets-deferred-done` retry event below for a defense-in-
  // depth re-draw once the rest of the deferred batch arrives.
  return /^(m_|w_|t1_|t2_|tt_|dp_|e1_|p_|s_|u_|ab_|eb_|t_new_)/.test(file);
}

export async function loadAllAssets(onProgress?: (loaded: number, total: number) => void) {
  const entries = Object.entries(MANIFEST);
  const critical = entries.filter(([, file]) => isCriticalAsset(file));
  const deferred = entries.filter(([, file]) => !isCriticalAsset(file));

  let loaded = 0;
  const totalCritical = critical.length;

  // PARALLEL critical-asset load. Pixi's Assets.load() is safe to call
  // concurrently — its internal cache deduplicates same-URL requests.
  // Promise.all lets the browser fire all critical fetches at once and
  // saturate HTTP/2 multiplexing.
  await Promise.all(critical.map(async ([key, file]) => {
    await loadOneSprite(key, file);
    loaded++;
    onProgress?.(loaded, totalCritical);
  }));

  // Coin slot unlocks here. The deferred bucket loads in the background
  // without blocking the player; we don't await this Promise. By the
  // time the player reaches W6+ or opens the shop, the relevant deferred
  // assets are almost always already in cache. Missing-asset fallback
  // (a blank texture) is handled gracefully by Pixi if we ever miss.
  // Concurrency-limited to 12 parallel loads so we don't choke the
  // browser's connection pool on networks with a low per-origin cap.
  //
  // 2026-05-22 — When the deferred batch finishes, dispatch a
  // `rtd:assets-deferred-done` event on the window. main.ts listens
  // for it and re-runs renderer.drawStatic() so any biome decoration
  // that landed late gets baked into the static layer. Defense in
  // depth: even if a prefix slips out of the critical set, the
  // post-load redraw rescues the visuals on the next frame.
  (async () => {
    const CONCURRENCY = 12;
    let next = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (next < deferred.length) {
        const idx = next++;
        const [key, file] = deferred[idx];
        await loadOneSprite(key, file);
      }
    });
    await Promise.all(workers);
    prewarmAttackFrameCache();
    _deferredDone = true;     // flag for main.ts race-window guard
    try {
      if (typeof window !== 'undefined') {
        (window as any).__rtdAssetsDeferredDone = true;
        window.dispatchEvent(new CustomEvent('rtd:assets-deferred-done', {
          detail: { totalDeferred: deferred.length }
        }));
      }
    } catch { /* ignore — non-fatal */ }
  })();
}

export function tex(key: string): Texture | null {
  return cache.get(key) ?? null;
}

const frameCache: Map<string, Texture> = new Map();

export function texFrame(key: string, frame: number, frameW: number, frameH: number): Texture | null {
  const sheet = cache.get(key);
  if (!sheet) return null;
  const idx = Math.max(0, Math.floor(frame));
  const cacheKey = `${key}:${idx}:${frameW}x${frameH}`;
  const cached = frameCache.get(cacheKey);
  if (cached) return cached;
  const out = new Texture(sheet.baseTexture, new Rectangle(idx * frameW, 0, frameW, frameH));
  out.baseTexture.scaleMode = SCALE_MODES.NEAREST;
  frameCache.set(cacheKey, out);
  return out;
}

export function texGridFrame(key: string, frame: number, frameW: number, frameH: number, columns: number): Texture | null {
  const sheet = cache.get(key);
  if (!sheet) return null;
  const idx = Math.max(0, Math.floor(frame));
  const col = idx % columns;
  const row = Math.floor(idx / columns);
  const cacheKey = `${key}:grid:${idx}:${frameW}x${frameH}:c${columns}`;
  const cached = frameCache.get(cacheKey);
  if (cached) return cached;
  const out = new Texture(sheet.baseTexture, new Rectangle(col * frameW, row * frameH, frameW, frameH));
  out.baseTexture.scaleMode = SCALE_MODES.NEAREST;
  frameCache.set(cacheKey, out);
  return out;
}

export function prewarmAttackFrameCache(): void {
  const HERO_ATTACK_KEYS = [
    'HERO_ATTACK_MARIUS',
    'HERO_ATTACK_AGRIPPA',
    'HERO_ATTACK_AGRICOLA',
    'HERO_ATTACK_SCIPIO',
    'HERO_ATTACK_CAESAR',
    'HERO_ATTACK_SULLA'
  ];
  for (const key of HERO_ATTACK_KEYS) {
    for (let frame = 0; frame < 9; frame++) texGridFrame(key, frame, 256, 256, 3);
  }
  for (const type of BASE_TOWER_ATTACK_TYPES) {
    const key = `ATTACK_${type}`;
    for (let frame = 0; frame < 9; frame++) texGridFrame(key, frame, 128, 128, 3);
  }
}

// 2026-05-22 — Deferred-batch completion flag. Set to true when the
// deferred Promise.all in loadAllAssets resolves. main.ts checks this
// AFTER drawStatic to handle the race where deferred completes BEFORE
// the listener is registered. Without the flag, fast players who
// marched in well after the deferred batch finished would never
// trigger the redraw because the once-event had already fired into
// empty space. With the flag, main.ts can detect "already done" and
// schedule the redraw immediately.
let _deferredDone = false;
export function isDeferredLoadComplete(): boolean { return _deferredDone; }
export function markDeferredDoneForTesting(v: boolean) { _deferredDone = v; }

// Robust asset-URL lookup for DOM-side `<img src>` usage. Different Pixi v7
// resource types expose the source URL on different fields (.src on
// ImageResource, .url on SVGResource, etc.). We also stash __srcPath on
// the texture itself in loadAllAssets so we always have a fallback even
// if the resource type doesn't expose either property. Returns null when
// the key isn't loaded — caller should provide a placeholder.
export function texUrl(key: string): string | null {
  const t = cache.get(key);
  if (!t) return null;
  const res: any = t.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
}

export const ASSET_KEYS = MANIFEST;
