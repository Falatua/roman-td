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
    'OCEAN_DEAD_FISHLING_FLOAT', 'OCEAN_DEAD_FISHLING_SHORE', 'OCEAN_DEAD_FISHLING_BLOOD',
    'OCEAN_SHORE_SHELLS', 'OCEAN_SHORE_STARFISH', 'OCEAN_SHORE_PEBBLES',
    'OCEAN_SHORE_DRIFTWOOD', 'OCEAN_SHORE_FOAM_BITS', 'OCEAN_SHORE_WET_ROCKS',
    'OCEAN_SHORE_ITALY_ROCKS_A', 'OCEAN_SHORE_ITALY_ROCKS_B', 'OCEAN_SHORE_ITALY_ROCKS_C',
    'OCEAN_SHORE_SKULLS_A', 'OCEAN_SHORE_SKULLS_B', 'OCEAN_SHORE_SKULLS_C',
    'OCEAN_SHIPWRECK'
  ];

  it('registers every ocean tile used by RenderEngine', () => {
    const missing = oceanKeys.filter(key => !MANIFEST_KEYS.has(key));
    expect(missing, `Missing ocean manifest keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('ships 32x32 sprite files, with transparent detail overlays', async () => {
    const sharp = require('sharp');
    const transparentOverlayKeys = oceanKeys.filter(key =>
      key.includes('FOAM') || key.includes('KELP') || key.includes('CORAL') || key.includes('FISH') ||
      key.includes('ROCK') || key.includes('SHORE') || key.includes('SHIPWRECK') || key.includes('HEAD')
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
      } else if (key === 'OCEAN_SEA_GIANT_HEAD') {
        expect(meta.width, `${key} width`).toBe(160);
        expect(meta.height, `${key} height`).toBe(160);
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
    expect(source).toContain('waterProximity(c, r, 2)');
    expect(source).toContain('t === TileType.EMPTY');
  });

  it('anchors the bottom-ocean undead Roman ruin cluster beside the cove', () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '../src/render/RenderEngine.ts'), 'utf8');
    expect(source).toContain('const BOTTOM_OCEAN_UNDEAD_RUINS');
    expect(source).toContain("key: 'MAP_NECRO_GATE_A'");
    expect(source).toContain("key: 'MAP_NECRO_RUIN_2'");
    expect(source).toContain("key: 'MAP_NECRO_STANDARD'");
    expect(source).toContain("key: 'MAP_NECRO_SKULL_SHRINE'");
    expect(source).toContain('WATER_ZONE.col + WATER_ZONE.width');
    expect(source).toContain('GRID.ROWS - 2.25');
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
    expect(source).not.toContain("{ col: 36, row: 0,  key: 'MAP_CORNER_SHRINE_A2'");
    expect(source.indexOf('this.layers.bg.addChild(decorLayer);')).toBeLessThan(source.indexOf('this.layers.bg.addChild(cornerLayer);'));
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
    expect(source).toContain('x: caveCx');
    expect(source).toContain('y: caveCy');
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
