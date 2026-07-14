// Biome system smoke tests.
// 2026-05-21 — Visual overhaul guardrails. The user reported "I can't
// even see anything" — these tests catch the silent-failure modes
// that could leave the map render blank:
//   1. Stub keys in propPool that aren't registered in Assets.MANIFEST
//      (silent skips → invisible decoration).
//   2. Cave key fallback chain breaks (no DARK_CAVE backup).
//   3. Biome lookup off-by-one at wave-band boundaries.
//   4. Endless faction mapping returns undefined.
// These don't render the canvas — they verify the contracts the
// renderer depends on, which is what visibility actually requires.

import { describe, it, expect } from 'vitest';
import { BIOMES, biomeForWave, pickGrassTile, STATIC_BATTLE_DEBRIS, PATH_PIECE_SUFFIXES } from '../src/render/Biomes';
import { GamePhase } from '../src/types';
import { shouldShowCyclopsFlies, shouldShowOpeningThundercloud } from '../src/render/AmbientPropRules';

// Inline import — vitest config resolves JSON imports automatically.
// We need this to verify every key referenced in BIOMES exists in the
// runtime asset manifest. A drift between the two = silent invisible
// decoration = "I can't see anything" symptom.
const fs = require('fs');
const path = require('path');
const ASSETS_TS = fs.readFileSync(
  path.join(__dirname, '../src/render/Assets.ts'),
  'utf8'
);
// Extract MANIFEST keys via regex. The MANIFEST object has multiple
// entries per line in some sections (e.g. shrines packed 2 per line),
// so we use a global pattern that matches `KEY: 'filename.png'`
// anywhere in the line, not just the first token.
const MANIFEST_KEYS = new Set<string>(
  Array.from(ASSETS_TS.matchAll(/\b([A-Z][A-Z0-9_]+):\s*'[^']+\.(png|jpg|jpeg|webp)'/g)).map(m => m[1])
);

function assetFileFor(key: string): string | null {
  const match = new RegExp(`\\b${key}:\\s*'([^']+)'`).exec(ASSETS_TS);
  return match?.[1] ?? null;
}

describe('biomeForWave — campaign wave bands', () => {
  it('W1 returns BIOME_GRASSLAND', () => {
    expect(biomeForWave(1)).toBe('BIOME_GRASSLAND');
  });
  it('W3 still returns BIOME_GRASSLAND (band upper bound)', () => {
    expect(biomeForWave(3)).toBe('BIOME_GRASSLAND');
  });
  it('W4 crosses into BIOME_CELTIC_WOOD', () => {
    expect(biomeForWave(4)).toBe('BIOME_CELTIC_WOOD');
  });
  it('W6 stays in BIOME_CELTIC_WOOD', () => {
    expect(biomeForWave(6)).toBe('BIOME_CELTIC_WOOD');
  });
  it('W7 crosses into BIOME_CARTHAGE_ARID', () => {
    expect(biomeForWave(7)).toBe('BIOME_CARTHAGE_ARID');
  });
  it('W10 stays in BIOME_CARTHAGE_ARID', () => {
    expect(biomeForWave(10)).toBe('BIOME_CARTHAGE_ARID');
  });
  it('W11 crosses into BIOME_UNDEAD_FOREST', () => {
    expect(biomeForWave(11)).toBe('BIOME_UNDEAD_FOREST');
  });
  it('W15 stays in BIOME_UNDEAD_FOREST', () => {
    expect(biomeForWave(15)).toBe('BIOME_UNDEAD_FOREST');
  });
  it('W16 crosses into BIOME_UNDEAD_RUINS', () => {
    expect(biomeForWave(16)).toBe('BIOME_UNDEAD_RUINS');
  });
  it('W18 stays in BIOME_UNDEAD_RUINS', () => {
    expect(biomeForWave(18)).toBe('BIOME_UNDEAD_RUINS');
  });
  it('W19 crosses into BIOME_HELLSCAPE', () => {
    expect(biomeForWave(19)).toBe('BIOME_HELLSCAPE');
  });
  it('W20 stays in BIOME_HELLSCAPE', () => {
    expect(biomeForWave(20)).toBe('BIOME_HELLSCAPE');
  });
  it('endless overflow (W21+) without faction falls to hellscape', () => {
    expect(biomeForWave(50)).toBe('BIOME_HELLSCAPE');
  });
  it('endless overflow with faction maps to correct biome', () => {
    expect(biomeForWave(30, 'DOGS')).toBe('BIOME_GRASSLAND');
    expect(biomeForWave(30, 'UNDEAD_CELTS')).toBe('BIOME_UNDEAD_FOREST');
    expect(biomeForWave(30, 'SUPER_DEMONS')).toBe('BIOME_HELLSCAPE');
  });
  it('pre-game wave (0) defaults to grassland', () => {
    expect(biomeForWave(0)).toBe('BIOME_GRASSLAND');
  });
});

describe('Biome propPool — every key resolves to a real sprite manifest entry', () => {
  // This is THE test that prevents "silent invisible decoration".
  // If a biome references a key that isn't registered, tex() returns
  // null at render time and the prop draws nothing. The user
  // perceives this as "the map doesn't have decoration."
  for (const id of Object.keys(BIOMES) as Array<keyof typeof BIOMES>) {
    const biome = BIOMES[id];
    it(`${id} — all propPool keys are registered`, () => {
      const missing: string[] = [];
      for (const key of biome.propPool) {
        if (!MANIFEST_KEYS.has(key)) missing.push(key);
      }
      expect(missing, `Missing manifest entries for keys: ${missing.join(', ')}`).toEqual([]);
    });
    it(`${id} — propPool is non-empty (at least 3 keys for decoration variety)`, () => {
      expect(biome.propPool.length).toBeGreaterThanOrEqual(3);
    });
    it(`${id} — grassWeights sum to 100`, () => {
      const sum = biome.grassWeights.reduce((s, w) => s + w.weight, 0);
      expect(sum).toBe(100);
    });
    it(`${id} — caveKey either exists in manifest or has DARK_CAVE fallback`, () => {
      // Either the biome-specific cave sprite is registered, OR the
      // renderer's `?? tex('DARK_CAVE')` fallback chain catches it.
      // DARK_CAVE is always registered.
      const registered = MANIFEST_KEYS.has(biome.caveKey);
      const fallbackOk = MANIFEST_KEYS.has('DARK_CAVE');
      expect(registered || fallbackOk).toBe(true);
    });
    it(`${id} — tint alpha is in valid 0..1 range`, () => {
      expect(biome.tint.alpha).toBeGreaterThanOrEqual(0);
      expect(biome.tint.alpha).toBeLessThanOrEqual(1);
    });
  }
});

describe('pickGrassTile — biome-weighted grass picker', () => {
  it('returns one of the biome\'s registered grass keys', () => {
    for (const id of Object.keys(BIOMES) as Array<keyof typeof BIOMES>) {
      const biome = BIOMES[id];
      const validKeys = new Set(biome.grassWeights.map(w => w.key));
      // Try many hash values to exercise the entire weight distribution.
      for (let h = 0; h < 200; h++) {
        const picked = pickGrassTile(biome, h);
        expect(validKeys.has(picked)).toBe(true);
      }
    }
  });
  it('every grass key referenced is registered in the manifest', () => {
    const missing: string[] = [];
    for (const id of Object.keys(BIOMES) as Array<keyof typeof BIOMES>) {
      for (const w of BIOMES[id as keyof typeof BIOMES].grassWeights) {
        if (!MANIFEST_KEYS.has(w.key)) missing.push(`${id}:${w.key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('STATIC_BATTLE_DEBRIS — anchor sanity', () => {
  it('all anchors have valid (col, row) inside the grid', () => {
    // GRID.COLS = 38, GRID.ROWS = 26 per src/constants.ts
    for (const a of STATIC_BATTLE_DEBRIS) {
      expect(a.col).toBeGreaterThanOrEqual(0);
      expect(a.col).toBeLessThan(38);
      expect(a.row).toBeGreaterThanOrEqual(0);
      expect(a.row).toBeLessThan(26);
    }
  });
  it('debris layer has at least 10 anchors to feel "lived-in"', () => {
    expect(STATIC_BATTLE_DEBRIS.length).toBeGreaterThanOrEqual(10);
  });
  it('every debris key has either sprite registration OR procedural fallback', () => {
    // Renderer V12 added procedural fallback for all DBR_* keys, so
    // even if the manifest is missing the sprite, the Pixi Graphics
    // path draws something. Document the fallback patterns here so
    // future debris additions don't drift.
    const procPatterns = [
      /^DBR_BLOOD_/,
      /^DBR_BROKEN_PILUM$/,
      /^DBR_GLADIUS$/,
      /^DBR_BROKEN_SHIELD_/,
      /^DBR_SKELETAL_REMAINS$/,
      /^DBR_SCATTERED_SCROLLS$/,
      /^DBR_(ROMAN|CELTIC|CARTHAGE)_FALLEN/
    ];
    for (const a of STATIC_BATTLE_DEBRIS) {
      const matchedPattern = procPatterns.some(p => p.test(a.key));
      const registered = MANIFEST_KEYS.has(a.key);
      expect(matchedPattern || registered, `Anchor ${a.key} has neither sprite registration nor a procedural fallback pattern`).toBe(true);
    }
  });
});

describe('PATH_PIECE_SUFFIXES — auto-tile coverage', () => {
  it('includes both H + V straights, all 4 corners, all 4 T-junctions, cross, 4 end caps', () => {
    expect(PATH_PIECE_SUFFIXES).toContain('H');
    expect(PATH_PIECE_SUFFIXES).toContain('V');
    expect(PATH_PIECE_SUFFIXES).toContain('CORNER_NE');
    expect(PATH_PIECE_SUFFIXES).toContain('CORNER_NW');
    expect(PATH_PIECE_SUFFIXES).toContain('CORNER_SE');
    expect(PATH_PIECE_SUFFIXES).toContain('CORNER_SW');
    expect(PATH_PIECE_SUFFIXES).toContain('T_UP');
    expect(PATH_PIECE_SUFFIXES).toContain('T_DOWN');
    expect(PATH_PIECE_SUFFIXES).toContain('T_LEFT');
    expect(PATH_PIECE_SUFFIXES).toContain('T_RIGHT');
    expect(PATH_PIECE_SUFFIXES).toContain('CROSS');
    expect(PATH_PIECE_SUFFIXES).toContain('END_UP');
    expect(PATH_PIECE_SUFFIXES).toContain('END_DOWN');
    expect(PATH_PIECE_SUFFIXES).toContain('END_LEFT');
    expect(PATH_PIECE_SUFFIXES).toContain('END_RIGHT');
  });
  it('has 15 distinct path piece suffixes', () => {
    const unique = new Set(PATH_PIECE_SUFFIXES);
    expect(unique.size).toBe(15);
  });
});

describe('Map overhaul sprite manifest — registered keys exist on disk', () => {
  it('all map_overhaul/ keys point to files that actually exist', () => {
    const matches = Array.from(ASSETS_TS.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*'(map_overhaul\/[^']+)'/gm));
    expect(matches.length).toBeGreaterThan(30);   // we added 50+ sprites in V6+V9
    const missing: string[] = [];
    for (const [, , file] of matches) {
      const full = path.join(__dirname, '../public/assets/sprites', file);
      if (!fs.existsSync(full)) missing.push(file);
    }
    expect(missing, `Missing files: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('Ocean reserve sprite manifest — cove water tiles are real pixel assets', () => {
  const oceanKeys = [
    'OCEAN_DEEP_A', 'OCEAN_DEEP_B', 'OCEAN_MID_A', 'OCEAN_MID_B', 'OCEAN_SHALLOW_A', 'OCEAN_SHALLOW_B',
    'OCEAN_FOAM_N', 'OCEAN_FOAM_E', 'OCEAN_FOAM_S', 'OCEAN_FOAM_W',
    'OCEAN_KELP', 'OCEAN_CORAL', 'OCEAN_FISH', 'OCEAN_ROCK', 'OCEAN_SEA_GIANT_HEAD',
    'OCEAN_LEVIATHAN_HEAD', 'OCEAN_LEVIATHAN_BACK', 'OCEAN_LEVIATHAN_TAIL',
    'OCEAN_DEAD_FISHLING_FLOAT', 'OCEAN_DEAD_FISHLING_SHORE', 'OCEAN_DEAD_FISHLING_BLOOD',
    'OCEAN_DEAD_ROMANS_FLOAT',
    'OCEAN_SHORE_SHELLS', 'OCEAN_SHORE_STARFISH', 'OCEAN_SHORE_PEBBLES',
    'OCEAN_SHORE_DRIFTWOOD', 'OCEAN_SHORE_FOAM_BITS', 'OCEAN_SHORE_WET_ROCKS',
    'OCEAN_SHORE_ITALY_ROCKS_A', 'OCEAN_SHORE_ITALY_ROCKS_B', 'OCEAN_SHORE_ITALY_ROCKS_C',
    'OCEAN_SHORE_SKULLS_A', 'OCEAN_SHORE_SKULLS_B', 'OCEAN_SHORE_SKULLS_C',
    'OCEAN_SHIPWRECK', 'OCEAN_TINY_SHIPWRECK'
  ];

  it('registers every ocean tile used by RenderEngine', () => {
    const missing = oceanKeys.filter(key => !MANIFEST_KEYS.has(key));
    expect(missing, `Missing ocean manifest keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('ships 32x32 sprite files, with transparent detail overlays', async () => {
    const sharp = require('sharp');
    const transparentOverlayKeys = oceanKeys.filter(key =>
      key.includes('FOAM') || key.includes('KELP') || key.includes('CORAL') || key.includes('FISH') ||
      key.includes('ROCK') || key.includes('SHORE') || key.includes('SHIPWRECK') || key.includes('HEAD') ||
      key.includes('ROMANS')
    );
    for (const key of oceanKeys) {
      const file = assetFileFor(key);
      expect(file, `${key} missing asset filename`).toBeTruthy();
      const full = path.join(__dirname, '../public/assets/sprites', file!);
      expect(fs.existsSync(full), `${key} -> ${file}`).toBe(true);
      const img = sharp(full);
      const meta = await img.metadata();
      if (key === 'OCEAN_SHIPWRECK') {
        expect(meta.width, `${key} width`).toBe(160);
        expect(meta.height, `${key} height`).toBe(120);
      } else if (key === 'OCEAN_TINY_SHIPWRECK') {
        expect(meta.width, `${key} width`).toBe(128);
        expect(meta.height, `${key} height`).toBe(96);
      } else if (key === 'OCEAN_SEA_GIANT_HEAD') {
        expect(meta.width, `${key} width`).toBe(160);
        expect(meta.height, `${key} height`).toBe(160);
      } else if (key === 'OCEAN_LEVIATHAN_HEAD') {
        expect(meta.width, `${key} width`).toBe(57);
        expect(meta.height, `${key} height`).toBe(72);
      } else if (key === 'OCEAN_LEVIATHAN_BACK') {
        expect(meta.width, `${key} width`).toBe(131);
        expect(meta.height, `${key} height`).toBe(96);
      } else if (key === 'OCEAN_LEVIATHAN_TAIL') {
        expect(meta.width, `${key} width`).toBe(80);
        expect(meta.height, `${key} height`).toBe(72);
      } else if (key === 'OCEAN_DEAD_ROMANS_FLOAT') {
        expect(meta.width, `${key} width`).toBe(160);
        expect(meta.height, `${key} height`).toBe(99);
      } else {
        expect(meta.width, `${key} width`).toBe(32);
        expect(meta.height, `${key} height`).toBe(32);
      }
      if (transparentOverlayKeys.includes(key)) {
        const raw = await img.ensureAlpha().raw().toBuffer();
        let transparent = 0;
        for (let i = 3; i < raw.length; i += 4) if (raw[i] < 8) transparent++;
        expect(transparent, `${key} should have transparent pixels`).toBeGreaterThan(32 * 32 * 0.35);
      }
    }
  });

  it('renders coastal ground detail on grass near the ocean without changing gameplay tiles', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain('immediateShoreGroundKeys');
    expect(source).toContain('outerShoreGroundKeys');
    expect(source).toContain('italyShoreRockKeys');
    expect(source).toContain('shoreSkullKeys');
    expect(source).toContain('deadFishlingKeys');
    expect(source).toContain('addItalyShoreRock');
    expect(source).toContain('addShoreSkulls');
    expect(source).toContain('addDeadFishlingShore');
    expect(source).toContain('checkpointFacingShore');
    expect(source).toContain("addItalyShoreRock(c, r, 'S'");
    expect(source).toContain("addItalyShoreRock(c, r, 'W'");
    expect(source).toContain("addShoreSkulls(c, r, 'S'");
    expect(source).toContain("addShoreSkulls(c, r, 'W'");
    expect(source).toContain("addDeadFishlingShore(c, r, 'S'");
    expect(source).toContain("addDeadFishlingShore(c, r, 'W'");
    expect(source).toContain("key: 'OCEAN_DEAD_FISHLING_FLOAT'");
    expect(source).toContain("key: 'OCEAN_DEAD_FISHLING_BLOOD'");
    expect(source).toContain("key: 'OCEAN_DEAD_FISHLING_FLOAT', terrain: 'water', alpha: 0.96");
    expect(source).toContain("key: 'OCEAN_DEAD_FISHLING_BLOOD', terrain: 'water', alpha: 0.96");
    expect(source).toContain("key: 'OCEAN_DEAD_FISHLING_SHORE', terrain: 'water', alpha: 0.96");
    expect(source).toContain("key: 'OCEAN_DEAD_ROMANS_FLOAT'");
    expect(source).toMatch(/col: WATER_ZONE\.col \+ 1,[\s\S]*?key: 'OCEAN_DEAD_ROMANS_FLOAT'/);
    expect(source).toMatch(/col: WATER_ZONE\.col \+ 6,[\s\S]*?key: 'OCEAN_DEAD_ROMANS_FLOAT'/);
    expect(source).toContain('fish.alpha = 0.96;');
    expect(source).toContain("key: 'OCEAN_LEVIATHAN_HEAD'");
    expect(source).toContain("key: 'OCEAN_LEVIATHAN_BACK'");
    expect(source).toContain("key: 'OCEAN_LEVIATHAN_TAIL'");
    expect(source).toMatch(/col: WATER_ZONE\.col \+ 2,[\s\S]*?key: 'OCEAN_LEVIATHAN_HEAD'/);
    expect(source).toMatch(/col: WATER_ZONE\.col \+ 4,[\s\S]*?key: 'OCEAN_LEVIATHAN_BACK'/);
    expect(source).toMatch(/col: WATER_ZONE\.col \+ 7,[\s\S]*?key: 'OCEAN_LEVIATHAN_TAIL'/);
    expect(source).toContain('alphaPulse');
    expect(source).toContain('bobSpeed');
    expect(source).toContain('rotationAmp');
    expect(source).toContain('const oceanBorderFillTiles');
    expect(source).toContain('oceanBorderFillTiles.add(`0,${r}`)');
    expect(source).toContain('oceanBorderFillTiles.add(`${c},${bottomBorderRow}`)');
    expect(source).toContain("tex('OCEAN_TINY_SHIPWRECK')");
    expect(source).toContain('tinyShipwreck.rotation = -0.08');
    expect(source).toContain('waterProximity(c, r, 2)');
    expect(source).toContain('const nearOceanEdge = waterProximity(c, r, 2) > 0;');
    expect(source).toContain('if (!nearOceanEdge && propRoll < targetDensity)');
    expect(source).toContain('t === TileType.EMPTY');
  });

  it('anchors one cohesive bottom-ocean undead Roman ruin beside the cove', async () => {
    const sharp = require('sharp');
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("tex('MAP_BOTTOM_COASTAL_UNDEAD_RUINS')");
    expect(source).toContain('WATER_ZONE.col + WATER_ZONE.width');
    expect(source).toContain('GRID.ROWS - 0.65');
    expect(source).toContain('GRID.TILE * 5.20');
    expect(source).not.toContain('const BOTTOM_OCEAN_UNDEAD_RUINS');

    const file = assetFileFor('MAP_BOTTOM_COASTAL_UNDEAD_RUINS');
    expect(file).toBe('map_overhaul/m_bottom_coastal_undead_ruins.png');
    const img = sharp(path.join(__dirname, '../public/assets/sprites', file!));
    const meta = await img.metadata();
    expect(meta.width).toBe(192);
    expect(meta.height).toBe(96);
    expect(meta.hasAlpha).toBe(true);
    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    let magenta = 0;
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i + 3] < 8) transparent++;
      if (raw[i] > 220 && raw[i + 1] < 80 && raw[i + 2] > 220 && raw[i + 3] > 8) magenta++;
    }
    expect(transparent).toBeGreaterThan(192 * 96 * 0.35);
    expect(magenta).toBe(0);
  });
});

describe('Top-right Cyclops trophy prop', () => {
  it('registers a transparent authored sprite and anchors it to the top border', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_CYCLOPS_SEVERED_HEAD');
    expect(file).toBe('m_cyclops_severed_head.png');

    const full = path.join(__dirname, '../public/assets/sprites', file!);
    expect(fs.existsSync(full)).toBe(true);
    const img = sharp(full);
    const meta = await img.metadata();
    expect(meta.width).toBe(192);
    expect(meta.height).toBe(192);
    expect(meta.hasAlpha).toBe(true);

    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    for (let i = 3; i < raw.length; i += 4) if (raw[i] < 8) transparent++;
    expect(transparent).toBeGreaterThan(192 * 192 * 0.35);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("{ col: 36, row: 0, key: 'MAP_CYCLOPS_SEVERED_HEAD'");
    expect(source).toContain("yOffset: 112");
    expect(source).not.toContain("{ col: 35, row: 1,  key: 'MAP_CORNER_SHRINE_B3'");
    expect(source).not.toContain("{ col: 36, row: 0,  key: 'MAP_CORNER_SHRINE_A2'");
    expect(source).not.toContain("{ col: 36, row: 3,  key: 'MAP_CORNER_SHRINE_A6'");
    expect(source).toContain('const inCyclopsTrophyClearance = c >= 34 && r <= 5;');
    expect(source).toContain('t === TileType.EMPTY && !inCyclopsTrophyClearance');
    expect(source.match(/t === TileType\.EMPTY && !inCyclopsTrophyClearance/g)).toHaveLength(2);
    expect(Object.values(BIOMES).flatMap(biome => biome.propPool)).not.toContain('DP_URN');
    expect(source.indexOf('this.layers.bg.addChild(decorLayer);')).toBeLessThan(source.indexOf('this.layers.bg.addChild(cornerLayer);'));
  });

  it('animates a transparent pooled fly sheet around the severed head only for Wave 1', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_CYCLOPS_FLIES');
    expect(file).toBe('map_overhaul/m_cyclops_flies_sheet.png');

    const full = path.join(__dirname, '../public/assets/sprites', file!);
    expect(fs.existsSync(full)).toBe(true);
    const img = sharp(full);
    const meta = await img.metadata();
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.hasAlpha).toBe(true);

    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    for (let i = 3; i < raw.length; i += 4) if (raw[i] < 8) transparent++;
    expect(transparent).toBeGreaterThan(128 * 128 * 0.75);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("texGridFrame('MAP_CYCLOPS_FLIES', frame, 64, 64, 2)");
    expect(source).toContain('const flyOrbits = [');
    expect(source).toContain('fly.width = 36;');
    expect(source).toContain('this.cyclopsFlySprites.push');
    expect(source).toContain('for (const fly of this.cyclopsFlySprites)');
    expect(source).toContain('if (!fly.sp.parent || fly.frames.length === 0) continue;');
    expect(source).toContain('fly.sp.visible = showCyclopsFlies;');
    expect(source).toContain('const landed = cycle >= 0.62 && cycle < 0.78;');
    expect(source).toContain('landingX: orbit.landingX');

    expect(shouldShowCyclopsFlies(0, GamePhase.BUILD_PHASE)).toBe(true);
    expect(shouldShowCyclopsFlies(0, GamePhase.PROSPECT_PLACEMENT)).toBe(true);
    expect(shouldShowCyclopsFlies(1, GamePhase.WAVE_PHASE)).toBe(true);
    expect(shouldShowCyclopsFlies(1, GamePhase.BUILD_PHASE)).toBe(false);
    expect(shouldShowCyclopsFlies(2, GamePhase.WAVE_PHASE)).toBe(false);
  });

  it('animates a large transparent thundercloud above the cave only through Wave 1', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_OPENING_THUNDERCLOUD');
    expect(file).toBe('map_overhaul/m_opening_thundercloud_sheet.png');

    const full = path.join(__dirname, '../public/assets/sprites', file!);
    expect(fs.existsSync(full)).toBe(true);
    const img = sharp(full).ensureAlpha();
    const meta = await img.metadata();
    expect(meta.width).toBe(768);
    expect(meta.height).toBe(768);
    expect(meta.hasAlpha).toBe(true);

    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    let visibleEdgePixels = 0;
    let magenta = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const alpha = data[i + 3];
        if (alpha < 8) transparent++;
        if ((x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) && alpha > 0) visibleEdgePixels++;
        if (data[i] > 230 && data[i + 1] < 45 && data[i + 2] > 230 && alpha > 0) magenta++;
      }
    }
    expect(transparent).toBeGreaterThan(info.width * info.height * 0.55);
    expect(visibleEdgePixels).toBe(0);
    expect(magenta).toBe(0);

    const frameOne = await img.clone().extract({ left: 0, top: 0, width: 256, height: 256 }).raw().toBuffer();
    const strikeFrame = await img.clone().extract({ left: 256, top: 256, width: 256, height: 256 }).raw().toBuffer();
    expect(Buffer.compare(frameOne, strikeFrame)).not.toBe(0);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("texGridFrame('MAP_OPENING_THUNDERCLOUD', frame, 256, 256, 3)");
    expect(source).toContain('openingCloud.width = GRID.TILE * 6.5;');
    expect(source).toContain('openingCloud.height = GRID.TILE * 4.3;');
    expect(source).toContain('openingCloud.y = caveCy - GRID.TILE * 3.2;');
    expect(source).toContain('this.layers.bg, this.layers.openingAtmosphere, this.layers.tiles');
    expect(source).toContain('this.layers.openingAtmosphere.removeChildren();');
    expect(source).toContain('this.layers.openingAtmosphere.addChild(openingCloud);');
    expect(source).toContain('const cloudCycle = ((tick / 6.2) % 1 + 1) % 1;');

    expect(shouldShowOpeningThundercloud(0, GamePhase.BUILD_PHASE)).toBe(true);
    expect(shouldShowOpeningThundercloud(0, GamePhase.PROSPECT_PLACEMENT)).toBe(true);
    expect(shouldShowOpeningThundercloud(1, GamePhase.WAVE_PHASE)).toBe(true);
    expect(shouldShowOpeningThundercloud(1, GamePhase.BUILD_PHASE)).toBe(false);
    expect(shouldShowOpeningThundercloud(2, GamePhase.WAVE_PHASE)).toBe(false);
  });

  it('adds a transparent giant war sword above the severed head without changing gameplay tiles', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_CYCLOPS_WAR_SWORD');
    expect(file).toBe('map_overhaul/m_cyclops_war_sword.png');

    const full = path.join(__dirname, '../public/assets/sprites', file!);
    expect(fs.existsSync(full)).toBe(true);
    const img = sharp(full);
    const meta = await img.metadata();
    expect(meta.width).toBe(384);
    expect(meta.height).toBe(576);
    expect(meta.hasAlpha).toBe(true);

    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    for (let i = 3; i < raw.length; i += 4) if (raw[i] < 8) transparent++;
    expect(transparent).toBeGreaterThan(384 * 576 * 0.45);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("tex('MAP_CYCLOPS_WAR_SWORD')");
    expect(source).toContain('cyclopsSword.x = GRID.TILE * 34.25');
    expect(source).toContain('cyclopsSword.y = GRID.TILE * 2.55');
    expect(source).toContain('cyclopsSword.width = GRID.TILE * 2.25');
    expect(source).toContain('background-only sprite');
  });
});

describe('Rome gate fallen Cyclops tableau', () => {
  it('ships a transparent undead half-Cyclops and anchors it five tiles left of Rome', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_GATE_UNDEAD_CYCLOPS_GRIP');
    expect(file).toBe('map_overhaul/m_gate_undead_cyclops_grip.png');
    const img = sharp(path.join(__dirname, '../public/assets/sprites', file!));
    const meta = await img.metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(384);
    expect(meta.hasAlpha).toBe(true);

    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    let chromaGreen = 0;
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i + 3] < 8) transparent++;
      if (raw[i] < 80 && raw[i + 1] > 150 && raw[i + 2] < 80 && raw[i + 3] > 8) chromaGreen++;
    }
    expect(transparent).toBeGreaterThan(512 * 384 * 0.50);
    expect(chromaGreen).toBe(0);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("tex('MAP_GATE_UNDEAD_CYCLOPS_GRIP')");
    expect(source).toContain('gateCyclops.x = gateCx - GRID.TILE * 5');
    expect(source).toContain('gateCyclops.y = gateCy - GRID.TILE * 1.10');
    expect(source).toContain('gateCyclops.width = GRID.TILE * 4.90');
    expect(source.indexOf('this.layers.bg.addChild(gateCyclops);')).toBeLessThan(source.indexOf("const gate = tex('ROMAN_GATE')"));
  });
});

describe('Redesigned main cave', () => {
  it('keeps the legacy cave dimensions and uses aligned animated braziers', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('DARK_CAVE');
    expect(file).toBe('m_dark_cave.png');
    const img = sharp(path.join(__dirname, '../public/assets/sprites', file!));
    const meta = await img.metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(214);
    expect(meta.hasAlpha).toBe(true);

    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    let chromaGreen = 0;
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i + 3] < 8) transparent++;
      if (raw[i] < 80 && raw[i + 1] > 150 && raw[i + 2] < 80 && raw[i + 3] > 8) chromaGreen++;
    }
    expect(transparent).toBeGreaterThan(256 * 214 * 0.25);
    expect(chromaGreen).toBe(0);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain('cs.width = 128; cs.height = 128;');
    expect(source).toContain('cbs.width = 96; cbs.height = 96;');
    expect(source).not.toContain('const caveFrame = new Graphics();');
    expect(source).not.toContain('caveGlowColor');
    expect(source).toContain('drawTorch(caveCx - 34, caveCy + 16, 0);');
    expect(source).toContain('drawTorch(caveCx + 34, caveCy + 16, 1.7);');
    expect(source).toContain('drawTorch(gateCx - 35, gateCy + 29, 0.9);');
    expect(source).toContain('drawTorch(gateCx + 35, gateCy + 29, 2.4);');
    expect(source).toContain('if (caveBActive && caveBData)');
  });
});

describe('Redesigned Gates of Rome', () => {
  it('keeps both intact and destroyed gate states transparent and footprint-compatible', async () => {
    const sharp = require('sharp');
    for (const [key, expectedFile] of [
      ['ROMAN_GATE', 'm_roman_gate.png'],
      ['ROMAN_GATE_DESTROYED', 'm_roman_gate_destroyed.png']
    ]) {
      const file = assetFileFor(key);
      expect(file).toBe(expectedFile);
      const img = sharp(path.join(__dirname, '../public/assets/sprites', file!));
      const meta = await img.metadata();
      expect(meta.width).toBe(256);
      expect(meta.height).toBe(224);
      expect(meta.hasAlpha).toBe(true);

      const raw = await img.ensureAlpha().raw().toBuffer();
      let transparent = 0;
      let chromaGreen = 0;
      let legacyMagenta = 0;
      for (let i = 0; i < raw.length; i += 4) {
        if (raw[i + 3] < 8) transparent++;
        if (raw[i] < 80 && raw[i + 1] > 150 && raw[i + 2] < 80 && raw[i + 3] > 8) chromaGreen++;
        if (raw[i] > 100 && raw[i + 2] > 100 && raw[i + 1] < 70 && raw[i + 3] > 8) legacyMagenta++;
      }
      expect(transparent).toBeGreaterThan(256 * 224 * 0.35);
      expect(chromaGreen).toBe(0);
      expect(legacyMagenta).toBe(0);
    }

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("const gate = tex('ROMAN_GATE')");
    expect(source).toContain('gs.anchor.set(0.5); gs.x = gateCx; gs.y = gateCy;');
    expect(source).toContain('gs.width = 120; gs.height = 120;');
    expect(source).not.toContain('const gateFrame = new Graphics();');
  });
});

describe('Top-border undead dragon aftermath prop', () => {
  it('registers a wide transparent sprite and anchors it at the top center border', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_TOP_UNDEAD_DRAGON_AFTERMATH');
    expect(file).toBe('map_overhaul/m_top_undead_dragon_aftermath.png');

    const full = path.join(__dirname, '../public/assets/sprites', file!);
    expect(fs.existsSync(full)).toBe(true);
    const img = sharp(full);
    const meta = await img.metadata();
    expect(meta.width).toBe(384);
    expect(meta.height).toBe(153);
    expect(meta.hasAlpha).toBe(true);

    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    let magenta = 0;
    for (let i = 0; i < raw.length; i += 4) {
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      const a = raw[i + 3];
      if (a < 8) transparent++;
      if (a > 8 && r > 210 && b > 200 && g < 70) magenta++;
    }
    expect(transparent).toBeGreaterThan(384 * 153 * 0.35);
    expect(magenta).toBe(0);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("tex('MAP_TOP_UNDEAD_DRAGON_AFTERMATH')");
    expect(source).toContain('topDragon.x = GRID.CANVAS_W / 2');
    expect(source).toContain('topDragon.y = GRID.TILE * 1.30');
    expect(source).toContain('topDragon.width = GRID.TILE * 11.0');
  });
});

describe('Checkpoint III dead Carthaginian elephant prop', () => {
  it('registers a transparent battlefield sprite and anchors it two down, three-and-a-half right of checkpoint III', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_DEAD_CARTHAGE_ELEPHANT');
    expect(file).toBe('map_overhaul/m_dead_carthage_elephant.png');

    const full = path.join(__dirname, '../public/assets/sprites', file!);
    expect(fs.existsSync(full)).toBe(true);
    const img = sharp(full);
    const meta = await img.metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(160);
    expect(meta.hasAlpha).toBe(true);

    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    let magenta = 0;
    for (let i = 0; i < raw.length; i += 4) {
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      const a = raw[i + 3];
      if (a < 8) transparent++;
      if (a > 8 && r > 210 && b > 200 && g < 70) magenta++;
    }
    expect(transparent).toBeGreaterThan(256 * 160 * 0.35);
    expect(magenta).toBe(0);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("tex('MAP_DEAD_CARTHAGE_ELEPHANT')");
    expect(source).toContain('wp.index === 3');
    expect(source).toContain('(checkpointThree.col + 0.5 + 3.5) * GRID.TILE');
    expect(source).toContain('(checkpointThree.row + 0.5 + 2.0) * GRID.TILE');
    expect(source).toContain('deadElephant.width = GRID.TILE * 4.6');
    expect(source).toContain('cornerLayer.addChild(deadElephant)');
  });
});

describe('Cave battlefield remains props', () => {
  it('registers transparent authored sprites and anchors them around the main cave', async () => {
    const sharp = require('sharp');
    const expected = [
      ['MAP_CAVE_BONES_SCATTER', 'map_overhaul/m_cave_bones_scatter.png', 192],
      ['MAP_CAVE_SEVERED_HEADS', 'map_overhaul/m_cave_severed_heads.png', 192],
      ['MAP_CAVE_FALLEN_SKELETON', 'map_overhaul/m_cave_fallen_skeleton.png', 224],
      ['MAP_CAVE_SKULL_STAKE', 'map_overhaul/m_cave_skull_stake.png', 192]
    ] as const;

    for (const [key, fileName, size] of expected) {
      const file = assetFileFor(key);
      expect(file).toBe(fileName);
      const full = path.join(__dirname, '../public/assets/sprites', file!);
      expect(fs.existsSync(full)).toBe(true);
      const img = sharp(full);
      const meta = await img.metadata();
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
      expect(meta.hasAlpha).toBe(true);

      const raw = await img.ensureAlpha().raw().toBuffer();
      let transparent = 0;
      for (let i = 3; i < raw.length; i += 4) if (raw[i] < 8) transparent++;
      expect(transparent, `${key} should keep transparent padding`).toBeGreaterThan(size * size * 0.35);
    }

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain('const CAVE_REMAINS');
    for (const [key] of expected) expect(source).toContain(`key: '${key}'`);
    expect(source).toContain('x: caveCx - 48, y: caveCy - 92');
    expect(source).toContain('x: caveCx + 24, y: caveCy - 104');
    expect(source).toContain('x: caveCx + 78, y: caveCy - 82');
    expect(source).toContain('x: caveCx - 104, y: caveCy - 58');
    expect(source).toContain('x: caveCx + 110, y: caveCy - 18');
    expect(source).toContain('x: caveCx - 108, y: caveCy + 24');
    expect(source).toContain('x: caveCx + 114, y: caveCy + 42');
    expect(source).toContain('x: caveCx');
    expect(source).toContain('y: caveCy');
  });
});

describe('Battlefield blood trails and Cyclops remains', () => {
  it('ships a transparent pixel blood trail and places it at the cave and Rome gate', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_BATTLE_BLOOD_TRAIL');
    expect(file).toBe('map_overhaul/m_battle_blood_trail.png');
    const img = sharp(path.join(__dirname, '../public/assets/sprites', file!));
    const meta = await img.metadata();
    expect(meta.width).toBe(192);
    expect(meta.height).toBe(64);
    expect(meta.hasAlpha).toBe(true);
    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    let green = 0;
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i + 3] < 8) transparent++;
      if (raw[i] < 80 && raw[i + 1] > 220 && raw[i + 2] < 80 && raw[i + 3] > 8) green++;
    }
    expect(transparent).toBeGreaterThan(192 * 64 * 0.45);
    expect(green).toBe(0);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("tex('MAP_BATTLE_BLOOD_TRAIL')");
    expect(source).toContain('const oceanBloodTrail');
    expect(source).toContain('wp.index === 2');
    expect(source).toContain('(checkpointTwo.row + 0.5 + 2.35) * GRID.TILE');
    expect(source).toContain('oceanBloodTrail.rotation = -Math.PI / 2 + 0.04');
    expect(source).toContain('coastalDetailLayer.addChild(oceanBloodTrail)');
    expect(source).toContain('const caveBloodTrail');
    expect(source).toContain('const gateBloodTrail');
    expect(source).toContain('gateBloodTrail.scale.x *= -1');
    expect(source).toContain('const CYCLOPS_REMAINS');
    expect(source).toContain('GRID.TILE * 33.00');
    expect(source).toContain('GRID.TILE * 35.10');
    expect(source).toContain('GRID.TILE * 37.15');
  });

  it('spaces bloody authored skeletons down the right border as visual-only props', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain('const RIGHT_BORDER_REMAINS');
    const block = source.slice(
      source.indexOf('const RIGHT_BORDER_REMAINS'),
      source.indexOf('for (const anchor of RIGHT_BORDER_REMAINS)')
    );
    expect(block.match(/MAP_CAVE_FALLEN_SKELETON/g)).toHaveLength(3);
    expect(block.match(/MAP_CAVE_BONES_SCATTER/g)).toHaveLength(3);
    expect(block.match(/col: 3[67]\./g)).toHaveLength(6);
    expect(source).toContain('addHeavyBloodSplatter(cornerLayer, x, y + 4, anchor.size * 1.15');
    expect(source).toContain('cornerLayer.addChild(remains);');
    expect(block).not.toContain('setTile');
    expect(block).not.toContain('TileType');
  });

  it('ships a transparent heavy splatter and places three stains at each battlefield entry', async () => {
    const sharp = require('sharp');
    const file = assetFileFor('MAP_BATTLE_BLOOD_SPLATTER_HEAVY');
    expect(file).toBe('map_overhaul/m_battle_blood_splatter_heavy.png');
    const img = sharp(path.join(__dirname, '../public/assets/sprites', file!));
    const meta = await img.metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expect(meta.hasAlpha).toBe(true);
    const raw = await img.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    let chromaGreen = 0;
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i + 3] < 8) transparent++;
      if (raw[i] < 80 && raw[i + 1] > 180 && raw[i + 2] < 80 && raw[i + 3] > 8) chromaGreen++;
    }
    expect(transparent).toBeGreaterThan(256 * 256 * 0.50);
    expect(chromaGreen).toBe(0);

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain("tex('MAP_BATTLE_BLOOD_SPLATTER_HEAVY')");
    expect(source).toContain('const addHeavyBloodSplatter');
    expect(source.match(/addHeavyBloodSplatter\(/g)).toHaveLength(10);
    expect(source.match(/addHeavyBloodSplatter\(coastalDetailLayer/g)).toHaveLength(3);
    expect(source.match(/addHeavyBloodSplatter\(this\.layers\.bg/g)).toHaveLength(6);
  });
});

describe('Stone trail skeleton props', () => {
  it('registers transparent path skeleton sprites and ties placement to the immutable trail', async () => {
    const sharp = require('sharp');
    const expected = [
      ['MAP_PATH_SKELETON_BODY', 'map_overhaul/m_path_skeleton_body.png'],
      ['MAP_PATH_SKELETON_SCATTER', 'map_overhaul/m_path_skeleton_scatter.png']
    ] as const;

    for (const [key, fileName] of expected) {
      const file = assetFileFor(key);
      expect(file).toBe(fileName);
      const full = path.join(__dirname, '../public/assets/sprites', file!);
      expect(fs.existsSync(full)).toBe(true);
      const img = sharp(full);
      const meta = await img.metadata();
      expect(meta.width).toBe(128);
      expect(meta.height).toBe(128);
      expect(meta.hasAlpha).toBe(true);

      const raw = await img.ensureAlpha().raw().toBuffer();
      const corners = [3, (128 - 1) * 4 + 3, ((128 - 1) * 128) * 4 + 3, ((128 * 128) - 1) * 4 + 3].map(i => raw[i]);
      expect(Math.max(...corners), `${key} transparent corners`).toBeLessThanOrEqual(8);
    }

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain('const pathSkeletonLayer');
    expect(source).toContain('const pathSkeletonCandidates = terrainPath.filter');
    expect(source).toContain('pathSet.has(`${t.col},${t.row}`)');
    expect(source).toContain('const PATH_SKELETONS');
    for (const [key] of expected) expect(source).toContain(`key: '${key}'`);
    const markerBlock = source.slice(source.indexOf('const PATH_SKELETONS'), source.indexOf('for (const marker of PATH_SKELETONS)'));
    expect(markerBlock.match(/alpha: 1\.00/g)).toHaveLength(8);
    expect(markerBlock).not.toMatch(/alpha: 0\./);
  });
});

describe('Rome gate fallen soldier props', () => {
  it('registers transparent fallen Roman sprites and anchors them at the Rome gate', async () => {
    const sharp = require('sharp');
    const expected = [
      ['MAP_GATE_FALLEN_ROMAN_A', 'map_overhaul/m_gate_fallen_roman_a.png'],
      ['MAP_GATE_FALLEN_ROMAN_B', 'map_overhaul/m_gate_fallen_roman_b.png'],
      ['MAP_GATE_FALLEN_ROMAN_C', 'map_overhaul/m_gate_fallen_roman_c.png']
    ] as const;

    for (const [key, fileName] of expected) {
      const file = assetFileFor(key);
      expect(file).toBe(fileName);
      const full = path.join(__dirname, '../public/assets/sprites', file!);
      expect(fs.existsSync(full)).toBe(true);
      const img = sharp(full);
      const meta = await img.metadata();
      expect(meta.width).toBe(160);
      expect(meta.height).toBe(160);
      expect(meta.hasAlpha).toBe(true);

      const raw = await img.ensureAlpha().raw().toBuffer();
      const corners = [3, (160 - 1) * 4 + 3, ((160 - 1) * 160) * 4 + 3, ((160 * 160) - 1) * 4 + 3].map(i => raw[i]);
      expect(Math.max(...corners), `${key} transparent corners`).toBeLessThanOrEqual(8);
    }

    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain('const GATE_FALLEN_SOLDIERS');
    expect(source).toContain('x: gateCx');
    expect(source).toContain('y: gateCy');
    expect(source).toContain('x: gateCx + 22');
    expect(source).toContain('x: gateCx + 44');
    expect(source).toContain('x: gateCx + 28');
    for (const [key] of expected) expect(source).toContain(`key: '${key}'`);
  });
});
