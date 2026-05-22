# Roman TD — Map Visual Overhaul — Higgsfield Prompts

**Total generation budget after external-asset integration:** ~13 calls
(4 solo + 9 sheets). Worst-case with reroll allowance: ~18 calls.
Down from 109 single-sprite calls (~88% reduction).

## What we already have on disk (zero Higgsfield needed)

User dropped two asset packs into the project on 2026-05-21:

1. **17 Roman shrine sprites** (cropped from
   `~/Desktop/Untitled Project (1)/`) — already sliced into
   `public/assets/sprites/map_overhaul/m_shrine_{0..11}.png` and
   `m_shrine_alt_{0..4}.png`. Registered as `MAP_SHRINE_*` keys.
   Wired into BIOME_UNDEAD_RUINS + BIOME_HELLSCAPE prop pools.

2. **16 craftpix undead tileset sprites** (from the Free-Undead-Tileset
   pack at `~/Dropbox/06 Video Games/Gem TD/Assets/...`) — copied to
   `public/assets/sprites/map_overhaul/m_undead_*.png`. Registered as
   `DP_UNDEAD_*` keys. Wired into BIOME_UNDEAD_FOREST +
   BIOME_UNDEAD_RUINS + BIOME_HELLSCAPE prop pools.

3. **3 craftpix skull-door sprites** — copied to
   `m_cave_undead_door_{a,b,c}.png`. Registered as
   `MAP_CAVE_UNDEAD_DOOR_*` keys. **Wired in as the undead cave
   entrances**, saving the 3 Higgsfield solo cave calls for the late
   biomes (W11-15, W16-18, W19-20).

## What this saves vs. the original plan

| Prompt | Status |
|---|---|
| Solo 4 — Cave: UNDEAD_FOREST | **SKIP** — using `MAP_CAVE_UNDEAD_DOOR_A` |
| Solo 5 — Cave: UNDEAD_RUINS | **SKIP** — using `MAP_CAVE_UNDEAD_DOOR_B` |
| Solo 6 — Cave: HELLSCAPE | **SKIP** — using `MAP_CAVE_UNDEAD_DOOR_C` |
| Sheet 8 — Undead-only decorations | **SKIP** — covered by craftpix bones/graves/dead-trees |
| Sheet 7, cells 7-9 (demon variants) | Partially covered — keep generating for charred log / twisted iron / lava crack since craftpix doesn't include those |

**Calls saved: 5 of 18 (3 solo + 1 full sheet + partial sheet content).**

If you want the user-image shrines + craftpix decorations to stay
forever as the late-biome look (probably yes — they're already
gorgeous), you can also **skip Solo 6 (HELLSCAPE)** and consider
generating only the early-biome anchors. That drops the budget to
~10 total calls.

## Still needed from Higgsfield

**Solo (4 calls):**
- Solo 1 — Cave: BIOME_GRASSLAND
- Solo 2 — Cave: BIOME_CELTIC_WOOD
- Solo 3 — Cave: BIOME_CARTHAGE_ARID
- Solo 7 — Gate: Roman fortress

**Sheets (9 calls):**
- Sheet 1, 2, 3 — Path tilesets (sunny / mossy / scorched) — 3 calls
- Sheet 4 — Aura medallions
- Sheet 5 — Waypoint coins
- Sheet 6 — Universal decoration props (5×5)
- Sheet 7 — Biome-themed decoration props (3×3) — Celtic, Carthage,
  demon items still needed
- Sheet 9 — Battle debris (Roman fallen, broken pila, blood, etc.)
- Sheet 10 — Ambient sprites (torches, banners, smoke, birds)

Sheet 8 (undead decorations) is fully covered by external assets.
Sheet 11 spare buffer still recommended for re-rolls.

---

(Prompts for the still-needed assets continue below.)

---

**Workflow per asset group:**
1. Copy the prompt block below into Higgsfield. Run it.
2. Download the output PNG to `maps_raw/`.
3. Run the crop tool:
   ```
   npx tsx tools/cropSheet.ts maps_raw/<INPUT>.png public/assets/map <ROWSxCOLS> <PREFIX>
   ```
4. Open `src/render/Assets.ts` and add the new keys to the MANIFEST.
   The cropped files land as `<prefix>_0.png`, `<prefix>_1.png`, etc.
   in row-major order matching the cell list below each prompt.

**Style rules baked into every prompt:**
- Top-down 2D RPG game-art style, isometric-leaning.
- Pixel-art finish suitable for 32px game tiles (sprites can render
  larger; the in-game scale is set by code).
- **Transparent PNG background** (NOT magenta — magenta keying is only
  used by the existing 3×3 sprite slicer; map assets need true alpha).
- No text, no UI elements, no characters between cells on sheets.
- Soft directional shadow bottom-right where appropriate (consistent
  light source upper-left).
- Color palette specified per asset / per biome.

---

## SOLO GENERATIONS (7 calls × 128×128 each)

These are the showpiece anchors — too important for sheet detail loss.

### Solo 1 — Cave: BIOME_GRASSLAND (W1-3 sunny)

```
Top-down 2D RPG game-art tile, isometric-leaning. An ornate Roman
stone archway carved into a rocky cliff face. Carved stone columns
flanking the entrance, weathered limestone, dark mysterious interior
with warm flickering torchlight glow. Small dust motes drifting. Soft
moss creeping up the lower stones. 128×128px transparent PNG, pixel-
art top-down style matching late-90s strategy games like Age of
Empires II. Color palette: warm sandstone, soft gold torchlight,
mossy green accents. Soft directional shadow bottom-right, no text or
UI.
```

→ Save as `maps_raw/cave_grassland.png`, copy to
`public/assets/map/map_cave_grassland.png`. Manifest key:
`MAP_CAVE_GRASSLAND`.

### Solo 2 — Cave: BIOME_CELTIC_WOOD (W4-6 woodland)

```
Top-down 2D RPG game-art tile, isometric-leaning. An ancient Roman
stone archway in a Celtic forest setting. Carved columns covered in
ivy, moss-stained limestone, dark interior with cool pale torchlight.
Druid runes faintly carved on the columns. Surrounding rock face
darker, forest-floor leaves at the base. 128×128px transparent PNG,
pixel-art top-down style. Color palette: dark forest green, mossy
gray-green stone, cool pale yellow torch. Soft shadow bottom-right.
```

→ Save as `maps_raw/cave_celtic.png` → `map_cave_celtic.png`. Manifest
key: `MAP_CAVE_CELTIC`.

### Solo 3 — Cave: BIOME_CARTHAGE_ARID (W7-10 arid)

```
Top-down 2D RPG game-art tile, isometric-leaning. A weathered Roman
stone archway in a sun-baked North African landscape. Sandstone
columns blasted by sand, dry vines clinging to the cliff face above,
dark interior with no light. Sun-bleached skull near the entrance.
Tan-orange palette dominant. 128×128px transparent PNG, pixel-art
top-down style. Color palette: warm sandstone, tan orange, bleached
bone white accents. Soft shadow bottom-right.
```

→ `maps_raw/cave_carthage.png` → `map_cave_carthage.png`. Manifest
key: `MAP_CAVE_CARTHAGE`.

### Solo 4 — Cave: BIOME_UNDEAD_FOREST (W11-15 undead)

```
Top-down 2D RPG game-art tile, isometric-leaning. An ancient Roman
stone archway in a misty dark forest. Cracked stone columns wrapped
in dead ivy, weathered gray-blue limestone, dark interior glowing
with eerie PURPLE PORTAL ENERGY radiating outward. Wisps of green
mist drifting around the entrance. Tombstones half-visible at the
base. 128×128px transparent PNG, pixel-art top-down style. Color
palette: dark slate gray-blue, glowing purple core, sickly green
mist accents. Soft shadow bottom-right.
```

→ `maps_raw/cave_undead.png` → `map_cave_undead.png`. Manifest key:
`MAP_CAVE_UNDEAD`.

### Solo 5 — Cave: BIOME_UNDEAD_RUINS (W16-18 carthage undead)

```
Top-down 2D RPG game-art tile, isometric-leaning. A crumbling Roman
stone archway in an ancient ruined ground. Broken stone columns,
fallen lintel, blackened limestone, dark interior leaking thick
SICKLY GREEN MIASMA that pools at the entrance. Bone shards scattered
at the base. Purple cast on the surrounding rock. 128×128px
transparent PNG, pixel-art top-down style. Color palette: dark stone
gray with purple cast, glowing green miasma, bleached bone accents.
Soft shadow bottom-right.
```

→ `maps_raw/cave_undead_ruins.png` → `map_cave_undead_ruins.png`.
Manifest key: `MAP_CAVE_UNDEAD_RUINS`.

### Solo 6 — Cave: BIOME_HELLSCAPE (W19-20 demon)

```
Top-down 2D RPG game-art tile, isometric-leaning. A demonic mouth
carved into volcanic black rock, masquerading as a Roman archway.
Twisted obsidian columns, cracked black stone, glowing molten RED
PORTAL ENERGY in the interior. Embers floating up from the entrance.
Charred ground around the base, faint lava cracks underneath.
128×128px transparent PNG, pixel-art top-down style. Color palette:
black obsidian, glowing molten red core, orange ember accents. Soft
shadow bottom-right.
```

→ `maps_raw/cave_hellscape.png` → `map_cave_hellscape.png`. Manifest
key: `MAP_CAVE_HELLSCAPE`.

### Solo 7 — Gate: Roman fortress

```
Top-down 2D RPG game-art tile, isometric-leaning. A small Roman
fortress gateway viewed from above. Crenellated stone walls in a
square C-shape, central iron portcullis (raised), two red Roman
banners with gold SPQR insignia hanging on iron poles flanking the
gate, two watchtower wings with crenellation, sandstone color
weathered by age. Lit torches in iron sconces at the corners.
128×128px transparent PNG, pixel-art top-down style matching late
'90s strategy games. Color palette: warm sandstone, deep red banners,
gold trim, dark iron portcullis. Soft shadow bottom-right.
```

→ `maps_raw/gate.png` → `map_gate_roman.png`. Manifest key:
`MAP_GATE_ROMAN`.

---

## SPRITE SHEETS (11 calls — most cells per call)

For each sheet: generate the PNG, then run
```
npx tsx tools/cropSheet.ts maps_raw/<INPUT>.png public/assets/map <RxC> <PREFIX>
```

Cell indexes are row-major: cell 0 is top-left, cell 1 is one cell to
the right, then wrapping to the next row.

### Sheet 1 — Path tileset: SUNNY ROMAN COBBLE (4×4)

```
Sprite sheet for a top-down 2D RPG, 4×4 grid layout on a fully
transparent background. Each cell is a 32×32px seamless path tile
made of hand-laid Roman cobblestones — individual stones with visible
mortar lines, slight worn edges, weathered warm sandstone color, soft
shadow indicating light from upper-left. Tile must edge-match its
neighbors so the path looks continuous when assembled.

Cells (left-to-right, top-to-bottom):
1. Straight horizontal path tile (E-W)
2. Straight vertical path tile (N-S)
3. Corner NE (path turns from north entry to east exit)
4. Corner NW (north to west)
5. Corner SE (south to east)
6. Corner SW (south to west)
7. T-junction opening UP (path runs E-W with branch going north)
8. T-junction opening DOWN (E-W with branch going south)
9. T-junction opening LEFT (N-S with branch going west)
10. T-junction opening RIGHT (N-S with branch going east)
11. 4-way CROSS junction
12. Dead-end cap pointing UP (single path tile capping north)
13. Dead-end cap pointing DOWN
14. Dead-end cap pointing LEFT
15. Dead-end cap pointing RIGHT
16. Empty / spare slot (transparent)

Color palette: warm sandstone cobbles, dark mortar lines, soft tan
highlights, no green, no characters, no text. Transparent background
outside the path tiles.
```

→ Crop: `4x4 path_sunny` → `path_sunny_0.png` (H) through
`path_sunny_15.png` (spare). Manifest keys: `PATH_SUNNY_H`,
`PATH_SUNNY_V`, `PATH_SUNNY_CORNER_NE`, `PATH_SUNNY_CORNER_NW`,
`PATH_SUNNY_CORNER_SE`, `PATH_SUNNY_CORNER_SW`, `PATH_SUNNY_T_UP`,
`PATH_SUNNY_T_DOWN`, `PATH_SUNNY_T_LEFT`, `PATH_SUNNY_T_RIGHT`,
`PATH_SUNNY_CROSS`, `PATH_SUNNY_END_UP`, `PATH_SUNNY_END_DOWN`,
`PATH_SUNNY_END_LEFT`, `PATH_SUNNY_END_RIGHT`.

### Sheet 2 — Path tileset: MOSSY CRACKED COBBLE (4×4)

Same prompt as Sheet 1 but with:
- "Heavy moss creeping between the stones, cracks running through
  several cobbles, darker gray-green tones."
- Color palette: "weathered gray cobble with dark green moss, cracks
  showing dark wet stone underneath, cool shadow tones."

→ Crop: `4x4 path_mossy`. Keys: `PATH_MOSSY_H`, `PATH_MOSSY_V`, …
`PATH_MOSSY_END_RIGHT` (parallel to Sheet 1).

### Sheet 3 — Path tileset: SCORCHED RED COBBLE (4×4)

Same prompt as Sheet 1 but with:
- "Cobbles charred black with glowing red-orange lava cracks running
  between several stones. Ember sparks faintly visible in the cracks."
- Color palette: "black scorched stone with molten orange-red cracks,
  ash gray mortar, ember accents."

→ Crop: `4x4 path_demon`. Keys: `PATH_DEMON_H`, `PATH_DEMON_V`, …
`PATH_DEMON_END_RIGHT`.

### Sheet 4 — Aura medallions (3×3)

```
Sprite sheet for a top-down 2D RPG, 3×3 grid layout on a fully
transparent background. Each cell is a 32×32px square ornate bronze
pedestal medallion set with a glowing colored gem in the center,
engraved with a unique Roman sigil around the rim. Pedestal has
marble inlay, slight rim highlight, weathered Roman aesthetic.

Cells (left-to-right, top-to-bottom):
1. PURPLE gem with engraved SPQR initials (tempo / attack-speed aura)
2. BLUE gem with engraved Aquila eagle (war / damage aura)
3. RED gem with engraved Eagle-of-War with spread wings (tyrant / vs-boss aura)
4. CYAN gem with engraved wave crest (aether / anti-flyer aura)
5. GOLD gem with engraved laurel wreath (treasury / gold-per-kill aura)
6. EMERALD gem with engraved watchtower eye (watchtower / range aura)
7. Empty / spare slot
8. Empty / spare slot
9. Empty / spare slot

Color palette: weathered bronze pedestals with marble inlay, gem
center matches each cell's specified color, dark engraved lines.
Transparent background outside the medallions.
```

→ Crop: `3x3 aura_medallion`. Keys: `MAP_AURA_PURPLE`,
`MAP_AURA_BLUE`, `MAP_AURA_RED`, `MAP_AURA_CYAN`, `MAP_AURA_GOLD`,
`MAP_AURA_EMERALD` (cells 0-5; 6-8 spare).

### Sheet 5 — Waypoint coins (3×3)

```
Sprite sheet for a top-down 2D RPG, 3×3 grid layout on a fully
transparent background. Each cell is a 32×32px circular bronze
medallion engraved with a Roman numeral in the center surrounded by
a laurel wreath border. Slight bronze rim highlight, weathered.

Cells (left-to-right, top-to-bottom):
1. Roman numeral I
2. Roman numeral II
3. Roman numeral III
4. Roman numeral IV
5. Roman numeral V
6. Roman numeral VI
7. Roman numeral VII
8. Empty / spare slot
9. Empty / spare slot

Color palette: weathered bronze with gold highlights, dark engraved
laurel and numerals. Transparent background outside the coin.
```

→ Crop: `3x3 waypoint`. Keys: `MAP_WAYPOINT_1`, `MAP_WAYPOINT_2`, …
`MAP_WAYPOINT_7` (cells 0-6; 7-8 spare).

### Sheet 6 — Universal decoration props (5×5)

```
Sprite sheet for a top-down 2D RPG, 5×5 grid layout on a fully
transparent background. Each cell is a 32×32px game-prop sprite in
pixel-art top-down style. Each prop is centered in its cell, viewed
from above with a slight isometric tilt.

Cells (left-to-right, top-to-bottom):
1. Tombstone A — simple weathered headstone, gray
2. Tombstone B — cross-topped headstone, mossy
3. Tombstone C — broken slab tombstone leaning sideways
4. Broken stone column (lying on its side, fluted)
5. Ruined Roman arch fragment (small)
6. Dead tree (gnarled, leafless)
7. Large rock cluster (4-5 rocks together)
8. Fern (lush green forest fern)
9. Tall grass tuft (light green)
10. Lit iron brazier (with small flame on top, glowing)
11. Hay bale (round, golden)
12. Cart wheel (wooden, broken)
13. Sword in stone (sword half-buried point-down into a rock)
14. Statue fragment (broken Roman statue torso, sandstone)
15. Mushrooms cluster (red-capped, white spots)
16. Small bush (round, dark green leaves)
17. Wooden picket fence segment (short, weathered)
18. Stack of barrels (3 wooden casks)
19. Roman milestone (cylindrical stone marker)
20. Discarded helmet (Roman gladiator helmet, lying on side)
21. Scroll (rolled parchment, lying flat)
22. Wooden post with rope coil
23. Wagon wheel half-buried
24. Stone well (small, with bucket)
25. Empty / spare

Color palette: natural earth tones — gray stone, brown wood, dark
green foliage, weathered bronze accents on Roman items. No bright
saturated colors. Transparent background outside each prop.
```

→ Crop: `5x5 prop_universal`. Keys: `DP_TOMBSTONE_A`, `DP_TOMBSTONE_B`,
`DP_TOMBSTONE_C`, `DP_BROKEN_COLUMN`, `DP_RUINED_ARCH`,
`DP_DEAD_TREE`, `DP_ROCK_CLUSTER`, `DP_FERN`, `DP_TALL_GRASS`,
`DP_BRAZIER`, `DP_HAY_BALE`, `DP_CART_WHEEL`, `DP_SWORD_IN_STONE`,
`DP_STATUE_FRAGMENT`, `DP_MUSHROOM_CLUSTER`, `DP_DENSE_BUSH`,
`DP_PICKET_FENCE`, `DP_BARRELS`, `DP_MILESTONE_NEW`,
`DP_HELMET_NEW`, `DP_SCROLL_NEW`, `DP_POST_ROPE`,
`DP_WAGON_WHEEL_BURIED`, `DP_STONE_WELL` (cells 0-23; cell 24 spare).

### Sheet 7 — Biome-themed decoration props (3×3)

```
Sprite sheet for a top-down 2D RPG, 3×3 grid layout on a fully
transparent background. Each cell is a 32×32px biome-themed game prop.

Cells (left-to-right, top-to-bottom):
1. Celtic druid stone (vertical megalith with carved spiral runes)
2. Celtic oak log (mossy fallen oak section, thick)
3. Celtic mossy boulder (large rock covered in green moss)
4. Carthage cypress tree (tall, dark green, conical)
5. Carthage sand tuft (dry desert grass clump)
6. Carthage Punic shield (round, blue with crescent, slightly broken)
7. Demon charred log (blackened wood with glowing red cracks)
8. Demon twisted iron (rusted metal scrap twisted into a thorn shape)
9. Demon lava crack (ground crack glowing molten orange-red)

Color palette: each region uses its native palette — Celtic dark
green and stone gray; Carthage tan/blue desert tones; demon black
with molten red. Transparent background outside each prop.
```

→ Crop: `3x3 prop_biome`. Keys: `DP_DRUID_STONE`, `DP_OAK_LOG`,
`DP_MOSSY_BOULDER`, `DP_CYPRESS`, `DP_SAND_TUFT`, `DP_PUNIC_SHIELD`,
`DP_CHARRED_LOG`, `DP_TWISTED_IRON`, `DP_LAVA_CRACK`.

### Sheet 8 — Undead-only decorations (2×2)

```
Sprite sheet for a top-down 2D RPG, 2×2 grid layout on a fully
transparent background. Each cell is a 32×32px undead-themed prop.

Cells (left-to-right, top-to-bottom):
1. Bone pile (skull + scattered ribs + femurs, weathered)
2. Sarcophagus (stone coffin lid askew, dark interior)
3. Severed Roman standard (broken pole with torn eagle banner)
4. Fallen leaves clump (rust-colored autumn leaves on ground)

Color palette: bleached bone white, gray weathered stone, rust red,
muted browns. Transparent background outside each prop.
```

→ Crop: `2x2 prop_undead`. Keys: `DP_BONE_PILE`, `DP_SARCOPHAGUS`,
`DP_SEVERED_STANDARD`, `DP_FALLEN_LEAVES`. (Note: this sheet is
small — 4 cells in 2×2; cropSheet.ts will produce 4 files.)

### Sheet 9 — Battle debris (4×3)

```
Sprite sheet for a top-down 2D RPG, 4×3 grid layout (4 columns, 3
rows) on a fully transparent background. Each cell is a 32×32px
battlefield debris sprite — fallen soldiers, broken weapons, blood
patches. Each piece has narrative weight; show wear, decay, and
defeat.

Cells (left-to-right, top-to-bottom):
1. Fallen Roman soldier A (face-down, gold helmet, red tunic, arm
   extended)
2. Fallen Roman soldier B (sideways, large rectangular scutum shield
   visible across body)
3. Fallen Roman soldier C (slumped against an unseen wall, legs
   splayed)
4. Fallen Celtic raider (bearded, blue war paint, axe still gripped)
5. Fallen Carthage spearman (Punic blue + bronze armor, broken spear
   nearby)
6. Skeletal remains, Roman (bones in Roman armor outline, helmet
   beside skull)
7. Broken pilum cluster (3-4 javelin shafts snapped at varying angles)
8. Broken Celtic shield (wooden round shield split in half)
9. Dried blood patch, small (irregular dark red stain, ~16px wide)
10. Dried blood patch, large with smear (~28px wide with drag mark)
11. Discarded gladius (Roman shortsword lying flat, blade pristine)
12. Scattered scrolls + helmet (3 unfurled parchments next to a
    discarded helmet)

Color palette: muted Roman reds and golds, dark dried blood, weathered
bronze, bone white. Transparent background outside each prop.
```

→ Crop: `3x4 battle_debris` (NOTE: row-major means 3 rows × 4 cols).
Keys: `DBR_ROMAN_FALLEN_A`, `DBR_ROMAN_FALLEN_B`, `DBR_ROMAN_FALLEN_C`,
`DBR_CELTIC_FALLEN`, `DBR_CARTHAGE_FALLEN`, `DBR_SKELETAL_REMAINS`,
`DBR_BROKEN_PILUM`, `DBR_BROKEN_SHIELD_CELT`, `DBR_BLOOD_SMALL`,
`DBR_BLOOD_LARGE`, `DBR_GLADIUS`, `DBR_SCATTERED_SCROLLS`.

### Sheet 10 — Ambient sprite life (3×3)

```
Sprite sheet for a top-down 2D RPG, 3×3 grid layout on a fully
transparent background. Each cell is a 32×32px ambient sprite for
environmental life on the map.

Cells (left-to-right, top-to-bottom):
1. Iron torch on wall sconce (top-down view, flame visible, glowing
   orange)
2. Red Roman banner hanging vertically (gold SPQR insignia, slight
   ripple)
3. Roman standard (Aquila eagle atop pole, planted upright, red
   tassels)
4. Bird shadow (black silhouette of a soaring raven viewed from above,
   wings spread)
5. Smoke column (vertical wispy gray-white smoke, rising)
6. Butterfly (small, with yellow-orange wings spread, white spots)
7. Empty / spare
8. Empty / spare
9. Empty / spare

Color palette: each cell uses its native colors — torch glowing
orange, banner deep red with gold, standard bronze + red, raven
silhouette pure black, smoke gray-white with light alpha hint,
butterfly bright yellow with orange. Transparent background outside
each sprite.
```

→ Crop: `3x3 ambient`. Keys: `AMB_TORCH`, `AMB_BANNER`,
`AMB_ROMAN_STANDARD`, `AMB_BIRD`, `AMB_SMOKE_COLUMN`, `AMB_BUTTERFLY`
(cells 0-5; cells 6-8 spare).

### Sheet 11 — Spare buffer (3×3)

Reserve for re-rolling whichever single sheet renders worst. If
everything generates cleanly first try, this slot goes unused. Pick
the 9 weakest cells from any other sheet and re-prompt them as a
single 3×3 sheet to cherry-pick replacements.

---

## Manifest registration

After each crop, open `src/render/Assets.ts` and add the new keys to
the `MANIFEST` constant. Pattern:

```ts
// 2026-05-21 — Visual overhaul: biome map system
MAP_CAVE_GRASSLAND: 'map_cave_grassland.png',
MAP_CAVE_CELTIC: 'map_cave_celtic.png',
// ... etc through all 80 keys
```

The asset paths assume `public/assets/map/` as the base directory.
Verify with `npx vite build` after each batch — Vite will warn if a
manifest key references a missing file.

## Wiring after assets land

1. **Caves + Gate**: replace the existing `DARK_CAVE` / `ROMAN_GATE`
   draw calls in `RenderEngine.drawStatic` (~line 1900-1960) with
   biome-aware lookups using `BIOMES[biomeForWave(state.wave)].caveKey`.
2. **Path tilesets**: replace the dirt-tile rolls in the terrain loop
   with auto-tile neighbor picking. New helper `pickPathTile(state,
   col, row, biome)`.
3. **Medallions**: replace procedural Pixi Graphics aura tile +
   waypoint coin draws with sprite-based renders (keep the existing
   glow halo Graphics underneath for the pulse animation).
4. **Decor + debris**: already wired in V2 — new sprite keys auto-pick
   up via the existing `tex(key)` calls.
5. **Ambient sprites**: extend `drawAmbient` with sin-wave-animated
   torch/banner/standard sprites at cave + gate positions.

All wiring details live in the approved plan at
`~/.claude/plans/greedy-foraging-breeze.md`.
