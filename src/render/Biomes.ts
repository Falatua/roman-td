// ─────────────────────────────────────────────────────────────────────
// BIOMES (2026-05-21) — visual-only theme system
//
// 6 biome variants mapped to wave bands. Each biome contributes:
//   • Tint overlay (global multiply-blend on bg)
//   • Grass tile probability weights (lush vs dark vs ashen)
//   • Decoration prop pool (universal + biome-specific)
//   • Path tileset key prefix (sunny / mossy / scorched)
//   • Cave variant key (one of 6 distinct cave sprites)
//   • Static battle debris anchor list (curated tile positions)
//
// This file holds DATA ONLY. The render pipeline (RenderEngine.ts)
// reads from these tables — no gameplay logic, no enemy/tower code.
//
// Until the Higgsfield-generated sheets land, biome profiles fall
// back to the existing manifest keys (TT_GRASS_A, DP_BUSH, etc.) so
// the system can ship without new art. As sheets crop, swap the key
// references and the look upgrades automatically.
// ─────────────────────────────────────────────────────────────────────

export type BiomeId =
  | 'BIOME_GRASSLAND'        // W1-3 (dogs)
  | 'BIOME_CELTIC_WOOD'      // W4-6 (celts)
  | 'BIOME_CARTHAGE_ARID'    // W7-10 (carthage)
  | 'BIOME_UNDEAD_FOREST'    // W11-15 (undead celts)
  | 'BIOME_UNDEAD_RUINS'     // W16-18 (undead carthage)
  | 'BIOME_HELLSCAPE';       // W19-20 (super demons)

export interface BiomeProfile {
  id: BiomeId;
  /** Display name, surfaced in debug overlays only — never user-facing. */
  name: string;
  /**
   * Global tint applied as multiply-blend overlay on bgGfx.
   * color: 24-bit hex; alpha: 0..1. Set alpha to 0 for no tint.
   */
  tint: { color: number; alpha: number };
  /**
   * Grass tile probability weights — must sum to 100. Tile keys
   * reference the existing manifest until new biome-specific grass
   * variants land.
   */
  grassWeights: { key: string; weight: number }[];
  /**
   * Decoration prop pool (universal ∪ biome-specific). Picker rolls
   * uniformly within this pool. Existing 9 keys today; expands as new
   * prop sheets crop in Phase 4.
   */
  propPool: string[];
  /**
   * Path tileset key prefix. Auto-tile picker concatenates with the
   * piece suffix (e.g. `PATH_SUNNY_` + `H` → `PATH_SUNNY_H`). Until
   * the path sheets crop, all biomes fall back to the existing dirt
   * texture set.
   */
  pathPrefix: string;
  /**
   * Cave entrance sprite key. One key per biome — 6 total sprites
   * generated in Phase 1. Falls back to `DARK_CAVE` until the new
   * caves crop.
   */
  caveKey: string;
}

// 2026-05-21 — Profile table. Tints are intentionally subtle (alpha
// 0.06-0.12) so the underlying terrain still reads clearly. Stronger
// tints make the map look like it's behind a colored gel.
export const BIOMES: Record<BiomeId, BiomeProfile> = {
  BIOME_GRASSLAND: {
    id: 'BIOME_GRASSLAND',
    name: 'Sunny Grassland',
    tint: { color: 0xffe4a0, alpha: 0.10 },     // warm sunlight wash (bumped 0.04 → 0.10 for visibility)
    grassWeights: [
      { key: 'TT_GRASS_A', weight: 50 },
      { key: 'TT_GRASS_B', weight: 30 },
      { key: 'TT_GRASS_FLOWERS', weight: 8 },
      { key: 'TT_GRASS_STONES', weight: 6 },
      { key: 'TT_GRASS_TWIGS', weight: 6 }
    ],
    propPool: [
      'DP_BUSH', 'DP_FLOWERS_RED', 'DP_FLOWERS_WHITE', 'DP_MUSHROOMS',
      'DP_HELMET', 'DP_SCROLL', 'DP_WOODEN_POST', 'DP_MILESTONE'
    ],
    pathPrefix: 'PATH_SUNNY_',
    caveKey: 'MAP_CAVE_GRASSLAND'
  },
  BIOME_CELTIC_WOOD: {
    id: 'BIOME_CELTIC_WOOD',
    name: 'Celtic Woodland',
    tint: { color: 0x2a4a30, alpha: 0.16 },     // forest cool-green wash (bumped 0.08 → 0.16)
    grassWeights: [
      { key: 'TT_GRASS_B', weight: 50 },        // dark grass bias
      { key: 'TT_GRASS_A', weight: 25 },
      { key: 'TT_GRASS_TWIGS', weight: 12 },
      { key: 'TT_GRASS_STONES', weight: 8 },
      { key: 'TT_GRASS_FLOWERS', weight: 5 }
    ],
    propPool: [
      // Universal subset
      'DP_BUSH', 'DP_MUSHROOMS', 'DP_WOODEN_POST', 'DP_MILESTONE',
      'DP_FLOWERS_WHITE',
      // 2026-05-21 — Celtic-themed substitutes from craftpix pack.
      // The undead pack's rocks + dead trees + ruins double as Celtic
      // megaliths, fallen oaks, and mossy stones in a dark forest tint.
      'DP_UNDEAD_RUIN_A', 'DP_UNDEAD_BROKEN_TREE', 'DP_UNDEAD_ROCK',
      'DP_UNDEAD_DEAD_TREE_A', 'DP_UNDEAD_PLANT'
    ],
    pathPrefix: 'PATH_SUNNY_',                  // same cobble, mossier tint
    // 2026-05-22 — Reverted off the user-supplied grassland cave per
    // design feedback. MAP_CAVE_CELTIC has no sprite registered, so
    // the renderer falls through to DARK_CAVE + procedural stone
    // frame for the W4-6 cave look.
    caveKey: 'MAP_CAVE_CELTIC'
  },
  BIOME_CARTHAGE_ARID: {
    id: 'BIOME_CARTHAGE_ARID',
    name: 'Carthage Arid',
    tint: { color: 0xc09060, alpha: 0.18 },     // dusty sandstone wash (bumped 0.08 → 0.18)
    grassWeights: [
      { key: 'TT_GRASS_A', weight: 35 },
      { key: 'TT_GRASS_STONES', weight: 25 },   // more rocks
      { key: 'TT_GRASS_TWIGS', weight: 20 },    // dry brush
      { key: 'TT_GRASS_B', weight: 15 },
      { key: 'TT_GRASS_FLOWERS', weight: 5 }
    ],
    propPool: [
      'DP_HELMET', 'DP_WOODEN_POST', 'DP_MILESTONE', 'DP_BUSH',
      // 2026-05-21 — Carthage substitutes from craftpix. Dead trees
      // double as cypress silhouettes against the arid wash, helmets +
      // weathered ruins as Punic battle relics. The arid biome tint
      // (0.18 tan alpha) blends the dark sprites into the desert tone.
      'DP_UNDEAD_DEAD_TREE_A', 'DP_UNDEAD_DEAD_TREE_C',
      'DP_UNDEAD_BROKEN_TREE', 'DP_UNDEAD_ROCK', 'DP_UNDEAD_ROCK_B',
      'DP_FLOWERS_WHITE'
    ],
    pathPrefix: 'PATH_SUNNY_',                  // same cobble, sand-edged
    // 2026-05-22 — Reverted off the user-supplied grassland cave per
    // design feedback. MAP_CAVE_CARTHAGE has no sprite registered, so
    // the renderer falls through to DARK_CAVE + procedural stone
    // frame for the W7-10 cave look.
    caveKey: 'MAP_CAVE_CARTHAGE'
  },
  BIOME_UNDEAD_FOREST: {
    id: 'BIOME_UNDEAD_FOREST',
    name: 'Undead Forest',
    tint: { color: 0x1a2030, alpha: 0.28 },     // dark mist + cool tone (bumped 0.16 → 0.28)
    grassWeights: [
      { key: 'TT_GRASS_B', weight: 60 },
      { key: 'TT_GRASS_A', weight: 18 },
      { key: 'TT_GRASS_STONES', weight: 10 },
      { key: 'TT_GRASS_TWIGS', weight: 10 },
      { key: 'TT_GRASS_FLOWERS', weight: 2 }
    ],
    propPool: [
      'DP_MUSHROOMS', 'DP_WOODEN_POST', 'DP_SCROLL', 'DP_MILESTONE',
      // 2026-05-21 — Craftpix undead-pack sprites (already on disk).
      // Heavy weight here because UNDEAD_FOREST is the first "really
      // dark" biome and we want the player to feel the tonal shift.
      'DP_UNDEAD_GRAVE_A', 'DP_UNDEAD_GRAVE_B', 'DP_UNDEAD_GRAVE_C',
      'DP_UNDEAD_GRAVE_D', 'DP_UNDEAD_GRAVE_E', 'DP_UNDEAD_GRAVE_F',
      'DP_UNDEAD_DEAD_TREE_A', 'DP_UNDEAD_DEAD_TREE_B',
      'DP_UNDEAD_DEAD_TREE_C', 'DP_UNDEAD_DEAD_TREE_D',
      'DP_UNDEAD_BROKEN_TREE', 'DP_UNDEAD_BROKEN_TREE_B',
      'DP_UNDEAD_BONES_A', 'DP_UNDEAD_BONES_B', 'DP_UNDEAD_BONES_C',
      'DP_UNDEAD_BONES_D', 'DP_UNDEAD_BONES_E', 'DP_UNDEAD_BONES_F',
      'DP_UNDEAD_DEAD_ARM_A', 'DP_UNDEAD_DEAD_ARM_B', 'DP_UNDEAD_DEAD_ARM_C',
      'DP_UNDEAD_THORN', 'DP_UNDEAD_THORN_B',
      'DP_UNDEAD_PLANT', 'DP_UNDEAD_PLANT_B',
      'DP_UNDEAD_ROCK', 'DP_UNDEAD_ROCK_B', 'DP_UNDEAD_ROCK_C'
    ],
    pathPrefix: 'PATH_MOSSY_',
    // Skull-door from craftpix replaces the Higgsfield-pending cave
    // sprite — saves a token, fits the dark-biome aesthetic perfectly.
    caveKey: 'MAP_CAVE_UNDEAD_DOOR_A'
  },
  BIOME_UNDEAD_RUINS: {
    id: 'BIOME_UNDEAD_RUINS',
    name: 'Undead Ruins',
    tint: { color: 0x402850, alpha: 0.26 },     // purple miasma cast (bumped 0.14 → 0.26)
    grassWeights: [
      { key: 'TT_GRASS_B', weight: 50 },
      { key: 'TT_GRASS_STONES', weight: 25 },
      { key: 'TT_GRASS_TWIGS', weight: 15 },
      { key: 'TT_GRASS_A', weight: 8 },
      { key: 'TT_GRASS_FLOWERS', weight: 2 }
    ],
    propPool: [
      'DP_HELMET', 'DP_SCROLL', 'DP_WOODEN_POST',
      // 2026-05-21 — Craftpix ruins + Roman shrine monuments (user
      // assets). The shrines are higher-fidelity feature pieces;
      // weighting them alongside the craftpix ruins gives the biome
      // a "fallen empire among the bones" read.
      'DP_UNDEAD_RUIN_A', 'DP_UNDEAD_RUIN_B', 'DP_UNDEAD_RUIN_C',
      'DP_UNDEAD_RUIN_D', 'DP_UNDEAD_RUIN_E',
      'DP_UNDEAD_SKULL_PILE_A', 'DP_UNDEAD_SKULL_PILE_B', 'DP_UNDEAD_SKULL_PILE_C',
      'DP_UNDEAD_GRAVE_C', 'DP_UNDEAD_GRAVE_F',
      'DP_UNDEAD_CRYSTAL_A',
      'DP_UNDEAD_DEAD_ARM_A',
      // Roman shrines — split across the late biomes for variety.
      // Ruin variants live here (broken altars, fallen columns).
      'MAP_SHRINE_6', 'MAP_SHRINE_7', 'MAP_SHRINE_8',
      'MAP_SHRINE_9', 'MAP_SHRINE_10', 'MAP_SHRINE_11',
      'MAP_SHRINE_ALT_0', 'MAP_SHRINE_ALT_3', 'MAP_SHRINE_ALT_4',
      // 2026-05-22 V14 — Necromantic Roman ruin set. The "ruin"
      // pieces (columns + arches with green soul-flames) anchor
      // BIOME_UNDEAD_RUINS as the "fallen empire among the bones"
      // hero pieces. Gates A/B/C land here too — they look like
      // entrances to a forgotten necropolis.
      'MAP_NECRO_RUIN_0', 'MAP_NECRO_RUIN_1',
      'MAP_NECRO_RUIN_2', 'MAP_NECRO_RUIN_3',
      'MAP_NECRO_GATE_A', 'MAP_NECRO_GATE_B', 'MAP_NECRO_GATE_C'
    ],
    pathPrefix: 'PATH_MOSSY_',                  // heavier moss tint
    // Skull-door variant B for the ruins-tier cave — slightly more
    // ornate than the W11-15 forest cave so the biome shift reads.
    caveKey: 'MAP_CAVE_UNDEAD_DOOR_B'
  },
  BIOME_HELLSCAPE: {
    id: 'BIOME_HELLSCAPE',
    name: 'Demon Hellscape',
    tint: { color: 0x701818, alpha: 0.34 },     // crimson ember wash (bumped 0.18 → 0.34)
    grassWeights: [
      { key: 'TT_GRASS_TWIGS', weight: 50 },    // mostly scorched
      { key: 'TT_GRASS_STONES', weight: 30 },
      { key: 'TT_GRASS_B', weight: 12 },
      { key: 'TT_GRASS_A', weight: 6 },
      { key: 'TT_GRASS_FLOWERS', weight: 2 }
    ],
    propPool: [
      'DP_HELMET', 'DP_WOODEN_POST',
      // 2026-05-21 — Most-ornate Roman shrines anchor the hellscape
      // biome (apex monuments with SPQR banners + skull wreaths +
      // eagle standards). The reference shrines from the 1×5 sheet
      // have the strongest "demonic Rome" energy — banners on fire,
      // skulls, ruined doorways — fit the W19-20 hellscape best.
      'MAP_SHRINE_0', 'MAP_SHRINE_1', 'MAP_SHRINE_2',
      'MAP_SHRINE_3', 'MAP_SHRINE_4', 'MAP_SHRINE_5',
      'MAP_SHRINE_ALT_1', 'MAP_SHRINE_ALT_2',
      // 2026-05-22 V14 — Necromantic Roman ruin set apex pieces.
      // The SPQR BANNERS + SKULL-WREATH SHRINE + SKULL STANDARD are
      // the strongest "demonic Rome" energy in the build — red banners
      // with eagles, skulls on poles, ruined columns with green soul-
      // flames. These anchor BIOME_HELLSCAPE as the final-form biome.
      'MAP_NECRO_BANNER_A', 'MAP_NECRO_BANNER_B',
      'MAP_NECRO_STANDARD', 'MAP_NECRO_SKULL_SHRINE',
      // Craftpix skulls + bones round out the field debris.
      'DP_UNDEAD_BONES_C', 'DP_UNDEAD_BONES_E', 'DP_UNDEAD_BONES_F',
      'DP_UNDEAD_SKULL_PILE_A', 'DP_UNDEAD_SKULL_PILE_B', 'DP_UNDEAD_SKULL_PILE_C',
      'DP_UNDEAD_DEAD_TREE_A', 'DP_UNDEAD_DEAD_TREE_C',
      'DP_UNDEAD_BROKEN_TREE', 'DP_UNDEAD_BROKEN_TREE_B',
      'DP_UNDEAD_RUIN_A', 'DP_UNDEAD_RUIN_D',
      // Crystals fit hellscape best — glowing energy formations.
      'DP_UNDEAD_CRYSTAL_A', 'DP_UNDEAD_CRYSTAL_B', 'DP_UNDEAD_CRYSTAL_C',
      // Dead arms emerging from cracked earth — pure hellscape vibe.
      'DP_UNDEAD_DEAD_ARM_B', 'DP_UNDEAD_DEAD_ARM_C'
    ],
    pathPrefix: 'PATH_DEMON_',
    // Skull-door variant C — most demonic of the three for the W19-20
    // finale. Still pending a true demon-mouth Higgsfield generation
    // if you want that later; the craftpix skull-door reads well as
    // a placeholder.
    caveKey: 'MAP_CAVE_UNDEAD_DOOR_C'
  }
};

/**
 * Wave → biome lookup. Maps the campaign's 20 waves into 6 biome
 * bands. Endless mode (wave > 20) maps via the active endless faction
 * — set on `state.endlessWaveCfg.faction` — back to one of the 6
 * biomes. Falls back to BIOME_GRASSLAND for any unknown state.
 *
 * `wave` is the campaign wave number (1-indexed). `endlessFaction`
 * is read from state.endlessWaveCfg?.faction (string id like
 * 'UNDEAD_CELTS') when wave > 20.
 */
export function biomeForWave(wave: number, endlessFaction?: string): BiomeId {
  // Endless override — late waves loop through the faction biomes
  // procedurally. Use the cfg faction if provided.
  if (wave > 20 && endlessFaction) {
    return ENDLESS_FACTION_TO_BIOME[endlessFaction] ?? 'BIOME_HELLSCAPE';
  }
  if (wave <= 3) return 'BIOME_GRASSLAND';
  if (wave <= 6) return 'BIOME_CELTIC_WOOD';
  if (wave <= 10) return 'BIOME_CARTHAGE_ARID';
  if (wave <= 15) return 'BIOME_UNDEAD_FOREST';
  if (wave <= 18) return 'BIOME_UNDEAD_RUINS';
  return 'BIOME_HELLSCAPE';      // W19-20 and any endless overrun
}

const ENDLESS_FACTION_TO_BIOME: Record<string, BiomeId> = {
  DOGS: 'BIOME_GRASSLAND',
  CELTS: 'BIOME_CELTIC_WOOD',
  CARTHAGE: 'BIOME_CARTHAGE_ARID',
  UNDEAD_CELTS: 'BIOME_UNDEAD_FOREST',
  UNDEAD_CARTHAGE: 'BIOME_UNDEAD_RUINS',
  SUPER_DEMONS: 'BIOME_HELLSCAPE',
  // 2026-05 v10 endless-mode additions:
  MONGOLS: 'BIOME_CARTHAGE_ARID',          // steppe — dusty
  EGYPTIANS: 'BIOME_CARTHAGE_ARID'         // desert — dusty
};

/**
 * Weighted random tile pick from a biome's grass weight list. Pure
 * function — uses the seed `h` (typically a coord-based hash) so the
 * same coords always pick the same tile within a biome. Falls back
 * to TT_GRASS_A if weights are mis-summed.
 */
export function pickGrassTile(biome: BiomeProfile, h: number): string {
  const total = biome.grassWeights.reduce((s, w) => s + w.weight, 0);
  let r = h % total;
  for (const entry of biome.grassWeights) {
    r -= entry.weight;
    if (r < 0) return entry.key;
  }
  return 'TT_GRASS_A';
}

/**
 * STATIC BATTLE DEBRIS — pre-placed corpse/weapon sprites near the
 * path so every player sees the same "this gate has been defended for
 * a hundred years" beat from Wave 1. Anchored (col, row) coordinates
 * are curated to sit just OFF the path (not on it — would block
 * placement visuals). Keys reference Phase 5 sprite assets; until
 * those crop, keys with missing manifest entries silently skip in the
 * render loop.
 *
 * 12 anchors total. Distribution prioritizes path edges, corners, and
 * the cave/gate approaches — places where defenders historically held
 * ground.
 */
export interface DebrisAnchor { col: number; row: number; key: string; }

export const STATIC_BATTLE_DEBRIS: DebrisAnchor[] = [
  // Cave approach (top-left) — first line of defense
  { col: 5,  row: 5,  key: 'DBR_ROMAN_FALLEN_A' },
  { col: 6,  row: 6,  key: 'DBR_BROKEN_PILUM' },
  { col: 7,  row: 5,  key: 'DBR_BLOOD_SMALL' },
  // Mid-map north (W4-W6 zone — Celtic raid relics)
  { col: 14, row: 8,  key: 'DBR_CELTIC_FALLEN' },
  { col: 16, row: 9,  key: 'DBR_BROKEN_SHIELD_CELT' },
  // Mid-map south
  { col: 18, row: 18, key: 'DBR_ROMAN_FALLEN_B' },
  { col: 20, row: 19, key: 'DBR_GLADIUS' },
  // Carthage approach mid-right (W7-W10 zone)
  { col: 24, row: 10, key: 'DBR_CARTHAGE_FALLEN' },
  { col: 25, row: 12, key: 'DBR_BLOOD_LARGE' },
  // Gate approach (bottom-right) — last stand
  { col: 30, row: 21, key: 'DBR_ROMAN_FALLEN_C' },
  { col: 32, row: 22, key: 'DBR_SCATTERED_SCROLLS' },
  { col: 33, row: 20, key: 'DBR_SKELETAL_REMAINS' }
];

/**
 * Path piece suffix list. Auto-tile picker concatenates these with
 * `biome.pathPrefix` to look up sprite keys. Suffixes correspond to
 * neighbor configurations:
 *   - `H`/`V` — straight horizontal / vertical
 *   - `CORNER_NE/NW/SE/SW` — 90° turns
 *   - `T_UP/DOWN/LEFT/RIGHT` — 3-way junctions
 *   - `CROSS` — 4-way junction
 *   - `END_UP/DOWN/LEFT/RIGHT` — dead-end caps
 * 13 pieces per tileset × 3 tilesets = 39 path sprite keys.
 */
export const PATH_PIECE_SUFFIXES = [
  'H', 'V',
  'CORNER_NE', 'CORNER_NW', 'CORNER_SE', 'CORNER_SW',
  'T_UP', 'T_DOWN', 'T_LEFT', 'T_RIGHT',
  'CROSS',
  'END_UP', 'END_DOWN', 'END_LEFT', 'END_RIGHT'      // 4 end caps (rare in practice)
] as const;
